"""Checker shape validation for the friction-derived tasks g-l against the live target (no agent, no model): on a series
seeded with fixture set v2, produce the correct end state of every friction-derived task by REST, snapshot once, and evaluate
the six new checkers on that real API state. The same pattern as probes/shape_check.py (tasks a-f), which stays as it is.
  TARGET=selfhosted python3 -I -B probes/shape_check_v2.py --nonce N12 [--out DIR]
All writes are on bench-<N12>- objects (guarded, throttled, prefix-checked by lib/ph.py). Because the six end states are
applied together, each checker's "nothing else changed" criterion is expected to fail; every task-specific criterion must
pass. Afterwards run `seed/seed.py --nonce N12 --reset` (restores the fixtures and checks the state hash) and cleanup."""
import argparse, copy, json, os, sys, time
sys.dont_write_bytecode = True
ROOT = os.path.abspath(os.path.join(os.path.dirname(os.path.abspath(__file__)), ".."))
for d in ("lib", "seed", os.path.join("bench", "checkers")):
    sys.path.insert(0, os.path.join(ROOT, d))
import ph as P, spec as S, state as ST
import check_g, check_h, check_i, check_j, check_k, check_l

EXPECTED_COLLATERAL = {"nothing_else_changed"}


def must(code, r, what):
    if code >= 300:
        raise SystemExit("%s failed: HTTP %s %s" % (what, code, str(r)[:400]))
    return r


def main():
    ap = argparse.ArgumentParser(); ap.add_argument("--nonce", required=True); ap.add_argument("--out"); ap.add_argument("--run-tag", default="s001")
    a = ap.parse_args(); n12 = a.nonce[:12]; pre = P.prefix(n12); R = a.run_tag
    base = json.load(open(os.path.join(ROOT, "state", "seed-%s.json" % n12)))
    if base.get("fixtures") != "v2":
        raise SystemExit("series %s was seeded with fixture set %s: the friction-derived tasks need v2" % (n12, base.get("fixtures", "v1")))
    out = a.out or os.path.join(ROOT, "logs", "shape-v2-%s-%s" % (n12, time.strftime("%Y%m%dT%H%M%SZ", time.gmtime())))
    os.makedirs(out, exist_ok=False)
    ph = P.PostHog(log=open(os.path.join(out, "requests.log"), "a")); info = ph.guard(quiet=True)
    print("target %s project %s" % (info["target"], info["project_id"]))
    sp = S.spec(n12, "v2"); ids = base["ids"]
    w = lambda name: ph.require_prefixed(name, n12)
    ev = lambda e: {"kind": "EventsNode", "event": e, "name": e}
    # g: dashboard + five insights
    dn = "%s%s-product-overview" % (pre, R); w(dn)
    d = must(*ph.post("dashboards/", {"name": dn, "description": "Signups, conversion and retention"}), "g: create dashboard")
    viz = lambda src: {"kind": "InsightVizNode", "source": src}
    qs = {"daily-signups": viz({"kind": "TrendsQuery", "series": [dict(ev("signup_completed"), math="total")], "interval": "day", "dateRange": {"date_from": "-30d"}}),
          "signup-funnel": viz({"kind": "FunnelsQuery", "series": [ev("$pageview"), ev("signup_started"), ev("signup_completed")]}),
          "signup-retention": viz({"kind": "RetentionQuery", "retentionFilter": {"period": "Week", "targetEntity": {"id": "signup_completed", "name": "signup_completed", "type": "events"},
                                                                                 "returningEntity": {"id": "app_opened", "name": "app_opened", "type": "events"}}}),
          "top-events": {"kind": "DataVisualizationNode", "source": {"kind": "HogQLQuery", "query": check_g.SQL}},
          "weekly-visitors": viz({"kind": "TrendsQuery", "series": [dict(ev("$pageview"), math="dau")], "interval": "week", "dateRange": {"date_from": "-90d"}})}
    for short, q in qs.items():
        name = "%s%s-%s" % (pre, R, short); w(name)
        must(*ph.post("insights/", {"name": name, "query": q, "dashboards": [d["id"]], "saved": True}), "g: create " + name)
    # h: tag the ten legacy insights, eight annotations
    for n in sp["legacy_insights"]:
        w(n); cur = [i for i in sp["insights"] if i["name"] == n][0]["tags"]
        must(*ph.patch("insights/%s/" % ids["insights"][n]["id"], {"tags": cur + ["%s%s-retired" % (pre, R)]}), "h: tag " + n)
    for when, text in check_h.NOTES:
        content = "%s%s %s" % (pre, R, text); w(content)
        must(*ph.post("annotations/", {"content": content, "date_marker": when, "scope": "project"}), "h: annotate " + text)
    # i: third variant, conditions resent exactly as read
    key = pre + "checkout-banner"; w(key)
    code, flag = ph.get("feature_flags/%s/" % ids["flags"][key])
    filt = copy.deepcopy(must(code, flag, "i: read flag")["filters"])
    filt["multivariate"]["variants"] = [{"key": "control", "name": "Control", "rollout_percentage": 34}, {"key": "test", "name": "Test", "rollout_percentage": 33},
                                        {"key": "test-b", "name": "Test B", "rollout_percentage": 33}]
    must(*ph.patch("feature_flags/%s/" % flag["id"], {"filters": filt}), "i: add variant")
    # j: second question's text
    sn = pre + "onboarding-survey"; w(sn)
    code, sv = ph.get("surveys/%s/" % ids["surveys"][sn])
    qs_ = copy.deepcopy(must(code, sv, "j: read survey")["questions"]); qs_[1]["question"] = check_j.NEW_TEXT
    must(*ph.patch("surveys/%s/" % sv["id"], {"questions": qs_}), "j: edit question")
    # k: funnel: new first step, -30d, rename
    old, new = pre + "signup-funnel", pre + "signup-funnel-3-step"; w(old); w(new)
    code, ins = ph.get("insights/%s/" % ids["insights"][old]["id"])
    q = copy.deepcopy(must(code, ins, "k: read funnel")["query"])
    q["source"]["series"] = [ev("$pageview")] + q["source"]["series"]; q["source"]["dateRange"] = {"date_from": "-30d"}
    must(*ph.patch("insights/%s/" % ins["id"], {"name": new, "query": q}), "k: edit funnel")
    # l: delete the 12 scratch objects
    for n in sp["tmp_objects"]["insights"]:
        w(n); must(*ph.patch("insights/%s/" % ids["insights"][n]["id"], {"deleted": True}), "l: delete " + n)
    for n in sp["tmp_objects"]["dashboards"]:
        w(n); must(*ph.patch("dashboards/%s/" % ids["dashboards"][n], {"deleted": True}), "l: delete " + n)
    for content in sp["tmp_objects"]["annotations"]:
        w(content); must(*ph.patch("annotations/%s/" % ids["annotations"][content], {"deleted": True}), "l: delete " + content)
    live = ST.snapshot(ph, n12)
    json.dump(live, open(os.path.join(out, "final-state.json"), "w"), indent=1, sort_keys=True)
    answers = {"l": "DELETED: 12\n"}
    report, ok = {}, True
    for letter, mod in (("g", check_g), ("h", check_h), ("i", check_i), ("j", check_j), ("k", check_k), ("l", check_l)):
        ctx = {"n12": n12, "run_tag": R, "P": pre, "answer": answers.get(letter, "")}
        crit, inf = mod.evaluate(live, base, ctx)
        specific_fail = sorted(k for k, v in crit.items() if v is not True and k not in EXPECTED_COLLATERAL)
        ok = ok and not specific_fail
        report[letter] = {"task_specific_criteria": len([k for k in crit if k not in EXPECTED_COLLATERAL]), "failed": specific_fail,
                          "collateral_criterion": {k: crit[k] for k in crit if k in EXPECTED_COLLATERAL}, "info": inf if specific_fail else None}
        print("checker %s: %d task-specific criteria, failed=%s" % (letter, report[letter]["task_specific_criteria"], specific_fail or "none"))
    json.dump({"n12": n12, "target": info["target"], "report": report, "requests": ph.requests}, open(os.path.join(out, "shape-report.json"), "w"), indent=1, default=str)
    print("shape check v2 %s (requests=%d, details in %s)" % ("PASSED" if ok else "FAILED", ph.requests, os.path.relpath(out, ROOT)))
    sys.exit(0 if ok else 1)


if __name__ == "__main__":
    main()
