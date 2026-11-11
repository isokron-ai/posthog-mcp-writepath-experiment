# Task k: add a funnel step, change the date range and rename
Set: friction-derived (written on 2026-11-10 from the friction session's jobs, AFTER the usability changes were designed; it favours the usability build by construction and is reported separately from the pre-registered set).
From: friction job 2 (add a step to a funnel, set the date range to -30d, rename). Targets: version-checked partial query updates (`insight-update-query-partial`), schema de-duplication (insight-update repeats insight-create), write receipts.
Measures: an edit inside a saved query (insert a series step, change a date range) while the rest of the query, the tags and the object must survive.
Checker: bench/checkers/check_k.py (end state read from the PostHog REST API)
Placeholders: {{P}} = bench-<nonce12>- (series prefix), {{RUN}} = run tag (r001.. measured, d001.. dry run).

<!-- PROMPT -->
Please update the saved funnel insight `{{P}}signup-funnel`:

1. add `$pageview` as a new first step, before `signup_started` (so the steps are `$pageview`, `signup_started`, `signup_completed`);
2. change its date range to the last 30 days;
3. rename it to `{{P}}signup-funnel-3-step`.

Keep everything else about it exactly as it is: the breakdown, the conversion window, the test-account filter, its description and its tags. Edit the existing insight; do not create a new one. Tell me in one sentence when it is done.

Finish with a short FRICTION list as a fenced json block (the format is in your instructions): what cost you extra calls, what was misleading, which errors you hit and how you recovered, and what would have helped. Empty lists are fine.
<!-- /PROMPT -->
