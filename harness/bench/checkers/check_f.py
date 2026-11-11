"""Task f: add a second tag to the three triage insights carrying the review tag, keep their existing tags, leave the rest untouched."""
import os, re, sys
sys.dont_write_bytecode = True
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import _lib as L


def evaluate(live, base, ctx):
    P = ctx["P"]; new_tag = P + "triaged"; review = P + "needs-review"
    want = base["normalized"]["insights"]; norm = L.ST.normalize(live)["insights"]
    triage = sorted(n for n in want if n.startswith(P + "triage-"))
    targets = sorted(n for n in triage if review in want[n][0]["tags"])
    c, info = {}, {"targets": targets, "tags_now": {n: (norm.get(n) or [{}])[0].get("tags") for n in triage}}
    c["all_triage_insights_present_once"] = all(len(norm.get(n, [])) == 1 for n in triage)
    cur = lambda n: (norm.get(n) or [{}])[0]
    c["targets_have_new_tag"] = all(new_tag in (cur(n).get("tags") or []) for n in targets)
    c["targets_kept_existing_tags"] = all(set(want[n][0]["tags"]) <= set(cur(n).get("tags") or []) for n in targets)
    c["targets_tags_exact"] = all(sorted(cur(n).get("tags") or []) == sorted(want[n][0]["tags"] + [new_tag]) for n in targets)
    c["non_targets_tags_unchanged"] = all(cur(n).get("tags") == want[n][0]["tags"] for n in triage if n not in targets)
    rest = lambda d: {k: v for k, v in d.items() if k != "tags"}
    c["triage_other_fields_unchanged"] = all(rest(cur(n)) == rest(want[n][0]) for n in triage)
    c["same_objects_not_recreated"] = all(any(r["name"] == n and r["id"] == base["ids"]["insights"][n]["id"] for r in live["insights"]) for n in triage)
    rep = sorted(m.group(1).strip() for l in L.answer_lines(ctx["answer"]) for m in [re.match(r"^CHANGED\s*:\s*(\S+)\s*$", l)] if m)
    info["reported_changed"] = rep
    c["report_matches_targets"] = rep == targets
    bad = L.collateral(live, base, skip={"insights:" + n for n in triage})
    c["nothing_else_changed"] = not bad; info["collateral"] = bad
    return c, info


if __name__ == "__main__":
    sys.exit(L.run("f-tag-triage", evaluate))
