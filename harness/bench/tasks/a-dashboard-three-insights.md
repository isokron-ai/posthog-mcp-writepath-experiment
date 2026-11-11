# Task a: new dashboard with three insights
Set: pre-registered (written and frozen on 2026-11-10, before the usability change list existed; the prompt below is unchanged since then).
Measures: multi-object create (1 dashboard + 3 insights of different query kinds), schema discovery for trend/funnel/retention queries, attaching insights to a dashboard, confirming the result.
Checker: bench/checkers/check_a.py (end state read from the PostHog REST API; the agent's answer is used only where the task is a report)
Placeholders: {{P}} = bench-<nonce12>- (series prefix), {{RUN}} = run tag (r001.. measured, d001.. dry run).

<!-- PROMPT -->
Our growth team wants a dashboard ready before the new signup flow ships. Please create a dashboard named `{{P}}{{RUN}}-growth-overview` with the description `Signup flow health`, and put these three saved insights on it:

1. `{{P}}{{RUN}}-signups-trend`: a trend of the event `signup_completed`, total count per day, over the last 30 days.
2. `{{P}}{{RUN}}-signup-funnel`: a funnel with two steps, `signup_started` then `signup_completed`.
3. `{{P}}{{RUN}}-signup-retention`: weekly retention of users who did `signup_completed` and came back to do `app_opened`.

These events are not being sent yet (the instrumentation ships next week); build everything anyway so it is ready. Check that all three insights really are on the dashboard, then tell me the dashboard ID in one or two sentences.

Finish with a short FRICTION list as a fenced json block (the format is in your instructions): what cost you extra calls, what was misleading, which errors you hit and how you recovered, and what would have helped. Empty lists are fine.
<!-- /PROMPT -->
