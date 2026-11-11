"""Delete every object the benchmark created under ONE nonce: insights, dashboards, feature flags, annotations and surveys
whose name/key/content starts with bench-<n12>-. Nothing else is touched. Deletion is PostHog's soft delete, except for
surveys, which have no soft delete (PostHog's DELETE removes a survey; a PATCH with deleted=true would be ignored).
  python3 -I -B bench/cleanup.py --nonce N12 [--dry-run] [--request-log FILE]"""
import argparse, os, sys
sys.dont_write_bytecode = True
ROOT = os.path.abspath(os.path.join(os.path.dirname(os.path.abspath(__file__)), ".."))
sys.path.insert(0, os.path.join(ROOT, "lib")); sys.path.insert(0, os.path.join(ROOT, "seed"))
import ph as P
import state as ST
import seed as SEED


def main():
    ap = argparse.ArgumentParser(); ap.add_argument("--nonce", required=True); ap.add_argument("--dry-run", action="store_true"); ap.add_argument("--request-log")
    a = ap.parse_args(); n12 = a.nonce[:12]; pre = P.prefix(n12)
    ph = P.PostHog(log=open(a.request_log, "a") if a.request_log else None); ph.guard(quiet=True)
    snap = ST.snapshot(ph, n12)
    plan = [("annotations/", "content", snap["annotations"]), ("insights/", "name", snap["insights"]),
            ("dashboards/", "name", snap["dashboards"]), ("feature_flags/", "key", snap["flags"]), ("surveys/", "name", snap.get("surveys", []))]
    deleted = failed = 0
    for rel, field, rows in plan:
        for r in rows:
            ph.require_prefixed(r[field], n12)  # second check, independent of the listing filter
            if a.dry_run:
                print("would delete %s%s  %s" % (rel, r["id"], r[field])); continue
            done = (ph.delete("%s%s/" % (rel, r["id"]))[0] < 300) if rel == "surveys/" else SEED.soft_delete(ph, rel, r["id"])
            if done: deleted += 1
            else: failed += 1; print("FAILED to delete %s%s" % (rel, r["id"]))
    left = ST.snapshot(ph, n12) if not a.dry_run else snap
    remaining = sum(len(left.get(k, [])) for k in ("insights", "dashboards", "flags", "annotations", "surveys"))
    print("cleanup prefix=%s deleted=%d failed=%d remaining=%d requests=%d%s" % (pre, deleted, failed, remaining, ph.requests, " (dry run)" if a.dry_run else ""))
    sp = SEED.state_path(n12)
    if not a.dry_run and remaining == 0 and os.path.exists(sp):
        os.replace(sp, sp + ".cleaned")  # the series is over; keep the record, free the name
    sys.exit(0 if (a.dry_run or (failed == 0 and remaining == 0)) else 1)


if __name__ == "__main__":
    main()
