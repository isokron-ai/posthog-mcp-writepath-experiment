"""Create or restore the seeded fixtures in the TEST project and verify the state hash. Idempotent: it repairs what differs.
  python3 -I -B seed/seed.py --nonce N12 --init [--fixtures v1|v2]   first seed of a series: create fixtures, record the expected
                                                    state hash and the fixture set (v1 = the pre-registered tasks' fixtures,
                                                    the default; v2 = v1 plus the friction-derived tasks' fixtures)
  python3 -I -B seed/seed.py --nonce N12 --reset    between runs: delete what a run created, restore what it changed, verify the hash
  python3 -I -B seed/seed.py --nonce N12 --check    read-only: compute the current hash and compare
Writes state/seed-<n12>.json (expected hash, normalized baseline, current object ids). Exit 0 only when the hash matches."""
import argparse, datetime, json, os, sys, time
sys.dont_write_bytecode = True
HERE = os.path.dirname(os.path.abspath(__file__)); ROOT = os.path.dirname(HERE)
sys.path.insert(0, os.path.join(ROOT, "lib")); sys.path.insert(0, HERE)
import ph as P
import spec as S
import state as ST


def state_path(n12):
    return os.path.join(ROOT, "state", "seed-%s.json" % n12)


def soft_delete(ph, rel, row_id):
    code, _ = ph.patch("%s%s/" % (rel, row_id), {"deleted": True})
    if code >= 400:
        code, _ = ph.delete("%s%s/" % (rel, row_id))
    return code < 400


def _instant(s):
    try:
        d = datetime.datetime.fromisoformat(str(s).replace("Z", "+00:00"))
        return d if d.tzinfo else d.replace(tzinfo=datetime.timezone.utc)
    except ValueError:
        return None


def ensure(ph, n12, base_norm=None, out=sys.stdout, fixtures="v1"):
    """One repair pass. Returns the number of write requests made."""
    sp = S.spec(n12, fixtures); pre = sp["prefix"]; writes = 0
    snap = ST.snapshot(ph, n12)
    if snap["errors"]:
        raise SystemExit("cannot read current state: %s" % snap["errors"])
    norm = ST.normalize(snap)
    same = lambda kind, name: base_norm is not None and norm.get(kind, {}).get(name) == base_norm.get(kind, {}).get(name)

    # annotations: the seeded ones (fixture set v2) are kept or restored; everything else with the prefix was made by a run
    want = {a["content"]: a for a in sp["annotations"]}
    have = set()
    for a in snap["annotations"]:
        ph.require_prefixed(a["content"], n12)
        w = want.get(a["content"])
        if w is not None and a["content"] not in have:
            have.add(a["content"])
            if _instant(a.get("date_marker")) != _instant(w["date_marker"]) or (a.get("scope") or "project") != w["scope"] or a.get("dashboard_id") or a.get("dashboard_item"):
                code, r = ph.patch("annotations/%s/" % a["id"], {"date_marker": w["date_marker"], "scope": w["scope"], "dashboard_id": None, "dashboard_item": None}); writes += 1
                if code >= 300: raise SystemExit("restore annotation %s failed: HTTP %s %s" % (a["content"], code, str(r)[:300]))
        else:
            soft_delete(ph, "annotations/", a["id"]); writes += 1
    for content, w in want.items():
        if content not in have:
            code, r = ph.post("annotations/", {"content": content, "date_marker": w["date_marker"], "scope": w["scope"]}); writes += 1
            if code >= 300: raise SystemExit("create annotation %s failed: HTTP %s %s" % (content, code, str(r)[:300]))
    # dashboards
    want = {d["name"]: d for d in sp["dashboards"]}
    have = {}
    for d in snap["dashboards"]:
        ph.require_prefixed(d["name"], n12)
        if d["name"] in want and d["name"] not in have:
            have[d["name"]] = d
        else:
            soft_delete(ph, "dashboards/", d["id"]); writes += 1
    dash_id = {}
    for name, d in want.items():
        body = {"name": name, "description": d["description"], "tags": d["tags"], "pinned": d["pinned"]}
        if name not in have:
            code, r = ph.post("dashboards/", body); writes += 1
            if code >= 300: raise SystemExit("create dashboard %s failed: HTTP %s %s" % (name, code, str(r)[:300]))
            dash_id[name] = r["id"]
        else:
            dash_id[name] = have[name]["id"]
            if not same("dashboards", name):
                code, r = ph.patch("dashboards/%s/" % dash_id[name], body); writes += 1
    # insights
    want = {i["name"]: i for i in sp["insights"]}
    have = {}
    for r in snap["insights"]:
        ph.require_prefixed(r["name"], n12)
        if r["name"] in want and r["name"] not in have:
            have[r["name"]] = r
        else:
            soft_delete(ph, "insights/", r["id"]); writes += 1
    for name, i in want.items():
        body = {"name": name, "description": i["description"], "tags": i["tags"], "query": i["query"],
                "dashboards": [dash_id[d] for d in i["dashboards"]], "favorited": False, "saved": True}
        if name not in have:
            code, r = ph.post("insights/", body); writes += 1
            if code >= 300: raise SystemExit("create insight %s failed: HTTP %s %s" % (name, code, str(r)[:300]))
        elif not same("insights", name):
            code, r = ph.patch("insights/%s/" % have[name]["id"], body); writes += 1
            if code >= 300: raise SystemExit("restore insight %s failed: HTTP %s %s" % (name, code, str(r)[:300]))
    # feature flags
    want = {f["key"]: f for f in sp["flags"]}
    have = {}
    for f in snap["flags"]:
        ph.require_prefixed(f["key"], n12)
        if f["key"] in want and f["key"] not in have:
            have[f["key"]] = f
        else:
            soft_delete(ph, "feature_flags/", f["id"]); writes += 1
    made = 0
    for key, f in want.items():
        body = {"key": key, "name": f["name"], "active": f["active"], "filters": f["filters"]}
        if key not in have:
            code, r = ph.post("feature_flags/", body); writes += 1; made += 1
            if code >= 300: raise SystemExit("create flag %s failed: HTTP %s %s" % (key, code, str(r)[:300]))
            if made % 20 == 0: print("  ... %d flags created" % made, file=out, flush=True)
        elif not same("flags", key):
            restore = {k: v for k, v in body.items() if k != "key"}
            restore["filters"] = {**restore["filters"], "early_exit": False}  # PostHog keeps a stored early_exit unless it is sent
            code, r = ph.patch("feature_flags/%s/" % have[key]["id"], restore); writes += 1
            if code >= 300: raise SystemExit("restore flag %s failed: HTTP %s %s" % (key, code, str(r)[:300]))
    # surveys (fixture set v2). PostHog's DELETE on a survey is a hard delete (the survey has no soft-delete field; a PATCH
    # with deleted=true would be ignored), so a survey a run made is deleted that way; a seeded one is restored by PATCH.
    want = {v["name"]: v for v in sp["surveys"]}
    have = {}
    for v in snap.get("surveys", []):
        ph.require_prefixed(v["name"], n12)
        if v["name"] in want and v["name"] not in have:
            have[v["name"]] = v
        else:
            code, r = ph.delete("surveys/%s/" % v["id"]); writes += 1
            if code >= 300: raise SystemExit("delete survey %s failed: HTTP %s %s" % (v["name"], code, str(r)[:300]))
    for name, v in want.items():
        body = {"name": name, "description": v["description"], "type": v["type"], "questions": v["questions"]}
        if name not in have:
            code, r = ph.post("surveys/", body); writes += 1
            if code >= 300: raise SystemExit("create survey %s failed: HTTP %s %s" % (name, code, str(r)[:300]))
        elif not same("surveys", name):
            code, r = ph.patch("surveys/%s/" % have[name]["id"], dict(body, archived=False)); writes += 1
            if code >= 300: raise SystemExit("restore survey %s failed: HTTP %s %s" % (name, code, str(r)[:300]))
    return writes


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--nonce", required=True)
    g = ap.add_mutually_exclusive_group(required=True)
    g.add_argument("--init", action="store_true"); g.add_argument("--reset", action="store_true"); g.add_argument("--check", action="store_true")
    ap.add_argument("--request-log"); ap.add_argument("--fixtures", choices=S.FIXTURE_SETS, help="--init only: the fixture set (default v1)")
    a = ap.parse_args()
    n12 = a.nonce[:12]; P.prefix(n12)
    log = open(a.request_log, "a") if a.request_log else None
    ph = P.PostHog(log=log); ph.guard(quiet=True)
    sp_path = state_path(n12)
    st = json.load(open(sp_path)) if os.path.exists(sp_path) else None
    if a.init and st:
        raise SystemExit("state/seed-%s.json already exists: this series is already seeded (use --reset or --check)" % n12)
    if (a.reset or a.check) and not st:
        raise SystemExit("state/seed-%s.json not found: run --init first" % n12)
    if a.fixtures and not a.init:
        raise SystemExit("--fixtures is for --init only (--reset and --check use the set recorded in the state file)")
    fixtures = (a.fixtures or "v1") if a.init else st.get("fixtures", "v1")
    writes = 0
    if a.init:
        writes += ensure(ph, n12, fixtures=fixtures)
    elif a.reset:
        writes += ensure(ph, n12, st["normalized"], fixtures=fixtures)
    snap = ST.snapshot(ph, n12); norm = ST.normalize(snap); h = ST.sha(norm)
    if a.reset and h != st["expected_sha256"]:  # one more repair pass, then give up
        writes += ensure(ph, n12, st["normalized"], fixtures=fixtures)
        snap = ST.snapshot(ph, n12); norm = ST.normalize(snap); h = ST.sha(norm)
    if a.init:
        sp = S.spec(n12, fixtures)
        counts = {k: sum(len(v) for v in norm.get(k, {}).values()) for k in ("insights", "dashboards", "flags", "surveys")}
        counts["annotations"] = len(norm["annotations"])
        want = {k: len(sp[k]) for k in ("insights", "dashboards", "flags", "surveys", "annotations")}
        if counts != want or sorted(norm["annotations"]) != sorted(a_["content"] for a_ in sp["annotations"]) or snap["errors"]:
            raise SystemExit("seed incomplete: have %s want %s errors %s" % (counts, want, snap["errors"]))
        tags_ok = all(sorted(i["tags"]) == norm["insights"][i["name"]][0]["tags"] for i in sp["insights"])
        if not tags_ok:
            raise SystemExit("seed created the insights but their tags did not persist (tagging may not be available on this plan): task f cannot run")
        st = {"n12": n12, "created_at": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()), "expected_sha256": h, "normalized": norm}
        if fixtures != "v1":
            st["fixtures"] = fixtures
    match = h == st["expected_sha256"]
    if not a.check:
        st["ids"] = ST.ids(snap); st["ids_at"] = time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())
        os.makedirs(os.path.dirname(sp_path), exist_ok=True)
        tmp = sp_path + ".tmp"
        with open(tmp, "w") as f:
            json.dump(st, f, indent=1, sort_keys=True); f.write("\n")
        os.replace(tmp, sp_path)
    print("mode=%s n12=%s fixtures=%s writes=%d requests=%d state_sha256=%s expected=%s match=%s" % (
        "init" if a.init else "reset" if a.reset else "check", n12, fixtures, writes, ph.requests, h, st["expected_sha256"], match))
    sys.exit(0 if match else 1)


if __name__ == "__main__":
    main()
