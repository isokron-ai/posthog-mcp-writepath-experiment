# Task h: tag ten insights and add eight annotations
Set: friction-derived (written on 2026-11-10 from the friction session's jobs, AFTER the usability changes were designed; it favours the usability build by construction and is reported separately from the pre-registered set).
From: friction job 3 (tag 10 insights, add 8 annotations). Targets: batch writes for insights and annotations, write receipts, `_agentNote` once.
Measures: repeated writes on many objects (10 tag updates that must keep existing tags, 8 creates with exact ISO times), not duplicating, not touching neighbours.
Checker: bench/checkers/check_h.py (end state read from the PostHog REST API)
Placeholders: {{P}} = bench-<nonce12>- (series prefix), {{RUN}} = run tag (r001.. measured, d001.. dry run).

<!-- PROMPT -->
Quarter-end housekeeping, two parts.

1. The ten saved insights whose names start with `{{P}}legacy-` are being retired. Add the tag `{{P}}{{RUN}}-retired` to each of them. Keep all the tags they already have, and do not change anything else about them or about any other insight.
2. Add these eight annotations to the whole project (project-wide, not on a dashboard), each at the given time, with exactly this text:
   - 2026-10-01T09:00:00Z: `{{P}}{{RUN}} release 3.0.0`
   - 2026-10-03T09:00:00Z: `{{P}}{{RUN}} release 3.0.1`
   - 2026-10-07T14:30:00Z: `{{P}}{{RUN}} pricing page launched`
   - 2026-10-09T09:00:00Z: `{{P}}{{RUN}} release 3.1.0`
   - 2026-10-15T08:00:00Z: `{{P}}{{RUN}} EU data region live`
   - 2026-10-21T09:00:00Z: `{{P}}{{RUN}} release 3.2.0`
   - 2026-10-28T16:00:00Z: `{{P}}{{RUN}} onboarding emails paused`
   - 2026-11-04T09:00:00Z: `{{P}}{{RUN}} release 3.3.0`

There must be exactly one annotation for each line. Tell me in one sentence when both parts are done.

Finish with a short FRICTION list as a fenced json block (the format is in your instructions): what cost you extra calls, what was misleading, which errors you hit and how you recovered, and what would have helped. Empty lists are fine.
<!-- /PROMPT -->
