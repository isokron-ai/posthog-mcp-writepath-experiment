"""Task k (friction-derived): insert $pageview as the first funnel step, set the date range to -30d and rename the seeded
funnel; breakdown, conversion window, test-account filter, existing steps, description and tags unchanged; same object."""
import os, sys
sys.dont_write_bytecode = True
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import _lib as L

KEPT_KEYS = ("breakdownFilter", "funnelsFilter", "filterTestAccounts")
# PostHog's documented defaults for FunnelsFilter (frontend/src/queries/schema/schema-general.ts, `@default` tags at the
# pinned commit). PostHog fills these in when an insight is saved, on every build (dry run 2026-11-10, runs d004-d006);
# a key holding its default is treated as absent, so only a real change to the funnel settings counts.
FUNNELS_FILTER_DEFAULTS = {"exclusions": [], "layout": "vertical", "breakdownAttributionType": "first_touch", "funnelOrderType": "ordered",
                           "funnelVizType": "steps", "funnelWindowInterval": 14, "funnelWindowIntervalUnit": "day", "funnelStepReference": "total",
                           "showLegend": False, "legendPosition": "bottom", "showValuesOnSeries": False, "showAnnotations": True,
                           "hideIncompleteConversionWindowPeriods": False}


def _kept(src, key):
    v = src.get(key)
    if key == "funnelsFilter":
        return {k: x for k, x in (v or {}).items() if FUNNELS_FILTER_DEFAULTS.get(k, object()) != x}
    if key == "filterTestAccounts":
        return bool(v)
    return v


def evaluate(live, base, ctx):
    P = ctx["P"]; old, new = P + "signup-funnel", P + "signup-funnel-3-step"
    seed = base["normalized"]["insights"][old][0]; seed_id = base["ids"]["insights"][old]["id"]
    norm = L.ST.normalize(live)["insights"]
    c, info = {}, {}
    rows = [r for r in live["insights"] if r["name"] == new]
    c["renamed_insight_exactly_one"] = len(rows) == 1
    c["old_name_gone"] = not any(r["name"] == old for r in live["insights"])
    c["same_object_not_recreated"] = bool(rows) and rows[0]["id"] == seed_id
    cur = (norm.get(new) or [{}])[0]
    src, was = L.source(cur.get("query")), L.source(seed["query"])
    ser = src.get("series") or []
    info["series"] = ser; info["dateRange"] = src.get("dateRange")
    c["still_a_funnel"] = src.get("kind") == "FunnelsQuery" and (cur.get("query") or {}).get("kind") == (seed["query"] or {}).get("kind")
    c["three_steps_in_order"] = [s.get("event") for s in ser] == ["$pageview", "signup_started", "signup_completed"]
    # a step's `name` is only its display label (the seed sets it to the event); everything else about the two old steps must hold
    step = lambda s: {k: v for k, v in (s or {}).items() if k != "name"}
    c["existing_steps_unchanged"] = len(ser) == 3 and [step(s) for s in ser[1:]] == [step(s) for s in was["series"]]
    dr = src.get("dateRange") or {}
    c["date_range_last_30_days"] = dr.get("date_from") == "-30d" and not dr.get("date_to")
    c["breakdown_window_and_filters_unchanged"] = all(_kept(src, k) == _kept(was, k) for k in KEPT_KEYS)
    info["kept_keys_differing"] = [k for k in KEPT_KEYS if _kept(src, k) != _kept(was, k)]
    c["description_tags_dashboards_unchanged"] = (cur.get("description") == seed["description"] and cur.get("tags") == seed["tags"]
                                                 and cur.get("dashboards") == seed["dashboards"])
    bad = L.collateral(live, base, skip={"insights:" + old}, allow_extra={"insights:" + new})
    c["nothing_else_changed"] = not bad; info["collateral"] = bad
    return c, info


if __name__ == "__main__":
    sys.exit(L.run("k-funnel-step-edit", evaluate))
