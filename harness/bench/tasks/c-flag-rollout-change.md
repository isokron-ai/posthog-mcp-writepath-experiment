# Task c: create a flag with a filtered rollout, then change only the percentage
Set: pre-registered (written and frozen on 2026-11-10, before the usability change list existed; the prompt below is unchanged since then).
Measures: create-then-update on a feature flag: whether a rollout-percentage change keeps the property filters of the release condition (whole-object replacement versus targeted update).
Checker: bench/checkers/check_c.py (end state read from the PostHog REST API; the agent's answer is used only where the task is a report)
Placeholders: {{P}} = bench-<nonce12>- (series prefix), {{RUN}} = run tag (r001.. measured, d001.. dry run).

<!-- PROMPT -->
Please create a feature flag with the key `{{P}}{{RUN}}-new-checkout` and the description `New checkout flow`. It should be enabled, with a single release condition: 20% of users whose person property `email` contains `@example.com` and whose person property `plan` is exactly `pro`.

Once it exists, product has changed its mind: raise the rollout of that release condition to 60%. Change only the percentage; the two audience filters must stay as they are. Tell me the flag's ID and its final rollout in one sentence.

Finish with a short FRICTION list as a fenced json block (the format is in your instructions): what cost you extra calls, what was misleading, which errors you hit and how you recovered, and what would have helped. Empty lists are fine.
<!-- /PROMPT -->
