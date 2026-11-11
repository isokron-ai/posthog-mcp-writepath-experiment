"""The seeded fixture set, as a pure function of the 12-hex nonce. Everything carries the prefix bench-<n12>-.
  spec(n12)                 fixture set v1: what the six pre-registered tasks (a-f) use, unchanged since 2026-11-10
  spec(n12, fixtures="v2")  v1 plus the fixtures of the six friction-derived tasks (g-l); v1's objects are identical in both
A seed state file records which set it was made with (`fixtures`; absent = v1), so --reset always restores that set."""
N_FLAGS = 120
# disabled flags are spread so that any page boundary (50, 100) leaves disabled flags on both sides
DISABLED_FLAGS = (4, 19, 33, 47, 61, 78, 96, 109, 117)
TRIAGE_TAGS = {1: ["needs-review", "growth"], 2: ["growth"], 3: ["needs-review"], 4: ["needs-review-later"],
               5: ["revenue", "needs-review", "q4"], 6: [], 7: ["reviewed", "revenue"], 8: ["growth", "q4"]}
TRIAGE_TARGETS = (1, 3, 5)
FIXTURE_SETS = ("v1", "v2")
# v2: ten legacy insights for the bulk-tag task (h); their existing tags must survive
LEGACY_TAGS = {1: ["growth"], 2: [], 3: ["revenue"], 4: ["growth", "q3"], 5: [], 6: ["q3"], 7: ["revenue", "growth"], 8: [], 9: ["q3"], 10: ["growth"]}
# v2: leftovers of a cancelled experiment for the clean-up task (l): 6 insights (1-3 on the tmp board), 1 board, 5 annotations
TMP_INSIGHTS = 6
TMP_ON_BOARD = (1, 2, 3)
TMP_NOTES = (("2026-10-20T10:00:00Z", "experiment started"), ("2026-10-22T10:00:00Z", "variant B paused"), ("2026-10-24T10:00:00Z", "variant B resumed"),
             ("2026-10-27T10:00:00Z", "traffic doubled"), ("2026-10-30T10:00:00Z", "experiment cancelled"))


def _trends(event, **extra):
    src = {"kind": "TrendsQuery", "series": [{"kind": "EventsNode", "event": event, "name": event, "math": "total"}],
           "interval": "day", "dateRange": {"date_from": "-30d"}}
    src.update(extra)
    return {"kind": "InsightVizNode", "source": src}


def _v2(P, t):
    """The friction-derived set's fixtures (tasks g-l). Task g needs none: it builds everything new."""
    insights, dashboards, flags, annotations, surveys = [], [], [], [], []
    for i in range(1, 11):                                                    # h: bulk tag
        insights.append({"name": t("legacy-%02d" % i), "description": "Legacy report %02d." % i, "tags": [t(x) for x in LEGACY_TAGS[i]],
                         "query": _trends("legacy_event_%02d" % i, interval=("week" if i % 2 else "day")), "dashboards": []})
    flags.append({"key": t("checkout-banner"), "name": "Checkout banner A/B test", "active": True,      # i: add a variant
                  "filters": {"groups": [{"properties": [{"key": "email", "type": "person", "value": "@example.com", "operator": "icontains"}], "rollout_percentage": 30},
                                         {"properties": [{"key": "plan", "type": "person", "value": ["pro"], "operator": "exact"}], "rollout_percentage": 100}],
                              "multivariate": {"variants": [{"key": "control", "name": "Control", "rollout_percentage": 50},
                                                            {"key": "test", "name": "Test", "rollout_percentage": 50}]}}})
    surveys.append({"name": t("onboarding-survey"), "description": "Onboarding feedback", "type": "popover",          # j: one question
                    "questions": [
                        {"type": "rating", "question": "How easy was it to get started?", "display": "number", "scale": 5,
                         "lowerBoundLabel": "Very hard", "upperBoundLabel": "Very easy"},
                        {"type": "single_choice", "question": "Which feature did you try first?",
                         "choices": ["Dashboards", "Feature flags", "Surveys", "Something else"]},
                        {"type": "open", "question": "What almost stopped you from signing up?"}]})
    funnel = {"kind": "InsightVizNode", "source": {                                                                   # k: funnel step edit
        "kind": "FunnelsQuery",
        "series": [{"kind": "EventsNode", "event": "signup_started", "name": "signup_started"},
                   {"kind": "EventsNode", "event": "signup_completed", "name": "signup_completed"}],
        "dateRange": {"date_from": "-7d"},
        "funnelsFilter": {"funnelWindowInterval": 14, "funnelWindowIntervalUnit": "day", "funnelVizType": "steps"},
        "breakdownFilter": {"breakdown": "$browser", "breakdown_type": "event"},
        "filterTestAccounts": True}}
    insights.append({"name": t("signup-funnel"), "description": "Signup conversion.", "tags": [t("growth")], "query": funnel, "dashboards": []})
    dashboards.append({"name": t("tmp-board"), "description": "Experiment scratch board.", "tags": [], "pinned": False})  # l: clean-up
    for i in range(1, TMP_INSIGHTS + 1):
        insights.append({"name": t("tmp-%02d" % i), "description": "Scratch %02d." % i, "tags": [],
                         "query": _trends("tmp_event_%02d" % i), "dashboards": [t("tmp-board")] if i in TMP_ON_BOARD else []})
    insights.append({"name": t("tmpl-weekly"), "description": "Template, keep.", "tags": [], "query": _trends("tmpl_event", interval="week"), "dashboards": []})
    for i, (when, what) in enumerate(TMP_NOTES, 1):
        annotations.append({"content": t("tmp-note-%d %s" % (i, what)), "date_marker": when, "scope": "project"})
    return insights, dashboards, flags, annotations, surveys


def spec(n12, fixtures="v1"):
    if fixtures not in FIXTURE_SETS:
        raise ValueError("unknown fixture set %r" % (fixtures,))
    P = "bench-%s-" % n12
    t = lambda name: P + name
    weekly = {"kind": "InsightVizNode", "source": {
        "kind": "TrendsQuery",
        "series": [{"kind": "EventsNode", "event": "signup_completed", "name": "signup_completed", "math": "dau",
                    "properties": [{"key": "$browser", "type": "event", "operator": "is_not", "value": ["HeadlessChrome"]}]}],
        "interval": "week", "dateRange": {"date_from": "-90d"},
        "breakdownFilter": {"breakdown": "$browser", "breakdown_type": "event", "breakdown_limit": 6},
        "trendsFilter": {"display": "ActionsBar", "showValuesOnSeries": True, "showLegend": True},
        "compareFilter": {"compare": True},
        "filterTestAccounts": True}}
    insights = [{"name": t("weekly-signups"), "description": "Signups per week.", "tags": [t("growth")], "query": weekly,
                 "dashboards": [t("release-board")]}]
    for i in range(1, 9):
        insights.append({"name": t("triage-%02d" % i), "description": "Triage fixture %02d." % i,
                         "tags": [t(x) for x in TRIAGE_TAGS[i]],
                         "query": _trends("triage_event_%02d" % i, interval=("week" if i % 2 else "day"), filterTestAccounts=bool(i % 3 == 0)),
                         "dashboards": []})
    dashboards = [{"name": t("release-board"), "description": "Release tracking for the checkout team.", "tags": [t("release")], "pinned": False}]
    flags = []
    for i in range(1, N_FLAGS + 1):
        flags.append({"key": t("flag-%03d" % i), "name": "Benchmark fixture flag %03d" % i, "active": i not in DISABLED_FLAGS,
                      "filters": {"groups": [{"properties": [], "rollout_percentage": 100 if i % 2 else 50}]}})
    out = {"prefix": P, "fixtures": fixtures, "insights": insights, "dashboards": dashboards, "flags": flags, "annotations": [], "surveys": [],
           "triage_targets": [t("triage-%02d" % i) for i in TRIAGE_TARGETS], "disabled_flags": [t("flag-%03d" % i) for i in DISABLED_FLAGS]}
    if fixtures == "v2":
        ins, dash, fl, ann, sv = _v2(P, t)
        out["insights"] += ins; out["dashboards"] += dash; out["flags"] += fl; out["annotations"] += ann; out["surveys"] += sv
        out["legacy_insights"] = [t("legacy-%02d" % i) for i in range(1, 11)]
        out["tmp_objects"] = {"insights": [t("tmp-%02d" % i) for i in range(1, TMP_INSIGHTS + 1)], "dashboards": [t("tmp-board")],
                              "annotations": [a["content"] for a in ann]}
    return out
