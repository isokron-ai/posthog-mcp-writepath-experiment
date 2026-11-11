# Task j: change the wording of one survey question
Set: friction-derived (written on 2026-11-10 from the friction session's jobs, AFTER the usability changes were designed; it favours the usability build by construction and is reported separately from the pre-registered set).
From: friction job 7 (survey with three questions, then change one question's text). Targets: partial update of one survey question, write receipts, schema de-duplication (survey-update repeats survey-create), `_agentNote` once.
Measures: a one-string change inside an array of questions while the other questions, their order and the answer choices must survive unchanged.
Checker: bench/checkers/check_j.py (end state read from the PostHog REST API)
Placeholders: {{P}} = bench-<nonce12>- (series prefix), {{RUN}} = run tag (r001.. measured, d001.. dry run).

<!-- PROMPT -->
In the survey `{{P}}onboarding-survey`, the wording of the second question is confusing. Change the text of that question to exactly `Which feature did you use first?`.

Do not change anything else: the other two questions, the question order, the answer choices and the survey's other settings must stay exactly as they are, and the survey must not be archived or recreated. Tell me in one sentence when it is done.

Finish with a short FRICTION list as a fenced json block (the format is in your instructions): what cost you extra calls, what was misleading, which errors you hit and how you recovered, and what would have helped. Empty lists are fine.
<!-- /PROMPT -->
