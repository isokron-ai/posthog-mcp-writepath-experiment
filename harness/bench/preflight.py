"""Read-only preflight: one GET of the configured project. Exit 0 only if the key resolves to POSTHOG_PROJECT_ID
in organization EXPECTED_ORG_ID. usage: python3 -I -B bench/preflight.py [--inventory]"""
import os, sys
sys.dont_write_bytecode = True
sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "lib"))
import ph as P

ph = P.PostHog()
ph.guard()
if "--inventory" in sys.argv:  # read-only counts of what already lives in the project
    for rel, label in (("insights/", "insights"), ("dashboards/", "dashboards"), ("feature_flags/", "feature flags"), ("annotations/", "annotations"), ("event_definitions/", "event definitions")):
        code, r = ph.get(rel, {"limit": 5})
        names = [str(x.get("name") or x.get("key") or x.get("content"))[:40] for x in (r or {}).get("results", [])] if isinstance(r, dict) else []
        print("  %-18s HTTP %s count=%s first=%s" % (label, code, (r or {}).get("count") if isinstance(r, dict) else None, names))
print("requests made: %d" % ph.requests)
