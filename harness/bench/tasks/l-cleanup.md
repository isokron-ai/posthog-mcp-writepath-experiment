# Task l: clean up what a cancelled experiment left behind
Set: friction-derived (written on 2026-11-10 from the friction session's jobs, AFTER the usability changes were designed; it favours the usability build by construction and is reported separately from the pre-registered set).
From: friction job 10 (delete everything a session created). Targets: batch writes (insights and annotations), short delete receipts, required `--confirm` on destructive tools, read-only batching for the lookups.
Measures: finding and deleting 12 objects of three kinds by a name prefix, with a near-miss name that must survive, and reporting the count.
Checker: bench/checkers/check_l.py (end state read from the PostHog REST API)
Placeholders: {{P}} = bench-<nonce12>- (series prefix), {{RUN}} = run tag (r001.. measured, d001.. dry run).

<!-- PROMPT -->
A cancelled experiment left scratch objects in this project. Please delete everything whose name or text starts with `{{P}}tmp-`: the dashboard, the saved insights and the annotations with that prefix. Nothing else may be deleted or changed (careful: `{{P}}tmpl-weekly` is a template we keep).

When you are done, start your answer with exactly one line in the form `DELETED: <number of objects you deleted>`, then the friction block.

Finish with a short FRICTION list as a fenced json block (the format is in your instructions): what cost you extra calls, what was misleading, which errors you hit and how you recovered, and what would have helped. Empty lists are fine.
<!-- /PROMPT -->
