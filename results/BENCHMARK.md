# Before/after benchmark: PostHog MCP server 7b516983, bug-fix build and research build

Source: [IsoKron, PostHog MCP server audit](https://isokron.ai/research/posthog-mcp-server-audit).

| Name in this write-up | Git tag | What it is |
| --- | --- | --- |
| Unmodified | `upstream-7b516983` | PostHog's MCP server at commit 7b516983 |
| Bug-fix build | `fixed-r3` | Unmodified plus 14 bug-fix commits (fixes for 13 audit findings) |
| Research build | `usability-r3` | The bug-fix build plus 17 commits: 14 usability changes, a design note and two integration fixes |

The harness, the analysis files and `runs.csv` call the same three builds `baseline`, `fixed` and `usability`.

On 10 and 11 November 2026 (UTC) we ran 108 agent runs against a self-hosted PostHog open-source instance: three
builds of the MCP server, two sets of six tasks, three repetitions each. All 108 finished and all are counted. Against the
unmodified server, on totals over the 18 runs per build: on the pre-registered tasks, the fair test, the research build
used 15.8% fewer tool calls, 14.0% fewer turns and 23.9% fewer tool-result bytes, while the bug-fix build used 4.8% more
tool calls and 14.4% more bytes. On the friction-derived tasks, which favour the research build by construction, the
research build used 31.0% fewer tool calls, 28.9% fewer turns and 60.5% fewer bytes. The results measure each combined
set of changes, not each change on its own.

Cost, as estimated by the Claude Agent SDK, was near-flat on the fair set: 1.73 USD unmodified, 1.90 (+9.3%) on the
bug-fix build and 1.72 (−0.7%) on the research build; on the friction-derived set 2.28, 2.09 (−8.6%) and 1.77 (−22.4%).
Most of each run's input is read back from the prompt cache at a fraction of the normal price, so fewer calls and smaller
results lower cost much less than they lower calls and bytes.

## Setup

- **Backend:** a self-hosted PostHog open-source instance at the same commit as the server (`7b516983`), PostHog's hobby
  deployment adapted for loopback with every image pinned by digest ([`selfhost/`](../selfhost/)). No request reached
  PostHog Cloud: the MCP server ran with a loopback-only egress guard that logs every connection. This is not a
  measurement of PostHog Cloud, whose behaviour may differ; self-hosted PostHog has the open-source feature set, and every
  task uses only features available there.
- **Agent:** one `claude-sonnet-5-5` agent per run through the Claude Agent SDK 0.3.319 (Claude Code 2.1.319). Every
  built-in tool removed except tool search; the local PostHog MCP server is the only tool source, in its default `cli`
  mode (one `exec` tool reaching the whole catalog through `search`, `info`, `schema` and `call`). Max turns 40 for
  single-object tasks, 60 for multi-object tasks; 4 USD cap per run.
- **Builds:** the three bundles in [EXPERIMENT.md](../EXPERIMENT.md#three-builds), built from source with Node 25.8.1;
  each run checked the bundle hash before starting the server.
- **Design:** 12 tasks x 3 builds x 3 repetitions = 108 runs, one at a time. In each repetition the twelve tasks are
  shuffled; each task runs on the three builds back to back; the build order of each block is one of the six
  permutations, each used six times, so each build is first in 12 of the 36 blocks. Fixtures (all named
  `bench-<nonce>-...`) are seeded through the REST API and reset before every run until their state hash matches.
- **Freeze:** before the first measured run the harness files, build hashes, plan and order seed were hashed into a
  manifest (`ba289984…`) and timestamped (RFC 3161). Unmeasured dry runs before it found three checker defects and a
  pacing problem, each fixed with tests and a new freeze before anything was measured.
- **Scoring:** a mechanical checker reads PostHog's end state through the REST API and applies exact criteria per task,
  including "nothing else changed". No model judges anything.
- **Cost:** 11.50 USD in API usage for the 108 measured runs.

Definitions: a **tool call** is one tool invocation by the agent, including the client's own tool search (one per run,
18 per build in each set); a **PostHog MCP call** is one `exec` call (tool calls minus tool search); a **model turn** is
one model response cycle; a **failed call** is a tool call that returned an error; **tool-result bytes** are the bytes of
the tool results returned to the agent; a **correct run** met all its end-state criteria. **Totals** are over the 18 runs
per build and set; percentages compare with the unmodified build's total, to one decimal, and a minus sign means fewer or
smaller. Failed calls carry no percentage: the counts are too small for one to mean much. Per-round and per-task values
are medians with [min–max]; with three runs per task and build these ranges are descriptive, not a significance test.

## Task sets

**Pre-registered (a–f), the fair test** (written and frozen on 10 November 2026 before the usability change list
existed): a dashboard with three saved insights (trend, funnel, retention); rename one insight and set its description,
changing nothing else; create a flag at 20% for two person-property filters, then raise only the rollout to 60%; count
120 flags and list the 9 disabled ones; add a dashboard annotation at a given instant, then correct its text; tag the
three insights of eight that carry a review tag, keeping their other tags.

**Friction-derived (g–l)** (written after the usability changes were designed, from the jobs of the usability pass;
favours the research build by construction; never pooled with the pre-registered set): a dashboard with five tiles of
four query kinds; tag ten insights and add eight annotations; add a variant to an A/B flag and re-split it; change the
text of one survey question; insert a funnel step and change the date range; delete twelve scratch objects of three kinds
while keeping a near-miss.

Full prompts and criteria: [`harness/bench/tasks/`](../harness/bench/tasks/) and
[`harness/bench/BENCH-PLAN.md`](../harness/bench/BENCH-PLAN.md).

## Results, three-build series (10–11 November 2026 UTC)

Recompute every table here with `python3 results/summarize.py <runs.csv>`.

### Pre-registered tasks (the fair test; 54 runs)

| Totals over 18 runs per build | Unmodified | Bug-fix build | Research build |
|---|---|---|---|
| Runs correct | 18 of 18 | 18 of 18 | 18 of 18 |
| Tool calls, total | 146 | 153 (+4.8%) | 123 (−15.8%) |
| PostHog MCP calls, total | 128 | 135 (+5.5%) | 105 (−18.0%) |
| Model turns, total | 164 | 171 (+4.3%) | 141 (−14.0%) |
| Tool-result bytes, total | 604,187 | 691,059 (+14.4%) | 459,793 (−23.9%) |
| Failed tool calls, total | 4 | 4 | 4 |
| Cost, USD (SDK estimate), total | 1.73 | 1.90 (+9.3%) | 1.72 (−0.7%) |

Secondary detail: per round of all 6 tasks, median of 3 rounds [min–max].

| Per round | Unmodified | Bug-fix build | Research build |
|---|---|---|---|
| Tool calls | 48 [48–50] | 52 [48–53] | 41 [39–43] |
| PostHog MCP calls | 42 [42–44] | 46 [42–47] | 35 [33–37] |
| Model turns | 54 [54–56] | 58 [54–59] | 47 [45–49] |
| Tool-result bytes | 188,652 [186,397–229,138] | 226,390 [217,976–246,693] | 139,775 [113,241–206,777] |
| Failed tool calls | 1 [1–2] | 1 [1–2] | 1 [0–3] |
| Cost, USD (SDK estimate) | 0.59 [0.54–0.60] | 0.64 [0.58–0.68] | 0.58 [0.52–0.62] |

Per task: per-run median [min–max] over 3 runs.

| Task | Build | Correct | Tool calls | Model turns | Failed calls | Tool-result bytes |
|---|---|---|---|---|---|---|
| a-dashboard-three-insights | Unmodified | 3/3 | 10 [9–10] | 11 [10–11] | 0 [0–0] | 67,168 [53,549–67,417] |
| a-dashboard-three-insights | Bug-fix build | 3/3 | 10 [9–10] | 11 [10–11] | 0 [0–0] | 57,587 [53,521–67,137] |
| a-dashboard-three-insights | Research build | 3/3 | 8 [8–8] | 9 [9–9] | 0 [0–1] | 35,443 [35,443–41,038] |
| b-insight-rename | Unmodified | 3/3 | 6 [6–7] | 7 [7–8] | 0 [0–0] | 27,343 [26,308–35,556] |
| b-insight-rename | Bug-fix build | 3/3 | 6 [6–7] | 7 [7–8] | 0 [0–0] | 26,693 [26,565–35,661] |
| b-insight-rename | Research build | 3/3 | 6 [6–8] | 7 [7–9] | 0 [0–1] | 21,894 [21,511–28,963] |
| c-flag-rollout-change | Unmodified | 3/3 | 7 [7–9] | 8 [8–10] | 1 [1–2] | 23,752 [23,752–24,196] |
| c-flag-rollout-change | Bug-fix build | 3/3 | 8 [7–9] | 9 [8–10] | 1 [1–2] | 24,035 [23,752–24,196] |
| c-flag-rollout-change | Research build | 3/3 | 4 [4–6] | 5 [5–7] | 0 [0–1] | 17,751 [17,751–22,863] |
| d-flag-inventory | Unmodified | 3/3 | 6 [6–7] | 7 [7–8] | 0 [0–0] | 11,915 [11,432–58,467] |
| d-flag-inventory | Bug-fix build | 3/3 | 7 [7–7] | 8 [8–8] | 0 [0–0] | 57,984 [57,984–57,984] |
| d-flag-inventory | Research build | 3/3 | 5 [4–5] | 6 [5–6] | 0 [0–0] | 11,875 [11,875–95,935] |
| e-annotate-deploy | Unmodified | 3/3 | 10 [10–11] | 11 [11–12] | 0 [0–0] | 12,546 [12,260–12,546] |
| e-annotate-deploy | Bug-fix build | 3/3 | 12 [11–12] | 13 [12–13] | 0 [0–0] | 15,222 [14,251–15,481] |
| e-annotate-deploy | Research build | 3/3 | 10 [9–10] | 11 [10–11] | 0 [0–0] | 10,608 [9,890–10,823] |
| f-tag-triage | Unmodified | 3/3 | 8 [8–9] | 9 [9–10] | 0 [0–0] | 45,268 [45,033–45,679] |
| f-tag-triage | Bug-fix build | 3/3 | 9 [7–9] | 10 [8–10] | 0 [0–0] | 45,679 [40,673–46,654] |
| f-tag-triage | Research build | 3/3 | 7 [7–8] | 8 [8–9] | 0 [0–1] | 25,146 [15,838–25,146] |

### Friction-derived tasks (favour the research build by construction; 54 runs)

| Totals over 18 runs per build | Unmodified | Bug-fix build | Research build |
|---|---|---|---|
| Runs correct | 18 of 18 | 17 of 18 | 18 of 18 |
| Tool calls, total | 245 | 249 (+1.6%) | 169 (−31.0%) |
| PostHog MCP calls, total | 227 | 231 (+1.8%) | 151 (−33.5%) |
| Model turns, total | 263 | 267 (+1.5%) | 187 (−28.9%) |
| Tool-result bytes, total | 965,442 | 888,477 (−8.0%) | 381,661 (−60.5%) |
| Failed tool calls, total | 2 | 3 | 8 |
| Cost, USD (SDK estimate), total | 2.28 | 2.09 (−8.6%) | 1.77 (−22.4%) |

Secondary detail: per round of all 6 tasks, median of 3 rounds [min–max].

| Per round | Unmodified | Bug-fix build | Research build |
|---|---|---|---|
| Tool calls | 81 [76–88] | 86 [73–90] | 57 [54–58] |
| PostHog MCP calls | 75 [70–82] | 80 [67–84] | 51 [48–52] |
| Model turns | 87 [82–94] | 92 [79–96] | 63 [60–64] |
| Tool-result bytes | 324,367 [288,444–352,631] | 293,954 [291,786–302,737] | 122,825 [116,400–142,436] |
| Failed tool calls | 1 [0–1] | 1 [1–1] | 3 [1–4] |
| Cost, USD (SDK estimate) | 0.78 [0.69–0.82] | 0.70 [0.67–0.72] | 0.59 [0.57–0.61] |

Per task: per-run median [min–max] over 3 runs.

| Task | Build | Correct | Tool calls | Model turns | Failed calls | Tool-result bytes |
|---|---|---|---|---|---|---|
| g-dashboard-five-tiles | Unmodified | 3/3 | 12 [11–13] | 13 [12–14] | 0 [0–0] | 79,386 [65,440–100,324] |
| g-dashboard-five-tiles | Bug-fix build | 3/3 | 12 [11–12] | 13 [12–13] | 0 [0–0] | 70,931 [63,360–71,204] |
| g-dashboard-five-tiles | Research build | 3/3 | 9 [9–10] | 10 [10–11] | 0 [0–1] | 37,426 [37,426–38,967] |
| h-bulk-tag-annotate | Unmodified | 3/3 | 28 [28–39] | 29 [29–40] | 0 [0–1] | 83,894 [83,894–133,941] |
| h-bulk-tag-annotate | Bug-fix build | 3/3 | 37 [26–37] | 38 [27–38] | 1 [0–1] | 87,148 [78,334–88,946] |
| h-bulk-tag-annotate | Research build | 3/3 | 10 [10–11] | 11 [11–12] | 1 [1–2] | 19,477 [13,839–27,006] |
| i-flag-add-variant | Unmodified | 3/3 | 5 [5–5] | 6 [6–6] | 0 [0–0] | 25,807 [25,807–25,911] |
| i-flag-add-variant | Bug-fix build | 3/3 | 5 [5–5] | 6 [6–6] | 0 [0–0] | 25,808 [25,807–25,809] |
| i-flag-add-variant | Research build | 3/3 | 5 [4–5] | 6 [5–6] | 0 [0–0] | 23,216 [23,193–23,329] |
| j-survey-edit-question | Unmodified | 3/3 | 6 [6–7] | 7 [7–8] | 0 [0–1] | 58,741 [58,191–59,011] |
| j-survey-edit-question | Bug-fix build | 3/3 | 6 [6–7] | 7 [7–8] | 0 [0–1] | 61,030 [59,012–61,032] |
| j-survey-edit-question | Research build | 3/3 | 5 [5–7] | 6 [6–8] | 0 [0–1] | 6,658 [6,577–6,659] |
| k-funnel-step-edit | Unmodified | 3/3 | 6 [6–6] | 7 [7–7] | 0 [0–0] | 28,614 [28,519–28,735] |
| k-funnel-step-edit | Bug-fix build | 3/3 | 7 [6–7] | 8 [7–8] | 0 [0–0] | 28,492 [28,470–29,086] |
| k-funnel-step-edit | Research build | 3/3 | 9 [7–10] | 10 [8–11] | 0 [0–2] | 25,921 [16,464–33,855] |
| l-cleanup | Unmodified | 3/3 | 20 [20–22] | 21 [21–23] | 0 [0–0] | 26,588 [26,043–26,596] |
| l-cleanup | Bug-fix build | 2/3 | 21 [17–22] | 22 [18–23] | 0 [0–0] | 28,489 [24,151–31,368] |
| l-cleanup | Research build | 3/3 | 18 [17–18] | 19 [18–19] | 0 [0–0] | 14,161 [13,182–14,305] |

### Where the calls went

- **The bug-fix build alone did not make the agent more efficient.** It used more calls, turns and bytes than the
  unmodified build on the fair set. Its extra bytes come from the flag inventory (d), where every bug-fix run returned
  57,984 bytes against an unmodified median of 11,915. The fixes change correctness in specific cases (a dropped
  next-page hint, coerced values, rejected ids); these tasks complete correctly on the unmodified build too.
- **Flag rollout change (c):** every unmodified and bug-fix run first asked for `feature-flag-create`, which does not
  exist (the catalog names it `create-feature-flag`), and failed; on the research build the tool-name alias resolved
  that guess. Calls per run 7 → 4.
- **Bulk tag and annotate (h):** 28 calls per run on the unmodified build (one `insight-update` per insight and one
  `annotation-create` per annotation) against 10 with the batch tools. Of the 76 fewer calls in the friction-derived
  total, 64 come from this task.
- **Dashboards (a, g):** compact write receipts and schema de-duplication cut tool-result bytes by about half per run
  (67,168 → 35,443 and 79,386 → 37,426). The create-with-children tool (`dashboard-create-with-insights`) was never
  called in any run: agents created the dashboard and each insight separately.
- **Survey question edit (j):** `survey-update-question` replaced reading and resending the whole survey; tool-result
  bytes per run fell from 58,741 to 6,658.
- **Funnel step edit (k) got worse:** median 9 calls on the research build against 6. Its agents looked up both the new
  partial-update tool and the old update tool, and one run hit two not-found reads while locating the insight. All runs
  of all builds were correct.
- **Guard rails cost calls:** four failed calls on the research build across both sets were its own `--confirm`
  refusals of `insights-batch-update`, and two were refusals of a batched `exec` request that held writes. Nothing ran in
  any of them, and every one of those runs ended correct.

### Failed tool calls, with the reason the server gave

As the harness reported them; its build names are `baseline` (unmodified), `fixed` (bug-fix build) and `usability` (research build).

- run 7 (pre-registered, c-flag-rollout-change, fixed): `info feature-flag-create` — Error: [exec]: Unknown tool: "feature-flag-create". Run "search feature-flag-create" to find the current tool name before claiming the capability is unavailable.
- run 8 (pre-registered, c-flag-rollout-change, baseline): `info feature-flag-create` — Error: [exec]: Unknown tool: "feature-flag-create". Run "search feature-flag-create" to find the current tool name before claiming the capability is unavailable.
- run 8 (pre-registered, c-flag-rollout-change, baseline): `info feature-flag-update` — Error: [exec]: Unknown tool: "feature-flag-update". Run "search feature-flag-update" to find the current tool name before claiming the capability is unavailable.
- run 18 (pre-registered, f-tag-triage, usability): `call insights-batch-update` — Error: [exec]: Tool "insights-batch-update" is destructive (it deletes or overwrites data), so the call needs --confirm. Nothing ran. Check the target IDs with the user's request, then re-run it as "call --confirm insights-batch-update <jso
- run 20 (friction-derived, h-bulk-tag-annotate, usability): `call insights-batch-update` — Error: [exec]: Tool "insights-batch-update" is destructive (it deletes or overwrites data), so the call needs --confirm. Nothing ran. Check the target IDs with the user's request, then re-run it as "call --confirm insights-batch-update <jso
- run 21 (friction-derived, h-bulk-tag-annotate, fixed): `call execute-sql` — Error: [execute-sql]: Tool failed: MaxToolRetryableError: Query validation failed: Unable to resolve field: tags. Available fields: id, short_id, team_id, name, description, filters, query, query_metadata, deleted, saved, favorited, created
- run 30 (friction-derived, k-funnel-step-edit, usability): `call insight-get` — Error: [insight-get]: Request failed: Path: GET /api/projects/<project>/insights/<id>/ Status Code: 404 (Not Found) Error Message: {"type":"invalid_request","code":"not_found","detail":"Not found.","attr":null}
- run 30 (friction-derived, k-funnel-step-edit, usability): `call insight-get` — Error: [insight-get]: Request failed: Path: GET /api/projects/<project>/insights/<id>/ Status Code: 404 (Not Found) Error Message: {"type":"invalid_request","code":"not_found","detail":"Not found.","attr":null}
- run 39 (friction-derived, h-bulk-tag-annotate, usability): `call execute-sql` — Error: [execute-sql]: Tool failed: MaxToolRetryableError: Query validation failed: Unable to resolve field: tags. Available fields: id, short_id, team_id, name, description, filters, query, query_metadata, deleted, saved, favorited, created
- run 39 (friction-derived, h-bulk-tag-annotate, usability): `call insights-batch-update` — Error: [exec]: Tool "insights-batch-update" is destructive (it deletes or overwrites data), so the call needs --confirm. Nothing ran. Check the target IDs with the user's request, then re-run it as "call --confirm insights-batch-update <jso
- run 46 (friction-derived, j-survey-edit-question, usability): `call execute-sql` — Error: [execute-sql]: Tool failed: MaxToolRetryableError: Query validation failed: Unable to resolve field: archived. Available fields: id, team_id, name, type, questions, appearance, start_date, end_date, created_by_id, created_at.. You ma
- run 47 (friction-derived, j-survey-edit-question, baseline): `call execute-sql` — Error: [execute-sql]: Tool failed: MaxToolRetryableError: Query validation failed: Unable to resolve field: archived. Available fields: id, team_id, name, type, questions, appearance, start_date, end_date, created_by_id, created_at.. You ma
- run 48 (friction-derived, j-survey-edit-question, fixed): `call execute-sql` — Error: [execute-sql]: Tool failed: MaxToolRetryableError: Query validation failed: Unable to resolve field: archived. Available fields: id, team_id, name, type, questions, appearance, start_date, end_date, created_by_id, created_at.. You ma
- run 60 (friction-derived, g-dashboard-five-tiles, usability): `call insight-create` — Error: [exec]: This request held 5 commands, and exec batches read-only commands only. Nothing ran. Send each of these as its own exec call, so a write is seen and confirmed on its own: - call insight-create {"name":"bench-64ff29b657a3-r060
- run 68 (pre-registered, c-flag-rollout-change, fixed): `info feature-flag-create` — Error: [exec]: Unknown tool: "feature-flag-create". Run "search feature-flag-create" to find the current tool name before claiming the capability is unavailable.
- run 68 (pre-registered, c-flag-rollout-change, fixed): `info feature-flag-update` — Error: [exec]: Unknown tool: "feature-flag-update". Run "search feature-flag-update" to find the current tool name before claiming the capability is unavailable.
- run 69 (pre-registered, c-flag-rollout-change, baseline): `info feature-flag-create` — Error: [exec]: Unknown tool: "feature-flag-create". Run "search feature-flag-create" to find the current tool name before claiming the capability is unavailable.
- run 93 (pre-registered, b-insight-rename, usability): `call execute-sql` — Error: [execute-sql]: Tool failed: MaxToolRetryableError: Query validation failed: Unable to resolve field: tags. Available fields: id, short_id, team_id, name, description, filters, query, query_metadata, deleted, saved, favorited, created
- run 96 (pre-registered, a-dashboard-three-insights, usability): `call insight-create` — Error: [exec]: This request held 3 commands, and exec batches read-only commands only. Nothing ran. Send each of these as its own exec call, so a write is seen and confirmed on its own: - call insight-create {"name":"bench-64ff29b657a3-r096
- run 100 (pre-registered, c-flag-rollout-change, usability): `info feature-flags-partial-update` — Error: [exec]: Unknown tool: "feature-flags-partial-update". Closest tool names: "update-feature-flag", "feature-flag-update-conditions", "early-access-feature-partial-update". If none of these fits, run "search feature-flags-partial-update
- run 101 (pre-registered, c-flag-rollout-change, fixed): `info feature-flag-create` — Error: [exec]: Unknown tool: "feature-flag-create". Run "search feature-flag-create" to find the current tool name before claiming the capability is unavailable.
- run 102 (pre-registered, c-flag-rollout-change, baseline): `info feature-flag-create` — Error: [exec]: Unknown tool: "feature-flag-create". Run "search feature-flag-create" to find the current tool name before claiming the capability is unavailable.
- run 106 (friction-derived, h-bulk-tag-annotate, baseline): `call execute-sql` — Error: [execute-sql]: Tool failed: MaxToolRetryableError: Query validation failed: Unable to resolve field: tags. Available fields: id, short_id, team_id, name, description, filters, query, query_metadata, deleted, saved, favorited, created
- run 107 (friction-derived, h-bulk-tag-annotate, usability): `call insights-batch-update` — Error: [exec]: Tool "insights-batch-update" is destructive (it deletes or overwrites data), so the call needs --confirm. Nothing ran. Check the target IDs with the user's request, then re-run it as "call --confirm insights-batch-update <jso
- run 108 (friction-derived, h-bulk-tag-annotate, fixed): `call execute-sql` — Error: [execute-sql]: Tool failed: MaxToolRetryableError: Query validation failed: Unable to resolve field: tags. Available fields: id, short_id, team_id, name, description, filters, query, query_metadata, deleted, saved, favorited, created

### Runs the checker marked incorrect

- run 77 l-cleanup (friction-derived, fixed): failed criteria reported_count_matches, tmp_insights_gone

### Two-build series (10 November 2026), for reference

Before the research build existed, the same six pre-registered tasks ran on the unmodified and bug-fix builds only (36
runs, manifest `e27c0aac…`, the same instance before it was rebuilt from clean, same model and harness). The bug fixes did
not reduce calls or turns there either:

| Totals over 18 runs per build | Unmodified | Bug-fix build |
|---|---|---|
| Runs correct | 18 of 18 | 18 of 18 |
| Tool calls, total | 143 | 156 (+9.1%) |
| PostHog MCP calls, total | 125 | 138 (+10.4%) |
| Model turns, total | 161 | 174 (+8.1%) |
| Tool-result bytes, total | 610,245 | 717,198 (+17.5%) |
| Failed tool calls, total | 4 | 6 |
| Cost, USD (SDK estimate), total | 1.70 | 1.89 (+11.0%) |

Per-task tables: [`2026-11-10-two-builds/ANALYSIS.md`](2026-11-10-two-builds/ANALYSIS.md).

## Limitations

- Three repetitions per task and build show spread, not a distribution; no significance test is claimed.
- One model, one client (Claude Agent SDK), one server mode (`cli`). Other models, clients or the `tools` mode may behave
  differently.
- The pre-registered tasks were written by the team that wrote the fixes, from the same audit findings. They say how the
  builds do on these tasks, not how the server does on PostHog work in general.
- The friction-derived set favours the research build by construction and must not be read as a fair comparison.
- The research build is measured as a whole, on top of the bug fixes; the effect of each change is attributed by reading
  which tools the agents called.
- Correctness is a mechanical end-state check with exact criteria; a run can be marked incorrect for a deviation a person
  would accept. The one incorrect run (cleanup, bug-fix build) mistook two live objects for already-deleted ones, which
  PostHog's `system.*` tables also list; those leftovers exist for all three builds.
- Cost is the SDK's estimate and depends on prompt-cache state; builds of one task ran back to back in a balanced order to
  spread cache and time effects, which does not remove them.
- Self-hosted PostHog open source, not PostHog Cloud. The local build also differs from PostHog's hosted MCP server: Node
  25 instead of the pinned Node 26, no edge worker, a local Redis, analytics off, UI apps not built, skills archives
  served from a pinned local copy.
- The agents' own friction notes were collected but are opinions, not used in any number here, and not published.
- Fixtures are reset by repair, not by a fresh project; the state hash covers the benchmark's own objects only.

## Data in this folder

| Path | Contents |
| --- | --- |
| `2026-11-11-three-builds/ANALYSIS.md` | The harness's analysis of the measured three-build series, including per-tool call counts and every attempt |
| `2026-11-11-three-builds/runs.csv` | One row per measured run: task set, task, build, repetition, correctness and failed criteria, calls, turns, failures, bytes, tokens, cost, wall time, bundle hash |
| `2026-11-11-three-builds/calls.jsonl` | Per run, the sequence of tool calls: tool, `exec` verb and tool name, argument and result bytes, error flag, latency. No arguments or results |
| `2026-11-11-three-builds/MANIFEST.public.json` | The frozen manifest with the local key path, self-host directory, organization id and project id replaced (so it no longer hashes to `ba289984…`) |
| `2026-11-10-two-builds/` | The same files for the earlier two-build series |
| `builds/*.BUILD.json` | Each build's record: commit, patches applied (and K3, recorded as not applied), bundle and source-tree hashes, Node and pnpm versions |
| `summarize.py` | Recomputes the tables above from a `runs.csv` |

Not published: raw transcripts, MCP request and response captures, end-state snapshots, final answers and the agents'
friction notes. They contain identifiers and tokens of the local test instance; the numbers above are computed from them
by the harness ([`harness/bench/analyze.py`](../harness/bench/analyze.py)).
