"""Task g (friction-derived): a new dashboard with five insights attached: daily trend, three-step funnel, weekly retention,
a HogQL table and a weekly unique-users trend. The tile order is not checked (the prompt says it does not matter)."""
import os, re, sys
sys.dont_write_bytecode = True
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import _lib as L

SQL = "SELECT event, count() AS total FROM events WHERE timestamp > now() - INTERVAL 7 DAY GROUP BY event ORDER BY total DESC LIMIT 10"
# PostHog's own insight-create instructions (all three builds) tell the agent to replace a fixed date window in a saved
# SQL insight with the {filters} placeholder and put the window in the query's dateRange. That form is accepted too, but
# only with the same 7-day window and no end date (dry run 2026-11-10, run d013).
SQL_PLACEHOLDER = "SELECT event, count() AS total FROM events WHERE {filters} GROUP BY event ORDER BY total DESC LIMIT 10"


def _event(node):
    return node.get("event") if isinstance(node, dict) else None


def _entity(e):
    return (e or {}).get("id") or (e or {}).get("name")


def _sql(text):
    """Whitespace collapsed, case folded, a trailing semicolon dropped: the same query typed differently compares equal."""
    return re.sub(r"\s+", " ", str(text or "")).strip().rstrip(";").strip().lower()


def hogql_source(query):
    """The HogQLQuery inside an insight (DataVisualizationNode / DataTableNode wrap it in `source`), or {}."""
    q = query if isinstance(query, dict) else {}
    if q.get("kind") in ("DataVisualizationNode", "DataTableNode", "InsightVizNode") and isinstance(q.get("source"), dict):
        q = q["source"]
    return q if q.get("kind") == "HogQLQuery" else {}


def evaluate(live, base, ctx):
    P, R = ctx["P"], ctx["run_tag"]
    dn = "%s%s-product-overview" % (P, R)
    names = {k: "%s%s-%s" % (P, R, s) for k, s in (("trend", "daily-signups"), ("funnel", "signup-funnel"), ("retention", "signup-retention"),
                                                    ("sql", "top-events"), ("visitors", "weekly-visitors"))}
    c, info = {}, {}
    dash = [d for d in live["dashboards"] if d["name"] == dn]
    c["dashboard_exactly_one"] = len(dash) == 1
    c["dashboard_description"] = bool(dash) and (dash[0].get("description") or "").strip() == "Signups, conversion and retention"
    tiles = live["dashboard_tiles"].get(str(dash[0]["id"]), []) if dash else []
    tile_names = sorted(t.get("insight_name") or "" for t in tiles if "insight_id" in t)
    info["tile_insights"] = tile_names
    c["dashboard_has_exactly_the_five_insights"] = tile_names == sorted(names.values())
    by = {}
    for r in live["insights"]:
        by.setdefault(r["name"], []).append(r)
    c["each_insight_exactly_once"] = all(len(by.get(n, [])) == 1 for n in names.values())
    raw = {k: by[n][0].get("query") if by.get(n) else {} for k, n in names.items()}
    q = {k: L.source(v) for k, v in raw.items()}
    info["kinds"] = {k: v.get("kind") for k, v in q.items()}
    t = q["trend"]; ser = t.get("series") or []
    c["trend_query"] = (t.get("kind") == "TrendsQuery" and len(ser) == 1 and _event(ser[0]) == "signup_completed"
                        and ser[0].get("math") in (None, "total") and t.get("interval") in (None, "day")
                        and (t.get("dateRange") or {}).get("date_from") == "-30d")
    f = q["funnel"]
    c["funnel_query"] = f.get("kind") == "FunnelsQuery" and [_event(s) for s in (f.get("series") or [])] == ["$pageview", "signup_started", "signup_completed"]
    r = q["retention"]; rf = r.get("retentionFilter") or {}
    c["retention_query"] = (r.get("kind") == "RetentionQuery" and _entity(rf.get("targetEntity")) == "signup_completed"
                            and _entity(rf.get("returningEntity")) == "app_opened" and rf.get("period") == "Week")
    h = hogql_source(raw["sql"])
    info["sql"] = h.get("query")
    dr = ((h.get("filters") or {}).get("dateRange") or {}) if h else {}
    info["sql_date_range"] = dr or None
    c["sql_query"] = bool(h) and (_sql(h.get("query")) == _sql(SQL) or
                                  (_sql(h.get("query")) == _sql(SQL_PLACEHOLDER) and dr.get("date_from") == "-7d" and not dr.get("date_to")))
    v = q["visitors"]; vs = v.get("series") or []
    c["weekly_visitors_query"] = (v.get("kind") == "TrendsQuery" and len(vs) == 1 and _event(vs[0]) == "$pageview" and vs[0].get("math") == "dau"
                                  and v.get("interval") == "week" and (v.get("dateRange") or {}).get("date_from") == "-90d")
    allow = {"dashboards:" + dn} | {"insights:" + n for n in names.values()}
    bad = L.collateral(live, base, allow_extra=allow)
    c["nothing_else_changed"] = not bad; info["collateral"] = bad
    return c, info


if __name__ == "__main__":
    sys.exit(L.run("g-dashboard-five-tiles", evaluate))
