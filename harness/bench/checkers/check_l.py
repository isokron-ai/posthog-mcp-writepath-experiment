"""Task l (friction-derived): delete the 12 seeded scratch objects whose name or text starts with bench-<n12>-tmp-
(6 insights, 1 dashboard, 5 annotations); the near-miss template tmpl-weekly and everything else unchanged; the DELETED: line
equals 12."""
import os, re, sys
sys.dont_write_bytecode = True
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import _lib as L

EXPECTED_DELETED = 12


def evaluate(live, base, ctx):
    P = ctx["P"]; pre = P + "tmp-"
    want = base["normalized"]
    tmp = {"insights": sorted(n for n in want["insights"] if n.startswith(pre)), "dashboards": sorted(n for n in want["dashboards"] if n.startswith(pre)),
           "annotations": sorted(a for a in want["annotations"] if a.startswith(pre))}
    c, info = {}, {"seeded_tmp": {k: len(v) for k, v in tmp.items()}}
    c["fixture_has_the_twelve"] = sum(len(v) for v in tmp.values()) == EXPECTED_DELETED
    left = {"insights": [r["name"] for r in live["insights"] if r["name"].startswith(pre)],
            "dashboards": [d["name"] for d in live["dashboards"] if d["name"].startswith(pre)],
            "annotations": [a["content"] for a in live["annotations"] if a["content"].startswith(pre)]}
    info["left"] = left
    c["tmp_insights_gone"] = not left["insights"]
    c["tmp_dashboard_gone"] = not left["dashboards"]
    c["tmp_annotations_gone"] = not left["annotations"]
    norm = L.ST.normalize(live)
    c["template_kept"] = norm["insights"].get(P + "tmpl-weekly") == want["insights"][P + "tmpl-weekly"]
    lines = [m.group(1) for l in L.answer_lines(ctx["answer"]) for m in [re.match(r"^DELETED\s*:\s*(\d+)\s*$", l)] if m]
    info["reported"] = lines
    c["deleted_line_present_once"] = len(lines) == 1
    c["reported_count_matches"] = lines == [str(EXPECTED_DELETED)]
    skip = {"insights:" + n for n in tmp["insights"]} | {"dashboards:" + n for n in tmp["dashboards"]} | {"annotations:" + a for a in tmp["annotations"]}
    bad = L.collateral(live, base, skip=skip)
    c["nothing_else_changed"] = not bad; info["collateral"] = bad
    return c, info


if __name__ == "__main__":
    sys.exit(L.run("l-cleanup", evaluate))
