# Task f: add a second tag to the three insights that carry a given tag
Set: pre-registered (written and frozen on 2026-11-10, before the usability change list existed; the prompt below is unchanged since then).
Measures: find-by-tag across several insights, read-modify-write of a tag list three times (tags are replaced as a whole list), near-miss tag names, leaving the other insights alone, accurate reporting.
Checker: bench/checkers/check_f.py (end state read from the PostHog REST API; the agent's answer is used only where the task is a report)
Placeholders: {{P}} = bench-<nonce12>- (series prefix), {{RUN}} = run tag (r001.. measured, d001.. dry run).

<!-- PROMPT -->
Triage time. Look at the saved insights whose names start with `{{P}}triage-`. Every one of them that carries the tag `{{P}}needs-review` should also get the tag `{{P}}triaged`. Keep all the tags those insights already have, and do not touch any other insight.

When you are done, list the insights you changed, one per line, each line in the form `CHANGED: <insight name>`, in ascending order by name, then the friction block.

Finish with a short FRICTION list as a fenced json block (the format is in your instructions): what cost you extra calls, what was misleading, which errors you hit and how you recovered, and what would have helped. Empty lists are fine.
<!-- /PROMPT -->
