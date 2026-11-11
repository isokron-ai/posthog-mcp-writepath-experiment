"""Read the benchmark-owned objects of the test project (read-only) and reduce them to a comparable form.
snapshot(ph, n12) -> raw rows of every non-deleted object whose name/key/content starts with bench-<n12>-
                     (surveys: every survey with the prefix, archived ones included, since archiving is not deleting)
normalize(snap)   -> ids, timestamps and server bookkeeping removed; this is what the state hash covers.
                     `surveys` appears only when the snapshot holds a prefixed survey, so a fixture set without surveys
                     (v1) normalizes exactly as it did before surveys were added."""
import hashlib, json

# server-generated bookkeeping inside feature flag filters (regenerated when a flag is recreated)
FLAG_FILTER_DROP = {"condition_id", "sort_key"}
# server-generated bookkeeping inside survey questions (ids are assigned by the server)
SURVEY_QUESTION_DROP = {"id"}


def canon(o):
    return json.dumps(o, sort_keys=True, separators=(",", ":"), ensure_ascii=False)


def sha(o):
    return hashlib.sha256(canon(o).encode("utf-8")).hexdigest()


def _flag_filters(filters):
    # `early_exit: false` is PostHog's default (absent means the same). Some MCP tool schemas fill it in on every save, and
    # once stored PostHog keeps it even when a later PATCH of `filters` leaves it out, so it is dropped here when false.
    # A true value is kept (it changes evaluation) and the reset restores it to false explicitly.
    out = _strip(filters, FLAG_FILTER_DROP)
    if out.get("early_exit") is False:
        out = {k: v for k, v in out.items() if k != "early_exit"}
    return out


def _strip(o, drop):
    if isinstance(o, dict):
        return {k: _strip(v, drop) for k, v in o.items() if k not in drop}
    if isinstance(o, list):
        return [_strip(v, drop) for v in o]
    return o


def snapshot(ph, n12):
    P = "bench-%s-" % n12
    out = {"n12": n12, "errors": []}
    for kind, rel, field in (("insights", "insights/", "name"), ("dashboards", "dashboards/", "name"),
                             ("flags", "feature_flags/", "key"), ("annotations", "annotations/", "content")):
        ok, rows = ph.list_all(rel, {"search": P, "limit": 200})
        if not ok:
            out["errors"].append("list %s failed" % kind)
        out[kind] = [r for r in rows if isinstance(r.get(field), str) and r[field].startswith(P) and not r.get("deleted")]
    ok, rows = ph.list_all("surveys/", {"search": P, "limit": 200})
    if not ok:
        out["errors"].append("list surveys failed")
    out["surveys"] = [r for r in rows if isinstance(r.get("name"), str) and r["name"].startswith(P)]
    # tiles live on the dashboard detail
    out["dashboard_tiles"] = {}
    for d in out["dashboards"]:
        code, det = ph.get("dashboards/%s/" % d["id"])
        if code != 200 or not isinstance(det, dict):
            out["errors"].append("dashboard %s detail HTTP %s" % (d["id"], code)); continue
        tiles = []
        for t in det.get("tiles") or []:
            if t.get("deleted"):
                continue
            ins = t.get("insight")
            if ins and not ins.get("deleted"):
                tiles.append({"insight_id": ins.get("id"), "insight_name": ins.get("name")})
            elif t.get("text"):
                tiles.append({"text": (t["text"] or {}).get("body")})
        out["dashboard_tiles"][str(d["id"])] = tiles
    return out


def insight_dashboard_ids(row):
    tiles = row.get("dashboard_tiles")
    if isinstance(tiles, list):
        return sorted(t.get("dashboard_id") for t in tiles if not t.get("deleted") and t.get("dashboard_id") is not None)
    return sorted(row.get("dashboards") or [])


def normalize(snap):
    dname = {d["id"]: d["name"] for d in snap["dashboards"]}
    ins = {}
    for r in snap["insights"]:
        ins.setdefault(r["name"], []).append({
            "description": r.get("description") or "", "tags": sorted(r.get("tags") or []), "query": r.get("query"),
            "favorited": bool(r.get("favorited")),
            "dashboards": sorted(dname.get(i, "id:%s" % i) for i in insight_dashboard_ids(r))})
    dash = {}
    for d in snap["dashboards"]:
        tiles = snap["dashboard_tiles"].get(str(d["id"]), [])
        dash.setdefault(d["name"], []).append({
            "description": d.get("description") or "", "tags": sorted(d.get("tags") or []), "pinned": bool(d.get("pinned")),
            "tiles": sorted((t.get("insight_name") or "text:%s" % t.get("text")) for t in tiles)})
    flags = {}
    for f in snap["flags"]:
        flags.setdefault(f["key"], []).append({
            "name": f.get("name") or "", "active": bool(f.get("active")), "filters": _flag_filters(f.get("filters") or {}),
            "tags": sorted(f.get("tags") or [])})
    out = {"insights": ins, "dashboards": dash, "flags": flags, "annotations": sorted(a["content"] for a in snap["annotations"])}
    if snap.get("surveys"):
        sv = {}
        for r in snap["surveys"]:
            sv.setdefault(r["name"], []).append({
                "description": r.get("description") or "", "type": r.get("type"), "archived": bool(r.get("archived")),
                "questions": [_strip(q, SURVEY_QUESTION_DROP) for q in (r.get("questions") or [])]})
        out["surveys"] = sv
    return out


def ids(snap):
    return {"insights": {r["name"]: {"id": r["id"], "short_id": r.get("short_id")} for r in snap["insights"]},
            "dashboards": {d["name"]: d["id"] for d in snap["dashboards"]},
            "flags": {f["key"]: f["id"] for f in snap["flags"]},
            "annotations": {a["content"]: a["id"] for a in snap["annotations"]},
            "surveys": {r["name"]: r["id"] for r in snap.get("surveys", [])}}
