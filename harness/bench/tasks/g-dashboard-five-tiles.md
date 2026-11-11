# Task g: a product overview dashboard with five insight tiles
Set: friction-derived (written on 2026-11-10 from the friction session's jobs, AFTER the usability changes were designed; it favours the usability build by construction and is reported separately from the pre-registered set).
From: friction job 1 (dashboard with trend, three-step funnel, retention and a HogQL table, then a fifth tile). Targets: atomic dashboard-with-tiles, write receipts, `_agentNote` once, schema de-duplication, validate-first errors, compact retention output.
Measures: multi-object create (1 dashboard + 5 insights of four query kinds, one of them SQL), schema discovery, attaching, confirming.
Checker: bench/checkers/check_g.py (end state read from the PostHog REST API)
Placeholders: {{P}} = bench-<nonce12>- (series prefix), {{RUN}} = run tag (r001.. measured, d001.. dry run).

<!-- PROMPT -->
The product team wants an overview dashboard. Please create a dashboard named `{{P}}{{RUN}}-product-overview` with the description `Signups, conversion and retention`, and put these five saved insights on it:

1. `{{P}}{{RUN}}-daily-signups`: a trend of the event `signup_completed`, total count per day, over the last 30 days.
2. `{{P}}{{RUN}}-signup-funnel`: a funnel with three steps: `$pageview`, then `signup_started`, then `signup_completed`.
3. `{{P}}{{RUN}}-signup-retention`: weekly retention of users who did `signup_completed` and came back to do `app_opened`.
4. `{{P}}{{RUN}}-top-events`: a SQL insight (HogQL) showing this query as a table: `SELECT event, count() AS total FROM events WHERE timestamp > now() - INTERVAL 7 DAY GROUP BY event ORDER BY total DESC LIMIT 10`
5. `{{P}}{{RUN}}-weekly-visitors`: a trend of unique users who did `$pageview`, per week, over the last 90 days.

Some of these events are not being sent yet; build everything anyway so it is ready. The order of the tiles does not matter. Check that all five insights really are on the dashboard, then tell me the dashboard ID in one or two sentences.

Finish with a short FRICTION list as a fenced json block (the format is in your instructions): what cost you extra calls, what was misleading, which errors you hit and how you recovered, and what would have helped. Empty lists are fine.
<!-- /PROMPT -->
