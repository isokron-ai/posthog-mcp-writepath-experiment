"""Task a: a new dashboard with three insights (trend, funnel, retention) attached."""
import os, sys
sys.dont_write_bytecode = True
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import _lib as L


def _event(node):
    return node.get("event") if isinstance(node, dict) else None


def _entity(e):
    return (e or {}).get("id") or (e or {}).get("name")


def evaluate(live, base, ctx):
    P, R = ctx["P"], ctx["run_tag"]
    dn = "%s%s-growth-overview" % (P, R)
    names = {"trend": "%s%s-signups-trend" % (P, R), "funnel": "%s%s-signup-funnel" % (P, R), "retention": "%s%s-signup-retention" % (P, R)}
    c, info = {}, {}
    dash = [d for d in live["dashboards"] if d["name"] == dn]
    c["dashboard_exactly_one"] = len(dash) == 1
    c["dashboard_description"] = bool(dash) and (dash[0].get("description") or "").strip() == "Signup flow health"
    tiles = live["dashboard_tiles"].get(str(dash[0]["id"]), []) if dash else []
    tile_names = sorted(t.get("insight_name") or "" for t in tiles if "insight_id" in t)
    info["tile_insights"] = tile_names
    c["dashboard_has_exactly_the_three_insights"] = tile_names == sorted(names.values())
    by = {}
    for r in live["insights"]:
        by.setdefault(r["name"], []).append(r)
    c["each_insight_exactly_once"] = all(len(by.get(n, [])) == 1 for n in names.values())
    q = {k: L.source(by[n][0].get("query")) if by.get(n) else {} for k, n in names.items()}
    info["kinds"] = {k: v.get("kind") for k, v in q.items()}
    t = q["trend"]; ser = t.get("series") or []
    c["trend_query"] = (t.get("kind") == "TrendsQuery" and len(ser) == 1 and _event(ser[0]) == "signup_completed"
                        and ser[0].get("math") in (None, "total") and t.get("interval") in (None, "day")
                        and (t.get("dateRange") or {}).get("date_from") == "-30d")
    f = q["funnel"]
    c["funnel_query"] = f.get("kind") == "FunnelsQuery" and [_event(s) for s in (f.get("series") or [])] == ["signup_started", "signup_completed"]
    r = q["retention"]; rf = r.get("retentionFilter") or {}
    c["retention_query"] = (r.get("kind") == "RetentionQuery" and _entity(rf.get("targetEntity")) == "signup_completed"
                            and _entity(rf.get("returningEntity")) == "app_opened" and rf.get("period") == "Week")
    info["retention_filter"] = rf
    allow = {"dashboards:" + dn} | {"insights:" + n for n in names.values()}
    bad = L.collateral(live, base, allow_extra=allow)
    c["nothing_else_changed"] = not bad; info["collateral"] = bad
    return c, info


if __name__ == "__main__":
    sys.exit(L.run("a-dashboard-three-insights", evaluate))
