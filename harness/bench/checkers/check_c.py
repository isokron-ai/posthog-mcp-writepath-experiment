"""Task c: create a flag (20% rollout, two person-property filters), then raise only the rollout to 60%; the filters must survive."""
import os, sys
sys.dont_write_bytecode = True
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import _lib as L


def _val(v):
    return v[0] if isinstance(v, list) and len(v) == 1 else v


def evaluate(live, base, ctx):
    key = "%s%s-new-checkout" % (ctx["P"], ctx["run_tag"])
    c, info = {}, {}
    rows = [f for f in live["flags"] if f["key"] == key]
    c["flag_exactly_one"] = len(rows) == 1
    f = rows[0] if rows else {}
    groups = (f.get("filters") or {}).get("groups") or []
    info["groups"] = groups
    c["flag_enabled"] = f.get("active") is True
    c["one_release_condition"] = len(groups) == 1
    g = groups[0] if groups else {}
    c["rollout_is_60"] = g.get("rollout_percentage") == 60
    props = {(p.get("key"), p.get("operator") or "exact", str(_val(p.get("value"))), p.get("type")) for p in (g.get("properties") or [])}
    c["email_filter_survived"] = ("email", "icontains", "@example.com", "person") in props
    c["plan_filter_survived"] = ("plan", "exact", "pro", "person") in props
    c["no_other_filters"] = len(g.get("properties") or []) == 2
    c["not_multivariate"] = not ((f.get("filters") or {}).get("multivariate") or {}).get("variants")
    bad = L.collateral(live, base, allow_extra={"flags:" + key})
    c["nothing_else_changed"] = not bad; info["collateral"] = bad
    return c, info


if __name__ == "__main__":
    sys.exit(L.run("c-flag-rollout-change", evaluate))
