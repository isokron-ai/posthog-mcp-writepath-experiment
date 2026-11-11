"""Task h (friction-derived): add a run-tagged tag to the ten legacy insights (keeping their tags, nothing else changed) and
create eight project-wide annotations with exact texts and times, one each."""
import datetime, os, sys
from collections import Counter
sys.dont_write_bytecode = True
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import _lib as L

NOTES = (("2026-10-01T09:00:00Z", "release 3.0.0"), ("2026-10-03T09:00:00Z", "release 3.0.1"), ("2026-10-07T14:30:00Z", "pricing page launched"),
         ("2026-10-09T09:00:00Z", "release 3.1.0"), ("2026-10-15T08:00:00Z", "EU data region live"), ("2026-10-21T09:00:00Z", "release 3.2.0"),
         ("2026-10-28T16:00:00Z", "onboarding emails paused"), ("2026-11-04T09:00:00Z", "release 3.3.0"))


def _ts(s):
    try:
        d = datetime.datetime.fromisoformat(str(s).replace("Z", "+00:00"))
        return d if d.tzinfo else d.replace(tzinfo=datetime.timezone.utc)
    except ValueError:
        return None


def evaluate(live, base, ctx):
    P, R = ctx["P"], ctx["run_tag"]; new_tag = "%s%s-retired" % (P, R)
    want = base["normalized"]["insights"]; norm = L.ST.normalize(live)["insights"]
    legacy = sorted(n for n in want if n.startswith(P + "legacy-"))
    cur = lambda n: (norm.get(n) or [{}])[0]
    c, info = {}, {"legacy": legacy, "tags_now": {n: cur(n).get("tags") for n in legacy}}
    c["ten_legacy_insights_present_once"] = len(legacy) == 10 and all(len(norm.get(n, [])) == 1 for n in legacy)
    c["legacy_have_new_tag"] = all(new_tag in (cur(n).get("tags") or []) for n in legacy)
    c["legacy_tags_exact"] = all(sorted(cur(n).get("tags") or []) == sorted(want[n][0]["tags"] + [new_tag]) for n in legacy)
    rest = lambda d: {k: v for k, v in d.items() if k != "tags"}
    c["legacy_other_fields_unchanged"] = all(rest(cur(n)) == rest(want[n][0]) for n in legacy)
    c["same_objects_not_recreated"] = all(any(r["name"] == n and r["id"] == base["ids"]["insights"][n]["id"] for r in live["insights"]) for n in legacy)
    mine = [a for a in live["annotations"] if a["content"].startswith(P + R + " ")]
    info["annotations"] = [{k: a.get(k) for k in ("id", "content", "date_marker", "scope", "dashboard_id", "dashboard_item")} for a in mine]
    expected = Counter("%s%s %s" % (P, R, text) for _, text in NOTES)
    have = Counter(a["content"] for a in mine)
    c["eight_annotations_one_each"] = have == expected
    when = {"%s%s %s" % (P, R, text): _ts(t) for t, text in NOTES}
    c["annotation_times_exact"] = bool(mine) and all(_ts(a.get("date_marker")) == when.get(a["content"]) for a in mine)
    c["annotations_project_wide"] = bool(mine) and all(a.get("scope") == "project" and not a.get("dashboard_id") and not a.get("dashboard_item") for a in mine)
    bad = L.collateral(live, base, skip={"insights:" + n for n in legacy}, allow_extra={"annotations:" + x for x in expected})
    c["nothing_else_changed"] = not bad; info["collateral"] = bad
    return c, info


if __name__ == "__main__":
    sys.exit(L.run("h-bulk-tag-annotate", evaluate))
