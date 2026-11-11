"""Shared code for the mechanical end-state checkers (stdlib, Python 3.9+).
A checker reads the final state of the TEST project through PostHog's REST API (read-only, throttled, guarded), compares it
with the seed baseline in state/seed-<n12>.json and writes checker.json into the run directory. No model is involved.
Each check_X.py exposes evaluate(live, base, ctx) -> (criteria, info) as a pure function so it can be tested offline:
  live = seed/state.py snapshot (raw API rows), base = the seed state file, ctx = {n12, run_tag, answer}."""
import argparse, json, os, re, sys
from collections import Counter
sys.dont_write_bytecode = True
ROOT = os.path.abspath(os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", ".."))
sys.path.insert(0, os.path.join(ROOT, "lib")); sys.path.insert(0, os.path.join(ROOT, "seed"))
import state as ST
import spec as S


def collateral(live, base, skip=(), allow_extra=()):
    """Names of seeded objects that differ from the baseline (other than `skip`), plus unexpected extra bench-prefixed objects
    (other than names in `allow_extra`). An empty list means nothing else was touched.
    Annotations are compared as a multiset of contents against the baseline: a seeded annotation that is gone or changed is
    reported (unless skipped), any other prefixed annotation is an extra. With the v1 fixtures (no seeded annotations) this is
    exactly the earlier rule: every prefixed annotation not allowed is an extra. Surveys are compared when the baseline has them."""
    norm, want, bad = ST.normalize(live), base["normalized"], []
    for kind in ("insights", "dashboards", "flags", "surveys"):
        if kind not in want:
            continue
        have = norm.get(kind, {})
        for name, rows in want[kind].items():
            if "%s:%s" % (kind, name) in skip:
                continue
            if have.get(name) != rows:
                bad.append("%s:%s" % (kind, name))
        for name in have:
            if name not in want[kind] and "%s:%s" % (kind, name) not in allow_extra:
                bad.append("extra %s:%s" % (kind, name))
    seeded = Counter(want.get("annotations") or [])
    now = Counter(norm["annotations"])
    for content in sorted(seeded - now):
        if "annotations:%s" % content not in skip:
            bad.append("annotations:%s" % content)
    for content in sorted(now - seeded):
        if "annotations:%s" % content not in allow_extra:
            bad.append("extra annotations:%s" % content)
    return sorted(bad)


def source(query):
    """The analytics query inside an insight's `query` (unwraps InsightVizNode)."""
    if isinstance(query, dict) and query.get("kind") == "InsightVizNode" and isinstance(query.get("source"), dict):
        return query["source"]
    return query if isinstance(query, dict) else {}


def answer_lines(answer):
    """Final answer without the friction block and backticks, as stripped non-empty lines."""
    text = answer or ""
    blocks = list(re.finditer(r"```[^\n]*\n.*?```", text, re.S))
    if blocks and "extra_calls" in blocks[-1].group(0):
        text = text[:blocks[-1].start()] + text[blocks[-1].end():]
    text = text.replace("```", "").replace("`", "").replace("**", "")
    return [l.strip() for l in text.splitlines() if l.strip()]


def run(task, evaluate):
    ap = argparse.ArgumentParser()
    ap.add_argument("--nonce", required=True); ap.add_argument("--run-tag", required=True); ap.add_argument("--run-dir", required=True)
    ap.add_argument("--from-snapshot", help="re-evaluate a saved final-state.json offline (no network)")
    a = ap.parse_args(); n12 = a.nonce[:12]
    base = json.load(open(os.path.join(ROOT, "state", "seed-%s.json" % n12)))
    if a.from_snapshot:
        live = json.load(open(a.from_snapshot))
    else:
        import ph as P
        ph = P.PostHog(log=open(os.path.join(a.run_dir, "checker-requests.log"), "a")); ph.guard(quiet=True)
        live = ST.snapshot(ph, n12)
        with open(os.path.join(a.run_dir, "final-state.json"), "w") as f:
            json.dump(live, f, indent=1, sort_keys=True); f.write("\n")
    ap_ = os.path.join(a.run_dir, "answer.md")
    ctx = {"n12": n12, "run_tag": a.run_tag, "P": "bench-%s-" % n12, "answer": open(ap_).read() if os.path.exists(ap_) else ""}
    criteria, info = evaluate(live, base, ctx)
    criteria["state_readable"] = not live.get("errors")
    out = {"task": task, "nonce_n12": n12, "run_tag": a.run_tag, "criteria": criteria, "info": info,
           "correct": bool(criteria) and all(v is True for v in criteria.values()),
           "judged_by": "mechanical end-state checker over PostHog REST state; no model involved"}
    with open(os.path.join(a.run_dir, "checker.json"), "w") as f:
        json.dump(out, f, indent=2, sort_keys=True); f.write("\n")
    print(json.dumps({"task": task, "correct": out["correct"], "failed": sorted(k for k, v in criteria.items() if v is not True)}))
    return 0
