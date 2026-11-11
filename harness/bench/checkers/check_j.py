"""Task j (friction-derived): change the text of the second question of the seeded survey; the other questions, the order,
the choices and the survey's other settings must be unchanged; same survey, not archived."""
import os, sys
sys.dont_write_bytecode = True
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import _lib as L

NEW_TEXT = "Which feature did you use first?"


def evaluate(live, base, ctx):
    P = ctx["P"]; name = P + "onboarding-survey"
    seed = base["normalized"]["surveys"][name][0]; seed_id = base["ids"]["surveys"][name]
    norm = L.ST.normalize(live).get("surveys", {})
    c, info = {}, {}
    rows = [s for s in live.get("surveys", []) if s["name"] == name]
    c["survey_exactly_one"] = len(rows) == 1
    c["same_object_not_recreated"] = bool(rows) and rows[0]["id"] == seed_id
    cur = (norm.get(name) or [{}])[0]
    qs = cur.get("questions") or []
    info["questions"] = qs
    c["three_questions"] = len(qs) == 3
    c["second_question_text"] = len(qs) > 1 and qs[1].get("question") == NEW_TEXT
    others = lambda q: {k: v for k, v in q.items() if k != "question"}
    c["second_question_otherwise_unchanged"] = len(qs) > 1 and others(qs[1]) == others(seed["questions"][1])
    c["first_and_third_unchanged"] = len(qs) == 3 and qs[0] == seed["questions"][0] and qs[2] == seed["questions"][2]
    c["not_archived"] = cur.get("archived") is False
    c["survey_settings_unchanged"] = bool(cur) and cur.get("description") == seed["description"] and cur.get("type") == seed["type"]
    bad = L.collateral(live, base, skip={"surveys:" + name})
    c["nothing_else_changed"] = not bad; info["collateral"] = bad
    return c, info


if __name__ == "__main__":
    sys.exit(L.run("j-survey-edit-question", evaluate))
