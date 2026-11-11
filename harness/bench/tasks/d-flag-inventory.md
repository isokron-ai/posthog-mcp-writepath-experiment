# Task d: count the fixture flags and name the disabled ones
Set: pre-registered (written and frozen on 2026-11-10, before the usability change list existed; the prompt below is unchanged since then).
Measures: listing more than one page of feature flags: paging signals, total counts, filtering by state, response size. Read-only.
Checker: bench/checkers/check_d.py (end state read from the PostHog REST API; the agent's answer is used only where the task is a report)
Placeholders: {{P}} = bench-<nonce12>- (series prefix), {{RUN}} = run tag (r001.. measured, d001.. dry run).

<!-- PROMPT -->
I need an inventory of our fixture flags. Count every feature flag in this project whose key starts with `{{P}}flag-`, and find which of them are currently disabled. Do not change anything.

Start your answer with exactly these two lines, then the friction block:

FLAG_COUNT: <number of flags whose key starts with {{P}}flag->
DISABLED: <the keys of the disabled ones, comma-separated, in ascending order>

Finish with a short FRICTION list as a fenced json block (the format is in your instructions): what cost you extra calls, what was misleading, which errors you hit and how you recovered, and what would have helped. Empty lists are fine.
<!-- /PROMPT -->
