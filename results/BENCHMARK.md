# Before/after benchmark: PostHog MCP server 7b516983, fixed build and usability build

Source: [IsoKron, PostHog MCP server audit](https://isokron.ai/research/posthog-mcp-server-audit). "Baseline" is tag
`upstream-7b516983`, "fixed" is tag `fixed-r3`, "usability" is tag `usability-r3` of this repository.

On six pre-registered tasks against a self-hosted PostHog open-source instance, an IsoKron research build of PostHog's MCP
server with 14 bug fixes and 17 usability changes used 15% fewer tool calls (median 41 against 48 per round of the six
tasks) and 13% fewer turns (47 against 54) than the unmodified server, with all 54 runs passing their end-state checks
and no overlap between the builds' observed ranges. The bug fixes alone changed neither. On six further tasks written from
the friction session after the changes were designed, which favour the usability build by construction, calls fell 30%
and tool-result bytes 62%. Results measure each combined set of changes, not each change individually.

## Setup

- **Backend:** a self-hosted PostHog open-source instance at the same commit as the server (`7b516983`), PostHog's hobby
  deployment adapted for loopback with every image pinned by digest ([`selfhost/`](../selfhost/)). No request reached
  PostHog Cloud: the MCP server ran with a loopback-only egress guard that logs every connection. This is not a
  measurement of PostHog Cloud, whose behaviour may differ; self-hosted PostHog has the free-plan feature set, and every
  task uses only features available there.
- **Agent:** `claude-sonnet-5-5` through the Claude Agent SDK 0.3.319 (Claude Code 2.1.319). Every built-in tool removed
  except tool search; the local PostHog MCP server is the only tool source, in its default `cli` mode (one `exec` tool
  reaching the whole catalog through `search`, `info`, `schema` and `call`). Max turns 40 for single-object tasks, 60
  for multi-object tasks; 4 USD cap per run.
- **Builds:** the three bundles in [EXPERIMENT.md](../EXPERIMENT.md#three-builds), built from source with Node 25.8.1;
  each run checked the bundle hash before starting the server.
- **Design:** 12 tasks x 3 builds x 3 repetitions = 108 runs, one at a time. In each repetition the twelve tasks are
  shuffled; each task runs on the three builds back to back; the build order of each block is one of the six
  permutations, each used six times. Fixtures (all named `bench-<nonce>-...`) are seeded through the REST API and reset
  before every run until their state hash matches the seeded one.
- **Freeze:** before the first measured run the harness files, build hashes, plan and order seed were hashed into a
  manifest (`ba289984…`) and timestamped (RFC 3161). Three unmeasured dry runs before it found checker and harness
  defects, which were fixed with tests and a new freeze before anything was measured.
- **Scoring:** a mechanical checker reads PostHog's end state through the REST API and applies exact criteria per task,
  including "nothing else changed". No model judges anything.
- **Cost:** 11.50 USD in API usage for the 108 measured runs.

Definitions: a **tool call** is one tool invocation by the agent (all runs include one tool-search call); a **PostHog MCP
call** is one `exec` call; a **turn** is one model response cycle; a **failed call** is a tool call that returned an
error; **tool-result bytes** are the bytes of every tool result the agent received; a **passing run** met all its
end-state criteria. A run can pass although some calls failed, when the agent recovered.

## Task sets

**Pre-registered** (the fair test; written and frozen on 10 November 2026 before the usability change list existed):
a dashboard with three saved insights (trend, funnel, retention); rename one insight and set its description, changing
nothing else; create a flag at 20% for two person-property filters, then raise only the rollout to 60%; count 120 flags
and list the 9 disabled ones; add a dashboard annotation at a given instant, then correct its text; tag the three insights
of eight that carry a review tag, keeping their other tags.

**Friction-derived** (written after the usability changes were designed, from the ten jobs of the friction session;
favours the usability build by construction; never pooled with the pre-registered set): a dashboard with five tiles of
four query kinds; tag ten insights and add eight annotations; add a variant to an A/B flag and re-split it; change the
text of one survey question; insert a funnel step and change the date range; delete twelve scratch objects of three kinds
while keeping a near-miss.

Full prompts and criteria: [`harness/bench/tasks/`](../harness/bench/tasks/) and
[`harness/bench/BENCH-PLAN.md`](../harness/bench/BENCH-PLAN.md).

## Results, three-build series (10-11 November 2026 UTC)

Per round: one complete run of all six tasks of a set; median over the 3 rounds with [min–max]. It is not the sum of the
per-task medians. Per task: median over 3 runs with [min–max]. With three runs per cell these ranges are descriptive,
not a significance test. Recompute every table here with `python3 results/summarize.py <runs.csv>`.

### Task set: pre-registered (54 runs)

| Per round of all 6 tasks (median of 3 rounds, [min–max]) | baseline | fixed | usability |
|---|---|---|---|
| Tool calls (all) | 48 [48–50] | 52 [48–53] | 41 [39–43] |
| PostHog MCP calls | 42 [42–44] | 46 [42–47] | 35 [33–37] |
| Turns | 54 [54–56] | 58 [54–59] | 47 [45–49] |
| Failed tool calls | 1 [1–2] | 1 [1–2] | 1 [0–3] |
| Tool-result bytes | 188652 [186397–229138] | 226390 [217976–246693] | 139775 [113241–206777] |
| Reported cost, USD | 0.59 [0.54–0.60] | 0.64 [0.58–0.68] | 0.58 [0.52–0.62] |
| Runs passing their end-state checks | 18 of 18 | 18 of 18 | 18 of 18 |

| Task | Build | Correct | Tool calls | Turns | Failed calls | Result bytes |
|---|---|---|---|---|---|---|
| a-dashboard-three-insights | baseline | 3/3 | 10 [9–10] | 11 [10–11] | 0 [0–0] | 67168 [53549–67417] |
| a-dashboard-three-insights | fixed | 3/3 | 10 [9–10] | 11 [10–11] | 0 [0–0] | 57587 [53521–67137] |
| a-dashboard-three-insights | usability | 3/3 | 8 [8–8] | 9 [9–9] | 0 [0–1] | 35443 [35443–41038] |
| b-insight-rename | baseline | 3/3 | 6 [6–7] | 7 [7–8] | 0 [0–0] | 27343 [26308–35556] |
| b-insight-rename | fixed | 3/3 | 6 [6–7] | 7 [7–8] | 0 [0–0] | 26693 [26565–35661] |
| b-insight-rename | usability | 3/3 | 6 [6–8] | 7 [7–9] | 0 [0–1] | 21894 [21511–28963] |
| c-flag-rollout-change | baseline | 3/3 | 7 [7–9] | 8 [8–10] | 1 [1–2] | 23752 [23752–24196] |
| c-flag-rollout-change | fixed | 3/3 | 8 [7–9] | 9 [8–10] | 1 [1–2] | 24035 [23752–24196] |
| c-flag-rollout-change | usability | 3/3 | 4 [4–6] | 5 [5–7] | 0 [0–1] | 17751 [17751–22863] |
| d-flag-inventory | baseline | 3/3 | 6 [6–7] | 7 [7–8] | 0 [0–0] | 11915 [11432–58467] |
| d-flag-inventory | fixed | 3/3 | 7 [7–7] | 8 [8–8] | 0 [0–0] | 57984 [57984–57984] |
| d-flag-inventory | usability | 3/3 | 5 [4–5] | 6 [5–6] | 0 [0–0] | 11875 [11875–95935] |
| e-annotate-deploy | baseline | 3/3 | 10 [10–11] | 11 [11–12] | 0 [0–0] | 12546 [12260–12546] |
| e-annotate-deploy | fixed | 3/3 | 12 [11–12] | 13 [12–13] | 0 [0–0] | 15222 [14251–15481] |
| e-annotate-deploy | usability | 3/3 | 10 [9–10] | 11 [10–11] | 0 [0–0] | 10608 [9890–10823] |
| f-tag-triage | baseline | 3/3 | 8 [8–9] | 9 [9–10] | 0 [0–0] | 45268 [45033–45679] |
| f-tag-triage | fixed | 3/3 | 9 [7–9] | 10 [8–10] | 0 [0–0] | 45679 [40673–46654] |
| f-tag-triage | usability | 3/3 | 7 [7–8] | 8 [8–9] | 0 [0–1] | 25146 [15838–25146] |

### Task set: friction-derived (54 runs)

| Per round of all 6 tasks (median of 3 rounds, [min–max]) | baseline | fixed | usability |
|---|---|---|---|
| Tool calls (all) | 81 [76–88] | 86 [73–90] | 57 [54–58] |
| PostHog MCP calls | 75 [70–82] | 80 [67–84] | 51 [48–52] |
| Turns | 87 [82–94] | 92 [79–96] | 63 [60–64] |
| Failed tool calls | 1 [0–1] | 1 [1–1] | 3 [1–4] |
| Tool-result bytes | 324367 [288444–352631] | 293954 [291786–302737] | 122825 [116400–142436] |
| Reported cost, USD | 0.78 [0.69–0.82] | 0.70 [0.67–0.72] | 0.59 [0.57–0.61] |
| Runs passing their end-state checks | 18 of 18 | 17 of 18 | 18 of 18 |

| Task | Build | Correct | Tool calls | Turns | Failed calls | Result bytes |
|---|---|---|---|---|---|---|
| g-dashboard-five-tiles | baseline | 3/3 | 12 [11–13] | 13 [12–14] | 0 [0–0] | 79386 [65440–100324] |
| g-dashboard-five-tiles | fixed | 3/3 | 12 [11–12] | 13 [12–13] | 0 [0–0] | 70931 [63360–71204] |
| g-dashboard-five-tiles | usability | 3/3 | 9 [9–10] | 10 [10–11] | 0 [0–1] | 37426 [37426–38967] |
| h-bulk-tag-annotate | baseline | 3/3 | 28 [28–39] | 29 [29–40] | 0 [0–1] | 83894 [83894–133941] |
| h-bulk-tag-annotate | fixed | 3/3 | 37 [26–37] | 38 [27–38] | 1 [0–1] | 87148 [78334–88946] |
| h-bulk-tag-annotate | usability | 3/3 | 10 [10–11] | 11 [11–12] | 1 [1–2] | 19477 [13839–27006] |
| i-flag-add-variant | baseline | 3/3 | 5 [5–5] | 6 [6–6] | 0 [0–0] | 25807 [25807–25911] |
| i-flag-add-variant | fixed | 3/3 | 5 [5–5] | 6 [6–6] | 0 [0–0] | 25808 [25807–25809] |
| i-flag-add-variant | usability | 3/3 | 5 [4–5] | 6 [5–6] | 0 [0–0] | 23216 [23193–23329] |
| j-survey-edit-question | baseline | 3/3 | 6 [6–7] | 7 [7–8] | 0 [0–1] | 58741 [58191–59011] |
| j-survey-edit-question | fixed | 3/3 | 6 [6–7] | 7 [7–8] | 0 [0–1] | 61030 [59012–61032] |
| j-survey-edit-question | usability | 3/3 | 5 [5–7] | 6 [6–8] | 0 [0–1] | 6658 [6577–6659] |
| k-funnel-step-edit | baseline | 3/3 | 6 [6–6] | 7 [7–7] | 0 [0–0] | 28614 [28519–28735] |
| k-funnel-step-edit | fixed | 3/3 | 7 [6–7] | 8 [7–8] | 0 [0–0] | 28492 [28470–29086] |
| k-funnel-step-edit | usability | 3/3 | 9 [7–10] | 10 [8–11] | 0 [0–2] | 25921 [16464–33855] |
| l-cleanup | baseline | 3/3 | 20 [20–22] | 21 [21–23] | 0 [0–0] | 26588 [26043–26596] |
| l-cleanup | fixed | 2/3 | 21 [17–22] | 22 [18–23] | 0 [0–0] | 28489 [24151–31368] |
| l-cleanup | usability | 3/3 | 18 [17–18] | 19 [18–19] | 0 [0–0] | 14161 [13182–14305] |

### Where the calls went

- **Flag rollout change (task c):** every baseline and fixed run first asked for `feature-flag-create`, which does not
  exist (the catalog names it `create-feature-flag`), and failed; the usability build resolves that guess to the real
  tool, and two of its three runs needed no other discovery call. Calls per run 7 → 4.
- **Bulk tag and annotate (task h):** 28 calls per run on the baseline (one `insight-update` per insight and one
  `annotation-create` per annotation) against 10 with the batch tools.
- **Dashboard with five tiles (task g) and three insights (task a):** short write receipts cut tool-result bytes by about
  half (79,386 → 37,426 and 67,168 → 35,443 per run).
- **Survey question edit (task j):** `survey-update-question` replaced reading and resending the whole survey; tool-result
  bytes per run fell from 58,741 to 6,658.
- **Funnel step edit (task k):** the usability build used more calls here (median 9 against 6): its agents looked up
  both the new partial-update tool and the old update tool, and one run hit two not-found reads while locating the
  insight. All runs of all builds passed.
- **Fixed build:** the bug fixes target defects the tasks rarely hit; the fixed build used slightly more calls than the
  baseline on both sets, within the spread of three runs.

### Failed tool calls, with the reason the server gave

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

Before the usability build existed, the same six pre-registered tasks ran on the baseline and fixed builds only (36 runs,
manifest `e27c0aac…`, same instance, model and harness). The bug fixes did not reduce calls or turns:

### Two-build series, pre-registered tasks (36 runs)

| Per round of all 6 tasks (median of 3 rounds, [min–max]) | baseline | fixed |
|---|---|---|
| Tool calls (all) | 48 [47–48] | 52 [48–56] |
| PostHog MCP calls | 42 [41–42] | 46 [42–50] |
| Turns | 54 [53–54] | 58 [54–62] |
| Failed tool calls | 1 [1–2] | 2 [1–3] |
| Tool-result bytes | 213569 [175547–221129] | 220669 [197502–299027] |
| Reported cost, USD | 0.58 [0.53–0.59] | 0.62 [0.60–0.67] |
| Runs passing their end-state checks | 18 of 18 | 18 of 18 |

Per-task tables: [`2026-11-10-two-builds/ANALYSIS.md`](2026-11-10-two-builds/ANALYSIS.md).

## Limitations

- Three repetitions per task and build show spread, not a distribution; no significance test is claimed.
- One model, one client (Claude Agent SDK), one server mode (`cli`). Other models, clients or the `tools` mode may behave
  differently.
- The pre-registered tasks were written by the team that wrote the fixes, from the same audit findings. They say how the
  builds do on these tasks, not how the server does on PostHog work in general.
- The friction-derived set favours the usability build by construction and must not be read as a fair comparison.
- Correctness is a mechanical end-state check with exact criteria; a run can be marked incorrect for a deviation a person
  would accept.
- Reported cost is the SDK's estimate and depends on prompt-cache state; builds of one task ran back to back in a
  balanced order to spread cache and time effects, which does not remove them.
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
