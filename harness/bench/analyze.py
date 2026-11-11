"""Analysis of a benchmark series. Pure arithmetic over the recorded files; no model, no judging.
Every build in the series gets a column; every task set (bench/TASKSETS.json) gets its own section. The two task sets are
reported separately, per build, and never added into one total.
  python3 -I -B bench/analyze.py [--series-dir runs/series-<n12>] [--no-write]
Reads RUNS.jsonl (every attempt) and each run's metrics.json / checker.json. Prints Markdown and, unless --no-write,
saves it as ANALYSIS-<UTC>.md in the series directory (a new file each time; nothing is overwritten)."""
import argparse, glob, json, os, statistics, sys, time
from collections import defaultdict
ROOT = os.path.abspath(os.path.join(os.path.dirname(os.path.abspath(__file__)), ".."))
METRICS = [("tool calls (all)", "tool_calls"), ("PostHog MCP calls", "posthog_calls"), ("  of which `call <tool>`", "call_cmds"), ("  of which discovery (info/schema/search/tools/help)", "disc_cmds"),
           ("model turns", "turns"), ("failed tool calls", "errors"), ("repeated identical calls", "repeated"), ("retries after an error", "retries"),
           ("tool-result bytes", "result_bytes"), ("input tokens", "tok_in"), ("output tokens", "tok_out"), ("cache-write tokens", "tok_cw"), ("cache-read tokens", "tok_cr"),
           ("reported cost USD", "cost"), ("wall seconds", "wall")]


def load(series_dir):
    lines = [json.loads(l) for l in open(os.path.join(series_dir, "RUNS.jsonl"))]
    fin = [l for l in lines if l.get("event") == "run_finished"]
    runs = []
    for l in fin:
        d = os.path.join(ROOT, l["dir"]) if not os.path.isabs(l["dir"]) else l["dir"]
        if not os.path.isdir(d): d = os.path.join(series_dir, os.path.basename(l["dir"]))
        m = json.load(open(os.path.join(d, "metrics.json"))) if os.path.exists(os.path.join(d, "metrics.json")) else None
        c = json.load(open(os.path.join(d, "checker.json"))) if os.path.exists(os.path.join(d, "checker.json")) else None
        r = {"line": l, "metrics": m, "checker": c, "usable": bool(m and c and l.get("status") == "completed")}
        if m:
            k, t = m["counts"], m["tokens"]
            r["v"] = {"tool_calls": k["tool_calls"], "posthog_calls": k["posthog_calls"], "call_cmds": k.get("posthog_call_commands", 0), "disc_cmds": k.get("posthog_discovery_commands", 0),
                      "turns": m["turns"] or 0, "errors": k["errors"], "repeated": k["repeated_identical_calls"], "retries": k["retries_after_error"], "result_bytes": k["tool_result_bytes"],
                      "tok_in": t.get("input") or 0, "tok_out": t.get("output") or 0, "tok_cw": t.get("cache_creation") or 0, "tok_cr": t.get("cache_read") or 0,
                      "cost": m["cost_usd"] or 0.0, "wall": m["wall_seconds"] or 0}
        runs.append(r)
    return lines, runs


def mmm(vals, money=False):
    if not vals: return "-"
    f = (lambda x: "%.3f" % x) if money else (lambda x: ("%d" % x) if float(x).is_integer() else "%.1f" % x)
    return "%s [%s-%s]" % (f(statistics.median(vals)), f(min(vals)), f(max(vals)))


KNOWN_BUILDS = ("baseline", "fixed", "usability")
SET_ORDER = ("pre-registered", "friction-derived")


def task_set_of():
    """task id -> task set, from bench/TASKSETS.json (runs of the 2026-11-10 series carry no task_set: all pre-registered)."""
    reg = json.load(open(os.path.join(ROOT, "bench", "TASKSETS.json")))["sets"]
    return {t["id"]: name for name, s in reg.items() for t in s["tasks"]}, reg


def main():
    ap = argparse.ArgumentParser(); ap.add_argument("--series-dir"); ap.add_argument("--no-write", action="store_true")
    a = ap.parse_args()
    sd = a.series_dir or (sorted(glob.glob(os.path.join(ROOT, "runs", "series-*")))[-1:] or [None])[0]
    if not sd or not os.path.exists(os.path.join(sd, "RUNS.jsonl")): sys.exit("no series with a RUNS.jsonl found")
    lines, runs = load(sd)
    tset, reg = task_set_of()
    for r in runs:
        r["set"] = r["line"].get("task_set") or tset.get(r["line"]["task"], "unregistered")
    builds = [b for b in KNOWN_BUILDS if any(r["line"]["build"] == b for r in runs)] + sorted({r["line"]["build"] for r in runs} - set(KNOWN_BUILDS))
    sets = [x for x in SET_ORDER if any(r["set"] == x for r in runs)] + sorted({r["set"] for r in runs} - set(SET_ORDER))
    use = [r for r in runs if r["usable"]]
    out = []; w = out.append
    by = lambda st, b, t=None, rep=None: [r for r in use if r["set"] == st and r["line"]["build"] == b and (t is None or r["line"]["task"] == t) and (rep is None or r["line"]["repetition"] == rep)]
    first = runs[0]["line"] if runs else {}
    w("# PostHog MCP benchmark: %s\n" % " vs ".join(builds))
    w("Series `%s` (%s) · model `%s` · manifest `%s` · generated %s" % (os.path.basename(sd), first.get("series") or "two-build series", first.get("model"), first.get("manifest_sha256"), time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())))
    w("Build hashes: " + ", ".join("%s `%s`" % (b, next((r["line"].get("build_entry_sha256") for r in runs if r["line"]["build"] == b), "?")) for b in builds))
    w("Finished attempts: %d (usable: %d). Correctness is the mechanical checker's verdict on PostHog's end state; nothing here is judged by a model.\n" % (len(runs), len(use)))
    w("Cells are `median [min-max]` over the runs in that cell. **Each task set is reported on its own, per build. The sets are never added together:** the pre-registered set is the fair test; the friction-derived set was written after the usability changes were designed and favours the usability build by construction.\n")
    hdr = "| " + " | ".join(builds) + " |"; sep = "|---" * (len(builds) + 1) + "|"
    for st in sets:
        rs_all = [r for r in runs if r["set"] == st]
        tasks = sorted({r["line"]["task"] for r in rs_all}); reps = sorted({r["line"]["repetition"] for r in rs_all})
        w("## Task set: %s\n" % st)
        if st in reg: w(reg[st]["description"] + "\n")
        w("### Per build (the %d tasks of this set)\n\n| metric %s\n%s" % (len(tasks), hdr, sep))
        w("| runs usable | %s |" % " | ".join(str(len(by(st, b))) for b in builds))
        w("| correct (checker) | %s |" % " | ".join("%d/%d" % (sum(1 for r in by(st, b) if r["checker"]["correct"]), len(by(st, b))) for b in builds))
        for label, key in METRICS:
            w("| %s | %s |" % (label, " | ".join(mmm([r["v"][key] for r in by(st, b)], key == "cost") for b in builds)))
        w("| reported cost USD, this set | %s |" % " | ".join("%.2f" % sum(r["v"]["cost"] for r in by(st, b)) for b in builds))
        w("\n### Per task and build\n\n| task | build | correct | tool calls | PostHog calls | turns | failed calls | repeated | result bytes | cost USD | wall s |\n|---|---|---|---|---|---|---|---|---|---|---|")
        for t in tasks:
            for b in builds:
                rs = by(st, b, t)
                g = lambda k, money=False: mmm([r["v"][k] for r in rs], money)
                w("| %s | %s | %d/%d | %s | %s | %s | %s | %s | %s | %s | %s |" % (t, b, sum(1 for r in rs if r["checker"]["correct"]), len(rs), g("tool_calls"), g("posthog_calls"), g("turns"), g("errors"), g("repeated"), g("result_bytes"), g("cost", True), g("wall")))
        w("\n### Per round (repetition) totals, this set\n\n| round | build | runs | correct | tool calls | turns | failed calls | repeated | result bytes | cost USD | wall s |\n|---|---|---|---|---|---|---|---|---|---|---|")
        for rep in reps:
            for b in builds:
                rs = by(st, b, rep=rep); sm = lambda k: sum(r["v"][k] for r in rs)
                w("| %s | %s | %d | %d | %d | %d | %d | %d | %d | %.2f | %d |" % (rep, b, len(rs), sum(1 for r in rs if r["checker"]["correct"]), sm("tool_calls"), sm("turns"), sm("errors"), sm("repeated"), sm("result_bytes"), sm("cost"), sm("wall")))
        w("\n### Where the calls went, this set (per tool; in cli mode the tool is the command inside `exec`)\n\n| tool / command | %s | %s | %s |\n|---%s|" % (
            " | ".join("%s calls" % b for b in builds), " | ".join("%s result bytes" % b for b in builds), " | ".join("%s failed" % b for b in builds), "|---" * (3 * len(builds))))
        agg = defaultdict(lambda: {b: [0, 0, 0] for b in builds})
        for r in use:
            if r["set"] != st: continue
            for c in r["metrics"]["tool_calls"]:
                x = agg[c.get("exec") or c["name"]][r["line"]["build"]]; x[0] += 1; x[1] += c.get("result_bytes", 0); x[2] += 1 if c.get("is_error") else 0
        for name, v in sorted(agg.items(), key=lambda kv: -sum(kv[1][b][0] for b in builds)):
            w("| `%s` | %s | %s | %s |" % (name, " | ".join(str(v[b][0]) for b in builds), " | ".join(str(v[b][1]) for b in builds), " | ".join(str(v[b][2]) for b in builds)))
        w("")
    w("## Failed tool calls, with the reason the server gave\n")
    n = 0
    for r in runs:
        for c in (r["metrics"] or {}).get("tool_calls", []):
            if c.get("is_error"):
                n += 1; w("- run %s (%s, %s, %s): `%s` — %s" % (r["line"]["run_seq"], r["set"], r["line"]["task"], r["line"]["build"], c.get("exec") or c["name"], (c.get("error_head") or "").replace("\n", " ")[:240]))
    if not n: w("None.")
    w("\n## Runs the checker marked incorrect\n")
    bad = [r for r in runs if r["checker"] and not r["checker"]["correct"]]
    for r in bad: w("- run %s %s (%s, %s): failed criteria %s" % (r["line"]["run_seq"], r["line"]["task"], r["set"], r["line"]["build"], ", ".join(sorted(k for k, v in r["checker"]["criteria"].items() if v is not True))))
    if not bad: w("None.")
    w("\n## Every attempt, including failed ones\n\n| run | attempt | set | id | status | agent subtype | correct | cost USD |\n|---|---|---|---|---|---|---|---|")
    for r in runs:
        l = r["line"]; w("| %s | %s | %s | %s | %s | %s | %s | %s |" % (l["run_seq"], l.get("attempt"), r["set"], l["run_id"], l.get("status"), l.get("subtype"), l.get("correct"), l.get("cost_usd")))
    other = [l for l in lines if l.get("event") not in ("run_started", "run_finished")]
    started = defaultdict(int); finished = defaultdict(int)
    for l in lines:
        if l.get("event") == "run_started": started[(l["run_seq"], l.get("attempt"))] += 1
        if l.get("event") == "run_finished": finished[(l["run_seq"], l.get("attempt"))] += 1
    for k in sorted(started):
        if not finished.get(k): w("- run %s attempt %s was started and never finished (interrupted)." % k)
    for l in other: w("- event `%s`: %s" % (l.get("event"), json.dumps({k: v for k, v in l.items() if k != "event"})))
    w("\n## Limitations\n")
    lim = ["Three repetitions per task and build show spread, not a distribution; no significance test is claimed. Differences inside the min-max ranges of another build are not evidence of a difference.",
           "One model (`%s`), one client (Claude Agent SDK), one server mode (cli: a single `exec` tool). Other models, clients or tools mode may behave differently." % first.get("model"),
           "The pre-registered tasks were written by the same team that wrote the fixes, and the same findings informed both: they exercise behaviours the bug-fix patches change. The result says how the builds do on these tasks, not how the server does on PostHog work in general.",
           "Correctness is a mechanical end-state check with exact criteria; a run can be marked incorrect for a deviation a human would accept (and the reverse cannot be ruled out for criteria the checker does not have).",
           "Cost is the SDK's reported estimate and depends on prompt-cache state; the builds of one task run back to back in a balanced order so that cache and time effects do not fall on one build, but they are not eliminated.",
           "The backend is the target recorded in the manifest (for the self-hosted series a local PostHog open-source instance at the same pin); latency and server-side behaviour can drift during a series; the builds differ only in the local MCP server bundle.",
           "The local build differs from PostHog's hosted MCP in its surroundings: Node 25 instead of the pinned Node 26, no edge worker, a local Redis, analytics off, UI apps not built.",
           "The friction lists in each run are the agent's own opinion; they are leads and are not used in any number above.",
           "Fixtures are reset by repair (not by a fresh project); the state hash covers the benchmark's own objects only, not the rest of the project."]
    if "friction-derived" in sets:
        lim.insert(3, "The friction-derived set was written after the usability changes were designed, from the jobs that motivated them; it favours the usability build by construction and must not be read as a fair comparison. It is reported apart from the pre-registered set and never pooled with it.")
    for x in lim:
        w("- " + x)
    text = "\n".join(out) + "\n"
    print(text)
    if not a.no_write:
        p = os.path.join(sd, "ANALYSIS-%s.md" % time.strftime("%Y%m%dT%H%M%SZ", time.gmtime()))
        with open(p, "x") as f: f.write(text)
        print("written: %s" % p, file=sys.stderr)


if __name__ == "__main__":
    main()
