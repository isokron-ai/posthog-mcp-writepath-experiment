"""Insights lost-update probe (re-run of the 2026-11-08 C1 probe, insights only) against the REST API of the TEST project.

For each of N pairs: set name and description to a known base, fire two PATCHes at the same instant (A changes only
`name`, B changes only `description`), read the insight back and classify the pair:
  both_applied      both fields carry the new values
  lost_update       both requests returned 2xx but one field still holds the base value (a silent lost update)
  conflict_reported one request was rejected with a non-2xx status and the other applied (the server said so: not silent)
  other             anything else (recorded verbatim)
This shows whether PostHog's merged fix (PR #131620) holds in production.

  python3 -I -B probes/insights_race.py [--pairs 30] [--nonce N12]

Safety: same preflight guard as the benchmark (project id + organization id), one fixture insight named
bench-<nonce12>-race-probe, deleted at the end, average request rate <= 2/second (the two racing requests are paid for
in advance by waiting two throttle slots), holds the one-runner lock so it cannot overlap a benchmark run. No load test:
N is capped at 100."""
import argparse, json, os, secrets, sys, threading, time
sys.dont_write_bytecode = True
ROOT = os.path.abspath(os.path.join(os.path.dirname(os.path.abspath(__file__)), ".."))
sys.path.insert(0, os.path.join(ROOT, "lib"))
import ph as P
import lock as LOCK


def classify(i, sa, sb, name, desc, pre):
    a_ok, b_ok = name == "%srace-A-%d" % (pre, i), desc == "B-%d" % i
    if a_ok and b_ok and sa < 300 and sb < 300: return "both_applied"
    if sa < 300 and sb < 300 and (a_ok != b_ok): return "lost_update"
    if sa < 300 and sb < 300: return "other"
    if (sa >= 300) != (sb >= 300) and ((sa < 300 and a_ok and not b_ok) or (sb < 300 and b_ok and not a_ok)): return "conflict_reported"
    return "other"


def main():
    ap = argparse.ArgumentParser(); ap.add_argument("--pairs", type=int, default=30); ap.add_argument("--nonce")
    a = ap.parse_args()
    if not 1 <= a.pairs <= 100: raise SystemExit("--pairs must be between 1 and 100 (this is a probe, not a load test)")
    n12 = (a.nonce or ("000000" + secrets.token_hex(3)))[:12]; pre = P.prefix(n12)
    stamp = time.strftime("%Y%m%dT%H%M%SZ", time.gmtime())
    outdir = os.path.join(ROOT, "probes", "out"); os.makedirs(outdir, exist_ok=True)
    out_path = os.path.join(outdir, "insights-race-%s-%s.json" % (stamp, n12))
    if os.path.exists(out_path): raise SystemExit("output path exists: never reused")
    LOCK.acquire("insights_race probe")
    try:
        ph = P.PostHog(log=open(out_path.replace(".json", ".requests.log"), "x")); info = ph.guard()
        name0 = pre + "race-probe"
        code, obj = ph.post("insights/", {"name": name0, "description": "base", "saved": True, "query": {
            "kind": "InsightVizNode", "source": {"kind": "TrendsQuery", "series": [{"kind": "EventsNode", "event": "$pageview"}]}}})
        if code >= 300: raise SystemExit("create failed: HTTP %s %s" % (code, str(obj)[:300]))
        oid = obj["id"]; rows = []; counts = {}
        try:
            for i in range(a.pairs):
                ph.patch("insights/%s/" % oid, {"name": "%srace-base-%d" % (pre, i), "description": "base-%d" % i})
                ph.throttle.wait(); ph.throttle.wait()  # two slots for the two simultaneous requests
                barrier = threading.Barrier(2); res = {}

                def race(tag, body):
                    barrier.wait()
                    res[tag] = ph.raw("PATCH", "insights/%s/" % oid, body)[0]

                ta = threading.Thread(target=race, args=("A", {"name": "%srace-A-%d" % (pre, i)}))
                tb = threading.Thread(target=race, args=("B", {"description": "B-%d" % i}))
                ta.start(); tb.start(); ta.join(); tb.join()
                _, final = ph.get("insights/%s/" % oid)
                name, desc = (final or {}).get("name"), (final or {}).get("description")
                verdict = classify(i, res.get("A", 0), res.get("B", 0), name, desc, pre)
                counts[verdict] = counts.get(verdict, 0) + 1
                rows.append({"pair": i, "status_A": res.get("A"), "status_B": res.get("B"), "name": name, "description": desc, "verdict": verdict})
        finally:
            c, _ = ph.patch("insights/%s/" % oid, {"deleted": True})
            cleaned = c < 300
        result = {"probe": "insights lost update (concurrent PATCH name / PATCH description)", "when": stamp, "host": ph.host, "project": info["project_id"],
                  "insight_id": oid, "pairs": a.pairs, "counts": counts, "lost_updates": counts.get("lost_update", 0), "fixture_deleted": cleaned,
                  "requests": ph.requests, "previous_result_2026_11_08": "11 pairs, both requests 200 on all, 6 lost updates", "rows": rows}
        with open(out_path, "x") as f:
            json.dump(result, f, indent=1); f.write("\n")
        print(json.dumps({k: v for k, v in result.items() if k != "rows"}))
        print("written: %s" % out_path)
    finally:
        LOCK.release()


if __name__ == "__main__":
    main()
