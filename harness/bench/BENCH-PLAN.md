# Benchmark plan: ordinary PostHog work through PostHog's official MCP server, before and after a patch series

Audit id `posthog-mcp-bench`. Server under test: `services/mcp` of PostHog/posthog at `7b516983bef16b9692a00a6b7780a6b5a802257c`.
BASELINE = that commit unmodified. FIXED = the same commit plus `patches/*.patch`. Machine-readable twin: `BENCH-PLAN.json` (written at freeze, with the order seed).

## What is measured
One AI agent (Claude Agent SDK 0.3.319, model `claude-sonnet-5-5`, billed to the Anthropic API key) gets a short, ordinary request.
The locally built PostHog MCP server is its only tool source: every built-in tool is removed, any other tool call is denied.
The server runs in **cli mode**, the mode every client except Cursor gets by default: the agent sees ONE MCP tool, `exec`
(37.9 KB of definition, about 9.5K tokens), and reaches the 1232-tool catalog through commands inside it
(`search`, `info <tool>`, `schema <tool> <field>`, `call <tool> <json>`). tools mode (1232 separately listed tools, 1.48 MB) is not used.
Per run: tool calls (name and, for `exec`, the command inside), model turns, failed tool calls, repeated identical calls, retries after errors,
tool-result bytes, input/output/cache tokens, reported cost, wall time (`metrics.json`); the final answer (`answer.md`); a redacted transcript and a
redacted capture of every MCP request/response (`transcript.redacted.jsonl`, `mcp-capture.jsonl`); the end state the checker read (`final-state.json`);
the checker's verdict (`checker.json`); the agent's own friction list (`friction.json`, an opinion, never a verdict).

## Tasks and scoring (success is the checker's verdict only; every criterion must hold)
| id | task | what it exercises | end-state criteria (read from PostHog's REST API) |
|---|---|---|---|
| a | `a-dashboard-three-insights`: create a dashboard and three saved insights on it (trend, two-step funnel, weekly retention) for named events | multi-object create, query-schema discovery, attaching, confirming | exactly one dashboard with that name and description; exactly those three insights as its tiles; each insight exists once; trend = TrendsQuery on `signup_completed`, total, daily, `-30d`; funnel = FunnelsQuery `signup_started` then `signup_completed`; retention = RetentionQuery target `signup_completed`, returning `app_opened`, period Week; nothing else changed |
| b | `b-insight-rename`: rename one seeded insight and set its description, change nothing else | partial update; whether the tool resends or defaults the query, tags, dashboards | one insight with the new name, old name gone, same id (not recreated); description exact; **query byte-identical to the seed**; tags, dashboard membership, favorited identical; the board still shows it and is otherwise unchanged; nothing else changed |
| c | `c-flag-rollout-change`: create a flag at 20% for users matching two person-property filters, then raise only the rollout to 60% | create then update; whole-`filters` replacement versus targeted change | exactly one flag with the key; enabled; one release condition; rollout 60; both filters present (`email` icontains `@example.com`, `plan` exact `pro`, type person) and no others; not multivariate; nothing else changed |
| d | `d-flag-inventory`: count the 120 fixture flags and list the 9 disabled ones (read-only) | more than one page of results, paging signals, totals | `FLAG_COUNT:` line equals the API's count; `DISABLED:` line equals the API's set of disabled keys, ascending; nothing changed |
| e | `e-annotate-deploy`: add a dashboard-scoped annotation at a given ISO timestamp, then correct its text | create then update, ISO time, scope, not duplicating | exactly one annotation for the run; corrected text; `date_marker` equals 2026-10-14T09:30:00Z as an instant; scope `dashboard`; on the seeded board; nothing else changed |
| f | `f-tag-triage`: add a tag to the three triage insights (of eight) that carry the review tag, keep their tags, leave the rest | find by tag, tag lists replaced as a whole, a near-miss tag name, reporting | the three targets have the new tag and all their old tags, exactly; the five others' tags unchanged; all other fields of all eight unchanged; same ids; `CHANGED:` lines equal the three names; nothing else changed |

"Nothing else changed": every seeded object outside the task's scope equals the seed baseline, and no unexpected `bench-<nonce>-` object exists.
Ground truth for d is computed from the live API at check time. Checkers never write.

## Fixtures (all named `bench-<nonce12>-...`, created by `seed/seed.py` through the REST API at <= 2 requests/second)
1 dashboard `release-board`; 9 insights (`weekly-signups`, on the board, with a non-default trends query; `triage-01`..`08` with tag sets);
120 feature flags `flag-001`..`120` (9 disabled, spread across any page boundary). Between runs `seed.py --reset` deletes what the run created,
restores what it changed and compares the **state hash** (sha256 over the normalized content of every benchmark-owned object, ids and timestamps
excluded) with the hash recorded at seeding. A run does not start, and the series stops, if the hash does not match.
Objects a run creates carry the run tag as well (`bench-<nonce12>-r017-...`), so repetitions never collide.

## Runs and order
6 tasks x 2 builds x 3 repetitions = 36 runs. Inside each repetition the six tasks are shuffled; each task runs on both builds back to back; which
build goes first is random but balanced (9 of 18 pairs start with baseline). The seed of that shuffle is recorded in `BENCH-PLAN.json`.
One run at a time (mkdir lock). Max turns: 40 for b, c, d, e; 60 for a, f (the Grafana plan's 40 / 60). Per-run cost cap 4 USD (SDK `maxBudgetUsd`).
Spending ceiling: the driver adds up reported cost after every run and stops once the total exceeds `BENCH_BUDGET_USD` (default 40).
Each run: fresh Redis state, fresh server process for its build, fresh proxy and capture file, its own directory
`runs/series-<nonce12>/run-<seq>-<task>-<build>-rep<k>-a<attempt>/`. Nothing is overwritten; every start and finish is a line in the append-only
`RUNS.jsonl` (and in `runs/RUNS-ALL.jsonl`, which also holds dry runs, labelled `measured: false`). A finished run is never re-run, whatever its outcome;
an attempt interrupted from outside is repeated as a new attempt and both stay in the log.

## Freeze
`bench/freeze.py` runs before the first measured run: plan with seed, `evidence/MANIFEST.json` (sha256 of every harness file, both build hashes,
plan, model id, SDK/CLI versions), RFC 3161 timestamps over the manifest from Sectigo and DigiCert, a `harness_frozen` event and signed checkpoint on
the kronicle-lite chain (anchored and receipt-stamped when `KRONICLE_ANCHOR_KEY` is supplied; otherwise recorded as pending), and the series nonce
derived from the manifest hash and the timestamp tokens. `bench/_make_manifest.py --verify` runs before every measured session and refuses on any change.

## Limits to keep in mind
Three repetitions per cell show spread, not a distribution. One model, one client, one server mode. The tasks and the fixes come from the same audit
findings, so the tasks exercise what the patches change: the result is not a general score. Cost depends on prompt-cache state. The backend is a
shared cloud service that can drift. The local build is not PostHog's hosted deployment (Node 25 here, Node 26 upstream; no edge worker; local Redis;
analytics off). Tag objects created by the fixtures remain in the project's tag list after cleanup (PostHog has no API to remove unused tags);
objects are soft-deleted, which is how PostHog deletes them.

## Series `usability-3build-20261110`: three builds, two task sets (added 2026-11-10, after the series above was complete)
A new series. It supersedes nothing: the two-build series above (freeze `e27c0aac…`, nonce `007817e94cfb`, `state/freeze.json`, `evidence/`,
`.kl-state/`, `runs/series-007817e94cfb/`) stays on the record as it is. Everything of the new series lives in `series/usability-3build-20261110/`
(`SERIES.json`, `BENCH-PLAN.json`, `DRY-RUN-PLAN.json`, `evidence/`, `state/freeze.json`, `kl-state/`; its kronicle-lite audit is
`posthog-mcp-bench-3build`). Target: the self-hosted instance only.

**Builds.** BASELINE and FIXED exactly as above (bundles unchanged). USABILITY (`build/build.sh usability`) = the pin + the same bug-fix patches as
FIXED + the combined usability series `patches-usability/` in `patches-usability/SERIES` order (17 patches: groups A response shaping, B exec
behaviour, C new atomic/batch tools, then two integration commits; `git format-patch iso/fixed-base..iso/usability-all`).

**Two task sets, always reported separately** (AUDIT_SOP Phase 4; registry `bench/TASKSETS.json`; each task file states its set on line 2):
- **pre-registered** (a-f, the table above): frozen on 2026-11-10 before the usability change list existed. The fair test. Prompts and criteria unchanged.
- **friction-derived** (g-l, below): written from the friction session's jobs after the changes were designed. Favours the usability build by construction.

| id | task (friction job) | what it exercises | end-state criteria (read from PostHog's REST API) |
|---|---|---|---|
| g | `g-dashboard-five-tiles` (job 1): a dashboard with five insights: daily trend, three-step funnel, weekly retention, a HogQL table, weekly unique users | multi-object create, four query kinds; targets dashboard-create-with-insights, receipts, `_agentNote` once, schema de-dup, validate-first | exactly one dashboard with name and description; exactly those five insights as its tiles; each once; trend TrendsQuery `signup_completed` total daily `-30d`; funnel `$pageview`, `signup_started`, `signup_completed`; retention target `signup_completed`, returning `app_opened`, Week; SQL insight = HogQLQuery equal to the given query (whitespace, case and a trailing `;` ignored); weekly visitors TrendsQuery `$pageview` dau weekly `-90d`; nothing else changed |
| h | `h-bulk-tag-annotate` (job 3): tag the ten `legacy-` insights with a run tag, add eight project-wide annotations | repeated writes; targets insights-batch-update, annotations-batch-create, receipts | all ten carry the new tag and exactly their old tags; their other fields unchanged; same ids; exactly one annotation per given text, at the given instant, project scope, no dashboard; nothing else changed |
| i | `i-flag-add-variant` (job 4): add variant `test-b` to the seeded A/B flag and split 34/33/33 | nested one-field edit; targets feature-flag-update-conditions (version-checked), tool-name aliases | same flag; variants exactly control 34, test 33, test-b 33; existing variant names unchanged; both release conditions unchanged (filters and rollouts); still enabled; name, tags and other filter fields unchanged; nothing else changed |
| j | `j-survey-edit-question` (job 7): change the second question's text of the seeded three-question survey | edit inside an array; targets survey-update-question, schema de-dup | same survey, not archived; three questions; question 2 has the new text and is otherwise unchanged (type, choices); questions 1 and 3 unchanged; description and type unchanged; nothing else changed |
| k | `k-funnel-step-edit` (job 2): insert `$pageview` as the first funnel step, set `-30d`, rename | edit inside a saved query; targets insight-update-query-partial | same insight under the new name, old name gone; steps `$pageview`, `signup_started`, `signup_completed`, the two old steps unchanged (display name ignored); `date_from -30d`, no `date_to`; breakdown, funnel window and test-account filter unchanged; description, tags and dashboards unchanged; nothing else changed |
| l | `l-cleanup` (job 10): delete every `tmp-` object (6 insights, 1 dashboard, 5 annotations), keep the near-miss `tmpl-weekly` | deletes of three kinds; targets batch tools, delete receipts, `--confirm` | no `tmp-` insight, dashboard or annotation left; `tmpl-weekly` unchanged; one `DELETED: 12` line; nothing else changed |

**Fixtures.** Fixture set v2 (`seed/seed.py --init --fixtures v2`) = v1 unchanged plus: 10 `legacy-` insights with tag sets, the flag `checkout-banner`
(two release conditions, variants control/test 50/50), the survey `onboarding-survey` (3 questions, draft), the funnel `signup-funnel`, and the scratch
set for l (`tmp-board` with `tmp-01..03`, `tmp-04..06`, five `tmp-note-*` annotations, and `tmpl-weekly`). Surveys enter the state hash (question ids
excluded); seeded annotations are restored by `--reset`; surveys are removed with PostHog's DELETE (they have no soft delete). The "nothing else changed"
rule now compares annotations with the baseline as a multiset (with v1, where none are seeded, this is exactly the earlier rule) and covers surveys when
the baseline has them. All twelve checkers were validated on real API shapes (`probes/shape_check.py`, `probes/shape_check_v2.py`).

**Runs and order.** 12 tasks x 3 builds x 3 repetitions = 108 runs, model `claude-sonnet-5-5`, max turns 40/60 by the same rule (60 for a, f, g, h, l).
Inside each repetition all twelve tasks are shuffled together; each task runs on the three builds back to back; the build order of each block is
one of the 6 permutations, each used 6 times, so each build goes first, second and third 12 times. `DRY-RUN-PLAN.json`: the same design for one
repetition (36 runs, own seed, NOT MEASURED, run tags d001..). Budget: 40 USD for the series (`BENCH_BUDGET_USD` or SERIES.json), 4 USD per run.

**Analysis.** `bench/analyze.py --series-dir runs/series-<n12>` reports each task set in its own section with one column per build. The two sets are
never added into one total.
