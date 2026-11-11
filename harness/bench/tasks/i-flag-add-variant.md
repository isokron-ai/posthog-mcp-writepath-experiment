# Task i: add a variant to a multivariate flag without touching its conditions
Set: friction-derived (written on 2026-11-10 from the friction session's jobs, AFTER the usability changes were designed; it favours the usability build by construction and is reported separately from the pre-registered set).
From: friction job 4 (flag with two conditions, then variants). Targets: version-checked partial updates of flag conditions/variants, tool-name aliases (`feature-flag-update` and the like), flag list with rollout summary, validate-first errors.
Measures: a one-field change inside a nested object (variants) while two release conditions with their own rollouts must survive unchanged.
Checker: bench/checkers/check_i.py (end state read from the PostHog REST API)
Placeholders: {{P}} = bench-<nonce12>- (series prefix), {{RUN}} = run tag (r001.. measured, d001.. dry run).

<!-- PROMPT -->
The feature flag `{{P}}checkout-banner` runs an A/B test with the variants `control` and `test`. Product wants a third arm: add a variant with the key `test-b` and split the traffic so that `control` gets 34%, `test` gets 33% and `test-b` gets 33%.

Keep everything else about the flag exactly as it is: it must stay enabled, and its two release conditions (their filters and their rollout percentages) must not change. Tell me the flag's ID and its three variants with their percentages in one sentence.

Finish with a short FRICTION list as a fenced json block (the format is in your instructions): what cost you extra calls, what was misleading, which errors you hit and how you recovered, and what would have helped. Empty lists are fine.
<!-- /PROMPT -->
