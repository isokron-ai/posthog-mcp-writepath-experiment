# Task e: annotate a deploy on a dashboard, then correct the text
Set: pre-registered (written and frozen on 2026-11-10, before the usability change list existed; the prompt below is unchanged since then).
Measures: create then update of an annotation: ISO timestamp handling, dashboard scope, correcting in place instead of creating a second one.
Checker: bench/checkers/check_e.py (end state read from the PostHog REST API; the agent's answer is used only where the task is a report)
Placeholders: {{P}} = bench-<nonce12>- (series prefix), {{RUN}} = run tag (r001.. measured, d001.. dry run).

<!-- PROMPT -->
We deployed the checkout rewrite. Please add an annotation to the dashboard `{{P}}release-board` (scoped to that dashboard, not to the whole project) at 2026-10-14T09:30:00Z with the text `{{P}}{{RUN}} Deploy v4.2.0 checkout rewrite`.

After you have created it: the version in the text is wrong. Correct the text to `{{P}}{{RUN}} Deploy v4.2.1 checkout rewrite`. At the end there must be exactly one such annotation, at the same time and on the same dashboard. Tell me its ID in one sentence.

Finish with a short FRICTION list as a fenced json block (the format is in your instructions): what cost you extra calls, what was misleading, which errors you hit and how you recovered, and what would have helped. Empty lists are fine.
<!-- /PROMPT -->
