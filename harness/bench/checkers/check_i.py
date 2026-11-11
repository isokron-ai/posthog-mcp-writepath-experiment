"""Task i (friction-derived): add the variant test-b to the seeded multivariate flag and split 34/33/33, keeping both release
conditions (filters and rollouts), the flag's state and the existing variants' names unchanged."""
import os, sys
sys.dont_write_bytecode = True
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import _lib as L

WANT = {"control": 34, "test": 33, "test-b": 33}


def evaluate(live, base, ctx):
    P = ctx["P"]; key = P + "checkout-banner"
    seed = base["normalized"]["flags"][key][0]; seed_id = base["ids"]["flags"][key]
    norm = L.ST.normalize(live)["flags"]
    c, info = {}, {}
    rows = [f for f in live["flags"] if f["key"] == key]
    c["flag_exactly_one"] = len(rows) == 1
    c["same_object_not_recreated"] = bool(rows) and rows[0]["id"] == seed_id
    cur = (norm.get(key) or [{}])[0]
    filt = cur.get("filters") or {}
    variants = (filt.get("multivariate") or {}).get("variants") or []
    info["variants"] = variants; info["groups"] = filt.get("groups")
    c["variants_exact"] = {v.get("key"): v.get("rollout_percentage") for v in variants} == WANT and len(variants) == 3
    seed_names = {v["key"]: v.get("name") for v in seed["filters"]["multivariate"]["variants"]}
    c["existing_variant_names_unchanged"] = all(v.get("name") == seed_names[v.get("key")] for v in variants if v.get("key") in seed_names)
    c["release_conditions_unchanged"] = filt.get("groups") == seed["filters"]["groups"]
    c["flag_still_enabled"] = cur.get("active") is True
    c["name_and_tags_unchanged"] = cur.get("name") == seed["name"] and cur.get("tags") == seed["tags"]
    rest = lambda d: {k: v for k, v in d.items() if k not in ("groups", "multivariate")}
    c["other_filter_fields_unchanged"] = rest(filt) == rest(seed["filters"])
    bad = L.collateral(live, base, skip={"flags:" + key})
    c["nothing_else_changed"] = not bad; info["collateral"] = bad
    return c, info


if __name__ == "__main__":
    sys.exit(L.run("i-flag-add-variant", evaluate))
