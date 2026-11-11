# Task b: rename an insight and change its description, nothing else
Set: pre-registered (written and frozen on 2026-11-10, before the usability change list existed; the prompt below is unchanged since then).
Measures: partial update of one saved insight: whether name/description can be changed without the tool resending or defaulting the query, tags, or dashboard membership.
Checker: bench/checkers/check_b.py (end state read from the PostHog REST API; the agent's answer is used only where the task is a report)
Placeholders: {{P}} = bench-<nonce12>- (series prefix), {{RUN}} = run tag (r001.. measured, d001.. dry run).

<!-- PROMPT -->
The saved insight `{{P}}weekly-signups` has a misleading title. Please rename it to `{{P}}weekly-signups-by-browser` and set its description to exactly: `Weekly unique signups, broken down by browser. Owner: growth team.`

Do not change anything else about it: the chart, its filters, its tags and the dashboard it appears on must stay exactly as they are. Tell me in one sentence when it is done.

Finish with a short FRICTION list as a fenced json block (the format is in your instructions): what cost you extra calls, what was misleading, which errors you hit and how you recovered, and what would have helped. Empty lists are fine.
<!-- /PROMPT -->
