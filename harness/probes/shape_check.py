"""Checker shape validation against the live target (no agent, no model): produce the correct end state of every task by
REST on an already seeded series, snapshot once, and evaluate all six checkers on that real API state.
  TARGET=selfhosted python3 -I -B probes/shape_check.py --nonce N12 [--out DIR]
All writes are on bench-<N12>- objects (guarded, throttled, prefix-checked by lib/ph.py). Because the five end states are
applied together, each checker's "nothing else changed" criterion is expected to fail; every task-specific criterion must
pass. Afterwards run `seed/seed.py --nonce N12 --reset` (restores the fixtures and checks the state hash) and cleanup."""
import argparse, json, os, sys, time
sys.dont_write_bytecode = True
ROOT = os.path.abspath(os.path.join(os.path.dirname(os.path.abspath(__file__)), ".."))
for d in ("lib", "seed", os.path.join("bench", "checkers")):
    sys.path.insert(0, os.path.join(ROOT, d))
import ph as P, spec as S, state as ST
import check_a, check_b, check_c, check_d, check_e, check_f

EXPECTED_COLLATERAL = {"nothing_else_changed", "nothing_changed"}


def must(code, r, what):
    if code >= 300:
        raise SystemExit("%s failed: HTTP %s %s" % (what, code, str(r)[:400]))
    return r


def main():
    ap = argparse.ArgumentParser(); ap.add_argument("--nonce", required=True); ap.add_argument("--out"); ap.add_argument("--run-tag", default="s001")
    a = ap.parse_args(); n12 = a.nonce[:12]; pre = P.prefix(n12); R = a.run_tag
    base = json.load(open(os.path.join(ROOT, "state", "seed-%s.json" % n12)))
    out = a.out or os.path.join(ROOT, "logs", "shape-%s-%s" % (n12, time.strftime("%Y%m%dT%H%M%SZ", time.gmtime())))
    os.makedirs(out, exist_ok=False)
    ph = P.PostHog(log=open(os.path.join(out, "requests.log"), "a")); info = ph.guard(quiet=True)
    print("target %s project %s" % (info["target"], info["project_id"]))
    sp = S.spec(n12); ids = base["ids"]
    w = lambda name: ph.require_prefixed(name, n12)
    # a: dashboard + trend, funnel, retention
    dn = "%s%s-growth-overview" % (pre, R); w(dn)
    d = must(*ph.post("dashboards/", {"name": dn, "description": "Signup flow health"}), "a: create dashboard")
    ev = lambda e: {"kind": "EventsNode", "event": e, "name": e}
    qs = {"%s%s-signups-trend" % (pre, R): {"kind": "TrendsQuery", "series": [dict(ev("signup_completed"), math="total")], "interval": "day", "dateRange": {"date_from": "-30d"}},
          "%s%s-signup-funnel" % (pre, R): {"kind": "FunnelsQuery", "series": [ev("signup_started"), ev("signup_completed")]},
          "%s%s-signup-retention" % (pre, R): {"kind": "RetentionQuery", "retentionFilter": {"period": "Week", "targetEntity": {"id": "signup_completed", "name": "signup_completed", "type": "events"},
                                                                                               "returningEntity": {"id": "app_opened", "name": "app_opened", "type": "events"}}}}
    for name, src in qs.items():
        w(name); must(*ph.post("insights/", {"name": name, "query": {"kind": "InsightVizNode", "source": src}, "dashboards": [d["id"]], "saved": True}), "a: create " + name)
    # b: rename + description
    old = pre + "weekly-signups"; new = pre + "weekly-signups-by-browser"; w(old); w(new)
    must(*ph.patch("insights/%s/" % ids["insights"][old]["id"], {"name": new, "description": check_b.NEW_DESC}), "b: rename")
    # c: flag at 20%, then 60% with the same filters
    key = "%s%s-new-checkout" % (pre, R); w(key)
    props = [{"key": "email", "operator": "icontains", "value": "@example.com", "type": "person"}, {"key": "plan", "operator": "exact", "value": ["pro"], "type": "person"}]
    f = must(*ph.post("feature_flags/", {"key": key, "name": "New checkout flow", "active": True, "filters": {"groups": [{"properties": props, "rollout_percentage": 20}]}}), "c: create flag")
    must(*ph.patch("feature_flags/%s/" % f["id"], {"filters": {"groups": [{"properties": props, "rollout_percentage": 60}]}}), "c: raise rollout")
    # e: dashboard-scoped annotation, created then corrected
    first = "%s%s Deploy v4.2.0 checkout rewrite" % (pre, R); final = "%s%s Deploy v4.2.1 checkout rewrite" % (pre, R); w(first); w(final)
    an = must(*ph.post("annotations/", {"content": first, "date_marker": "2026-10-14T09:30:00Z", "scope": "dashboard", "dashboard_id": ids["dashboards"][pre + "release-board"]}), "e: create annotation")
    must(*ph.patch("annotations/%s/" % an["id"], {"content": final}), "e: correct annotation")
    # f: add the triaged tag to the three targets
    targets = [t for t in sp["triage_targets"]]
    for n in targets:
        w(n)
        cur = [i for i in sp["insights"] if i["name"] == n][0]["tags"]
        must(*ph.patch("insights/%s/" % ids["insights"][n]["id"], {"tags": cur + [pre + "triaged"]}), "f: tag " + n)
    live = ST.snapshot(ph, n12)
    json.dump(live, open(os.path.join(out, "final-state.json"), "w"), indent=1, sort_keys=True)
    answers = {"d": "FLAG_COUNT: %d\nDISABLED: %s\n" % (len(sp["flags"]), ", ".join(sorted(sp["disabled_flags"]))),
               "f": "".join("CHANGED: %s\n" % n for n in sorted(targets))}
    report, ok = {}, True
    for letter, mod in (("a", check_a), ("b", check_b), ("c", check_c), ("d", check_d), ("e", check_e), ("f", check_f)):
        ctx = {"n12": n12, "run_tag": R, "P": pre, "answer": answers.get(letter, "")}
        crit, inf = mod.evaluate(live, base, ctx)
        specific_fail = sorted(k for k, v in crit.items() if v is not True and k not in EXPECTED_COLLATERAL)
        ok = ok and not specific_fail
        report[letter] = {"task_specific_criteria": len([k for k in crit if k not in EXPECTED_COLLATERAL]), "failed": specific_fail,
                          "collateral_criterion": {k: crit[k] for k in crit if k in EXPECTED_COLLATERAL}}
        print("checker %s: %d task-specific criteria, failed=%s" % (letter, report[letter]["task_specific_criteria"], specific_fail or "none"))
    json.dump({"n12": n12, "target": info["target"], "report": report, "requests": ph.requests}, open(os.path.join(out, "shape-report.json"), "w"), indent=1)
    print("shape check %s (requests=%d, details in %s)" % ("PASSED" if ok else "FAILED", ph.requests, os.path.relpath(out, ROOT)))
    sys.exit(0 if ok else 1)


if __name__ == "__main__":
    main()
