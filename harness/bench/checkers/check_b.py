"""Task b: rename one seeded insight and change its description; its query and every other field must be identical to the seed."""
import os, sys
sys.dont_write_bytecode = True
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import _lib as L

NEW_DESC = "Weekly unique signups, broken down by browser. Owner: growth team."


def evaluate(live, base, ctx):
    P = ctx["P"]; old, new = P + "weekly-signups", P + "weekly-signups-by-browser"
    seed = base["normalized"]["insights"][old][0]; seed_id = base["ids"]["insights"][old]["id"]
    norm = L.ST.normalize(live)
    c, info = {}, {}
    rows = [r for r in live["insights"] if r["name"] == new]
    c["renamed_insight_exactly_one"] = len(rows) == 1
    c["old_name_gone"] = not any(r["name"] == old for r in live["insights"])
    c["same_object_not_recreated"] = bool(rows) and rows[0]["id"] == seed_id
    cur = norm["insights"].get(new, [{}])[0]
    c["description_updated"] = cur.get("description") == NEW_DESC
    c["query_byte_identical"] = bool(cur) and L.ST.canon(cur.get("query")) == L.ST.canon(seed["query"])
    c["tags_identical"] = cur.get("tags") == seed["tags"]
    c["dashboards_identical"] = cur.get("dashboards") == seed["dashboards"]
    c["favorited_identical"] = cur.get("favorited") == seed["favorited"]
    if cur and not c["query_byte_identical"]:
        a, b = L.source(cur.get("query")), L.source(seed["query"])
        info["query_keys_differing"] = sorted(k for k in set(a) | set(b) if a.get(k) != b.get(k))
    board = P + "release-board"
    b_now, b_seed = (norm["dashboards"].get(board) or [{}])[0], base["normalized"]["dashboards"][board][0]
    c["board_still_shows_it_and_is_otherwise_unchanged"] = (b_now.get("tiles") == [new if t == old else t for t in b_seed["tiles"]]
                                                           and {k: v for k, v in b_now.items() if k != "tiles"} == {k: v for k, v in b_seed.items() if k != "tiles"})
    bad = L.collateral(live, base, skip={"insights:" + old, "dashboards:" + board}, allow_extra={"insights:" + new})
    c["nothing_else_changed"] = not bad; info["collateral"] = bad
    return c, info


if __name__ == "__main__":
    sys.exit(L.run("b-insight-rename", evaluate))
