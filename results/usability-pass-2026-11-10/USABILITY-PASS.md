# PostHog MCP usability pass: unmodified server, self-hosted, 10 November 2026

Published copy of IsoKron's report of the usability pass behind the research build in this repository. It is edited
for publication: the local instance's identifiers, object ids and file paths are removed, the call ledger and raw
responses it cites are not published (call numbers such as #57 refer to that ledger), and the wording follows the
published article (lookup overhead, unmodified, bug-fix build, research build, the design-pattern names). The findings,
numbers and rankings are as written on 10 November 2026, before the research build existed; they are estimates from one
session, not measurements of a changed server. Results of the research build are in [BENCHMARK.md](../BENCHMARK.md).

All token figures are tokens (cl100k estimate), counted with tiktoken 0.14.0; cl100k is not Claude's tokenizer.

## How this was run

- **Server.** The unmodified bundle (PostHog master `7b516983`, sha256 `d573fa77…`), started with the harness's
  `server/start-server.sh baseline`, behind `server/mcp-proxy.mjs --mode cli --target selfhosted` (the proxy adds the
  key). Redis is the harness container.
- **Backend.** The self-hosted instance only (`TARGET=selfhosted`, loopback). Nothing touched PostHog Cloud. The server's
  `[egress]` log shows only loopback connections (the instance, the skills archives and Redis), with none refused. The
  proxy captured 178 requests.
- **Client and agent.** A hand-written JSON-RPC client logged every request and response with bytes and a token count.
  An AI agent in an IsoKron working session drove it: each next call was decided from the previous response, the
  server's rules were followed, and every guess was recorded. In the text below, "I" is that agent.
- **Turns.** "Turns" counts calls issued in parallel as one turn, the way a careful agent would batch them. Many agents
  would not parallelise 10 to 14 writes, so for jobs 3 and 10 the turn counts are a lower bound.
- **Needed-data tokens.** A mechanical extraction from each response, not a judgement:
  - info, schema and search responses (lookup overhead) count as 0;
  - errors count in full;
  - query results count in full, except retention (result rows only) and the `read-data-schema` events list (seen
    events only);
  - writes, deletes and gets count only the lines with id, short_id, key, name, version, active, deleted, status,
    tags, content, date_marker or rollout, plus the tile-id rows.
- **Environment calls.** Three calls were wasted on a stale self-hosted taxonomy cache (#41–#43, 9,339 tokens). They are
  marked `env` and left out of the job totals.
- **Data seeding.** The project had no events, so synthetic events were sent to the instance's own ingestion endpoint:
  5,666 events from 2026-10-13 to 2026-11-09 for 2,047 synthetic persons, with a planted story (on Tue 2026-11-03,
  release 2.4.0, Safari signups fail with `captcha_timeout`; 2.4.1 fixes it on 11-04). Fixtures created by REST: one
  2-step funnel, 12 old insights and 5 event definitions (ingestion cannot write event definitions on this instance, see
  B7).

## 1. Ledger summary per job

Jobs 1–10 only. Setup, probes and the job-4 second attempt are listed separately. Every row is a measurement from `ledger.jsonl`.

| job | goal → done-check | calls | agent turns | response, tokens (cl100k estimate) | lookup overhead, tokens (info/schema/search) | needed data, tokens | errors | guesses |
|---|---|---|---|---|---|---|---|---|
| 1 dashboard | 4 tiles (trend, 3-step funnel, retention, HogQL table), then a 5th tile and a reorder → reorder echo shows the order 58,57,61,59,60 | 36 (+3 env) | 13 | 66,924 | 37,142 (55%) | 5,168 | 0 | 1 |
| 2 edit funnel | add a step, set the date range to -30d, rename → update echo shows 3 steps, -30d and the new name | 5 | 4 | 5,793 | 3,732 (64%) | 365 | 0 | 0 |
| 3 bulk | tag 10 insights, add 8 annotations, "archive" 5 → write echoes | 30 | 6 | 21,677 | 2,372 (11%) | 1,626 | 0 | 1 |
| 4 flags | flag with 2 conditions → rollout 75 → variants → disabled; list with rollout; filter by tag → SQL rows plus a tag-filtered list | 16 | 13 | 23,448 | 20,725 (88%) | 694 | 0 | 0 |
| 5 experiment | draft experiment on an existing flag plus a funnel metric → echo shows the metric (works on the open-source edition) | 6 | 6 | 9,878 | 9,491 (96%) | 46 | 0 | 2 |
| 6 cohort | behavioural cohort used as an insight filter → insight-query returns 42/20/7 | 7 | 7 | 8,677 | 6,522 (75%) | 257 | 0 | 2 |
| 7 survey | 3 questions, then change one question's text → echo | 5 | 5 | 21,994 | 20,451 (93%) | 424 | 0 | 0 |
| 8 actions/defs | create an action, rename an event definition (not possible), set a property type → echoes | 9 | 3 | 6,255 | 5,333 (85%) | 122 | 0 | 1 |
| 9 investigation | "why did signups drop last Tuesday?" → answered: Safari 0/8 completions on 2.4.0, 8 `captcha_timeout`; traffic and starts normal | 9 | 4 | 2,478 | 944 (38%) | 1,534 | 0 | 0 |
| 10 cleanup | delete everything through MCP → REST inventory equals the before-inventory (after a REST follow-up) | 35 | 4 | 21,874 | 1,517 (7%) | 1,451 | 1 | 1 |
| **total** | | **158** | **65** | **188,998** | **108,229 (57%)** | **11,687 (6.2%)** | 1 | 8 |

- **Context sent every turn.** The `exec` tool definition is 9,570 tokens and the server instructions 322: 9,892 tokens per turn, over 65 turns.
- **Setup (not agent work):** `help`, `project-get` (1,348 tokens, of which 309 are the 65 setup-task ids), `resources/list` (18,997 tokens) and `prompts/list`.
- **Second attempt, job 4 (alternatives):** 6 calls, 772 tokens, 2 errors.
- **Probes:** 4 calls, 3 errors, all deliberate.
- **Write echoes across all jobs.** 73 successful write and delete calls returned 61,363 tokens, of which 4,187 were needed. Within the 61,363:
  - 18,226 were `created_by`/`last_modified_by`/`updated_by` objects;
  - 7,807 were `_agentNote`s;
  - 4,708 were compiled HogQL.
- **Calls the server told me to make that only repeated work.** The insight-create `_agentNote` says to "call insight-query" after creating. Doing so (job 1: 3 calls, 484 tokens; job 6: 1 call, 82 tokens) returned results byte-identical to the test queries run just before saving.

**The 8 guesses:**
1. #12: `building-a-dashboard` skill required, but `learn` is unavailable.
2. #33: `creating-experiments` skill and `experiment-setup-context` named, but neither exists here.
3. #113: `configuring-experiment-analytics` skill required, but unavailable.
4. #101: insights have no archive, so I used soft-delete.
5. #108: the behavioural cohort `value`/`operator` are untyped strings, so I used `performed_event` from prior knowledge.
6. #110: knowingly skipped the mandated `breakdownFilter`/`trendsFilter` drill-down.
7. #121: event definitions cannot be renamed, so I set a description instead.
8. #151: there is no cohort delete tool, so I used `cohorts-partial-update {deleted:true}`.

## 2. Friction register

Numbering continues the 4 November log. A12 already exists there (write-time cross-checks), so new A items start at A13. New bugs start at B7. (A items are write-path friction, P items prompts and descriptions, I items response size, B items bugs.)

### New items

**A13 — Test, save, then re-query: the same query runs three times** (job 1 #56–#59, #61–#64, #65–#67; job 6 #110–#112)
- The `insight-create` description says to test with `query-*` first. Its `_agentNote` then says: "After creating a Trends, SQL (HogQL), Funnels or Metrics insight, call insight-query with the returned short_id".
- The re-query returned the same rows as the test. For example #57 and #66 are both 164 tokens, and #59 and #67 differ only because `{filters}` -7d is day-aligned.
- Cost: 4 extra calls and 566 tokens, plus the saves.
- Fix: `insight-create` should run and return the first page of results, or take `validate_only`.

**A15 — "List flags with their rollout" needs either SQL plus 10.7K tokens of lookup overhead, or N+1 reads** (job 4 #24–#30; 4b #134–#136)
- `call feature-flag-get-all {}` rows carry no filters or rollout (#26, 285 tokens). The instructions send "list" questions to `system.*` SQL, which needs `info execute-sql` (#27, 10,742 tokens) and a columns query (#28).
- `system.feature_flags` has no `tags` or `active` column, so the tag filter still needed `feature-flag-get-all {"tags":"[\"friction-checkout\"]"}` (#30). That parameter is a JSON-encoded string inside JSON.
- The alternative, `feature-flags-status-retrieve`, is one call per flag (#135, #136).
- Cost: 4 calls and 11,229 tokens for 2 flags.

**A16 — One-field edits resend whole nested arrays**
- To add variants, `update-feature-flag` needed both unchanged conditions resent with `condition_id`s (#22, 231 request tokens). The description warns: "sending `filters` replaces the whole object".
- `survey-update` needed all 3 questions resent to change one string (#40, 246 request tokens).
- `insight-update` needed the full query resent (#75, 169 request tokens).
- Request cost is small. The risk is silent loss of a condition or question.
- The well-designed counterexample is `feature-flag-set-release-condition-rollout` (#20): it takes index plus version and echoes 200 tokens.

**A17 — Deletes don't cascade and don't say what blocks them until you try** (#151, then #176 after deleting the insight that used the cohort)
- Error text: "This cohort is used in 1 insight(s) … Please remove the cohort from these insights before deleting it."
- The error is clear. Cost: 1 error and 1 extra turn.

**P10 — Skills are required, but `learn` is off on this connection** (jobs 1, 5, 7)
- The instructions say "Prioritize skills over tools."
- `dashboard-create` says "Load the building-a-dashboard skill before you create…", and its `_agentNote` repeats "load it now" (#60).
- `experiment-create` and `experiment-update` "RULES" require 3 skills (#32, #34). `survey-create` names `creating-surveys`.
- `help` lists no `learn` verb (#2). `learn` depends on a PostHog feature flag (`MCP_EXEC_SKILLS_FEATURE_FLAG`, `src/hono/instructions.ts` `getExecLearnCapabilities`), evaluated through the analytics client. Self-hosted and local builds have no analytics key, so they never get it.
- Cost: 3 of the 8 guesses. The token cost is in the description text.

**P11 — The instructions send dashboards to the wrong tool**
- The exec description says "Dashboard (`dashboard-create` plus `dashboard-widgets-batch-add`)".
- `info dashboard-widgets-batch-add` (#10, 1,067 tokens) shows its `widget_type` enum is 11 non-insight widgets. Insight tiles are added with `insight-create {dashboards:[id]}`, which the instructions never say.
- Cost: 1 wasted info call (1,067 tokens).

**P12 — Inconsistent tool names**
- Verb-first `create-feature-flag`, `update-feature-flag`, `delete-feature-flag` sit next to noun-first `feature-flag-get-all`, `feature-flag-disable`, `experiment-create`.
- `actions-get-all` (plural) sits next to `action-create`: `search action-` (#114) does not find the list tool.
- `feature-flags-bulk-update-tags-create` is an update whose name ends in "-create".
- `event-definition-update` takes camelCase `eventName` plus a nested `data` object, where the other tools take `id` and flat fields (#118).
- The exec description's own "Example tool names: execute-sql, experiment-create, feature-flag-get-all" (`templates/sections/tool-search.md:26`) teaches the noun-first pattern.
- Measured: `info feature-flag-create` and `info feature-flag-update` gave 2 errors of 33 tokens each (#132, #133); the recovery search cost 336 tokens (#137).
- The benchmark shows the same miss in every task-c run (6 of 6) and a second miss in 2 runs.

**P13 — The unknown-tool error contradicts the instructions**
- The instructions say "If a tool call fails, the error includes a suggestion and similar tool names."
- The unknown-tool error (#132) carries no names: "Unknown tool: "feature-flag-create". Run "search feature-flag-create"…"
- Cost: 1 forced search turn per miss (336 tokens in #137).

**P14 — PostHog AI planner wording leaks into MCP schemas**
- There are 91 occurrences of "…in the plan" / "from the plan" in this session's info and schema responses. Example: "Use one of the properties the user has provided in the plan." (#54, #109, #126).
- The source is `frontend/src/queries/schema/schema-assistant-queries.ts`, carried into `services/mcp/src/tools/generated/query-wrappers.ts`. An MCP agent has no plan.

**P15 — The same concept has different shapes across query tools, so drill-downs are forced**
- Retention entities use `{type:"events", id, name}`; series use `{kind:"EventsNode", event}`.
- Trends use `breakdownFilter.breakdowns:[{property,type}]`; funnels use `breakdown` plus `breakdown_type` (#126, #127).
- This confirms the 4 November note at row 33.
- Cost: the two retention entity drills were 6,761 and 6,760 tokens (#54, #55), 99.91% identical to each other.

**P16 — "Schema first, every run" makes find-by-name 3 calls**
- The rule is: columns query, then the `system.*` query, then `<entity>-get` (#71, #72, #73; also #28). Each columns call is small (122–215 tokens), but costs 1 call and 1 turn every time.
- `metric-list` is mandated per request (#6, #123: 102 tokens each, empty catalog both times).

**P17 — `survey-delete` only archives**
- Its description says "Delete a survey by ID (soft delete - marks as archived)". The survey stayed in the surveys list and kept its internal targeting flag (#149), so cleanup needed REST.

**P18 — Insights have no "archive"** (job 3, guess #101)
- No archive tool or field exists, so the agent has to pick between soft-delete and a tag.

**P19 — Event definitions cannot be renamed** (job 8 #118, #121)
- `event-definition-update` has no `name` field. This is a capability gap, not a server defect.

**P20 — `--confirm` is described as required but is not enforced over MCP**
- The description says "--confirm is required by the CLI for destructive tools". `insight-delete` (destructiveHint true) ran without it (#101–#105). `requireDestructiveConfirmation` only exists for the agent CLI (`exec.ts:2164`).
- This is ambiguous rather than harmful.

**I6 — `dashboard-reorder-tiles` echoes the whole dashboard** (#70)
- The echo has every tile's query, compiled HogQL (2,133 tokens) and cached results: 11,175 tokens to confirm an order. The needed part is about 400 tokens: tile ids and positions.
- `products/dashboards/mcp/tools.yaml` `dashboard-reorder-tiles` has no `response:` block.

**I7 — `insight-delete` echoes the whole insight, including cached results**
- 19 calls returned 19,519 tokens; 958 were needed.
- The retention insight's delete alone was 4,802 tokens (#172). The 5 deletes of insights that had been run carried a `result[...]` block.
- `insight-delete` has no `response:` block, while `insight-create` and `insight-update` exclude `result`.

**I8 — `query-retention` output is not compacted** (#58)
- 3,874 tokens, against 303 for trends (#56) and 164 for the funnel (#57). It contains a URL-encoded `_posthogUrl` (356 tokens), a query echo (151) and 29 cohorts × 8 cells, with 232 `null` aggregation_value cells.

**I10 — Update schemas repeat create schemas**
- `info insight-update` (3,732 tokens) has a `query` subschema identical to `insight-create`'s.
- `info update-feature-flag` (4,240) is 95.7% the same as `create-feature-flag` (3,454).
- `info survey-update` (10,288) is 95.4% the same as `survey-create` (10,084).
- `dateRange` comes back identical from three query tools (218 tokens each, #49, #51, #53).
- DRF "* `x` - x" choice lists, which repeat enums, appear in this session's info and schema responses: 628 fragments, 6,059 tokens.

**I11 — Clients without `learn` keep the full 9,570-token exec description on every turn**
- PR 129174's compact reference goes only to "CLI client with `learn`", so self-hosted and any client the flag does not include are unchanged.
- `info execute-sql` (10,742) repeats the exec description's "Metric discovery" section (594 tokens).

**B7 — Environment, self-hosted instance (not `services/mcp`)**
- `property-defs-rs` cannot write event definitions: `null value in column "enforcement_mode"`.
- `read-data-schema` served the 18:58 taxonomy snapshot at 19:37:53, 19:43:52, 19:44:49 and 19:45:10, while the 5,666 events were arriving or had arrived (sent 19:35) (#12, #41–#43). It refreshed only after a REST `force_blocking` with the same limit and offset (#44).
- The server's own rule ("If the event isn't in the schema, tell the user instead of querying") would have stopped a careful agent.
- Cost: 3 calls, 9,339 tokens (environment only).

**B8 — The `info execute-sql` example for feature flags is wrong**
- The example is `SELECT key, name, rollout_percentage FROM system.feature_flags`. Its own column description says top-level rollout, and the result was `(null)` for both flags (#29). The real rollouts are in `filters.groups`.

### Status of the 4 November items on today's master (`7b516983`)

| item | today | evidence | PR 129174 (draft, updated 2026-11-06) |
|---|---|---|---|
| A1 write lookup overhead | **reproduces** | lookup overhead is 57% of job response tokens; job 1 info+schema = 17 calls, 36,603 tokens | no |
| A2 whole-entity echoes | **reproduces** for insights, surveys, annotations, cohorts, actions and deletes (61,363 echo tokens, 4,187 needed); **does not reproduce** for flag state tools (rollout 200, disable 57, bulk-delete 44, experiment-delete 15 tokens) | #20, #25, #161, #148 | partly: `dashboard-update` only, not reorder or insights |
| A3 no exec batching | **reproduces** | #138: "exec runs one command per request, and this request held 2." | no |
| A4 / A7 no dashboard-with-tiles | **reproduces** | job 1: dashboard-create + 5 × insight-create + reorder | no |
| A5 settings verify | not re-tested (no project-settings write today) | | |
| A6 dashboard = many calls | **reproduces, larger**: 36 calls / 13 turns for 5 tiles | job 1 | no |
| A8 `_agentNote` on every write | **reproduces** | 649 tokens × 6 insight-create, 327 × 11 insight-update, 316 on dashboard-create | no |
| A9 no partial query update; duplicate update schema | **reproduces** | #74 query subschema identical to insight-create (3,732 tokens) | no |
| A10 no batch create | **reproduces** | 10 updates, 8 annotation creates, 8 annotation deletes, 19 insight deletes, one call each | no |
| A12 write-time cross-check | **reproduces** | survey created with `surveys_opt_in: null`, no warning (#38) | no |
| P1 contradictory instructions | different form now: see P10 | | |
| P2 conversation_id needed before parallel calls | **does not reproduce** | no response carried a conversation_id; parallel first-turn calls worked (#6–#8) | n/a |
| P3 lookup overhead cost | **reproduces** | see A1 | no |
| P4 internal-looking scope hint | **reproduces** | #76 suggests adding `signal_scout_internal:write` | no |
| P5, P6 | not re-tested (docs-search, activity logs) | | |
| P9 mandated lookup overhead often unnecessary | **reproduces, with direct evidence** | #139: missing `breakdownFilter.breakdown` named in 23 tokens (the drill cost 394); #140: both retention `id` fields named in 51 tokens (the drills cost 13,521) | no |
| I1 project-get bloat | **reproduces** (1,348 tokens incl. 65 setup ids) | #3 | **yes** (PR: 2,147 → 724) |
| I2 full exec reference | **reproduces** for non-`learn` clients (9,570 per turn) | init | partly: compact only with `learn` |
| I3 learn ranking | not testable (`learn` off) | | |
| I4 audit-log read | not re-tested | | |
| I5 creator echo | **reproduces** (18,226 tokens over 73 writes) | | partly: `insights-list` rows only |
| B1 unbounded enum text | **partly reproduces**: 6,059 tokens of DRF choice lists today; project-settings-update not re-tested | | no |
| B2 unseen events listed | **reproduces**: 66 of 71 rows unseen (3,010 tokens) next to 5 real events (57 tokens) | #44 | no |
| B3 `items: {}` | **reproduces** in other fields (`tags: {"items":{}}` on insight-create, dashboard-create, action-create) | #9, #13, #117 | no |
| B6 no `$defs` | **reproduces** (survey-create 10,084; 7 repeated property-filter variants in create-feature-flag; retention entities) | | no (it adds CI schema budgets) |

What PR 129174 adds that none of today's jobs would notice: per-response bounds of 100k (10k for Codex). The largest response in this session was 11,175 tokens.

## 3. Ranked change list

**How the savings were computed.** Each "saved" figure is computed from this session's ledger by removing or replacing the affected rows. These are estimates of effect, not measurements of a changed server. "Bench tasks" names the six benchmark tasks the change would touch, judged from the unmodified build's first-repetition command sequences in the two-build series.

1. **Compact write receipts** (writes and deletes).
   - What: by default return `{id, short_id, name, changed: {field: [old, new]}, version, _posthogUrl}`. Reduce `created_by`/`last_modified_by` to `{id, name}`. Add `response.include` blocks for `insight-delete`, `dashboard-reorder-tiles`, `annotation-*`, `survey-*`, `cohorts-*` and `action-*`. Offer `--full` to opt back in.
   - Removes: A2, A5, I5, I6, I7.
   - Saves (echo tokens beyond needed): job 1 17,917; job 2 1,085; job 3 13,397; job 4 1,713; job 5 341; job 6 1,898; job 7 1,119; job 8 800; job 10 18,906 (≈57,000 total). No calls saved.
   - Where:
     - `response:` blocks in `products/{product_analytics,dashboards,surveys,annotations,cohorts,actions}/mcp/tools.yaml`;
     - the response filter in `services/mcp/scripts/generate-tools.ts`;
     - the creator trim as a default in `services/mcp/src/lib/build-tool-result.ts`;
     - a `changed` diff needs the pre-image, so read-before-write in the generated handler.
   - Size: S for excludes, M for diffs.
   - Risk of decline: **low**. PR 129174 already trims `dashboard-update` to ids and layout and `insights-list` creators, and the flag-state tools already return receipts.
   - Scope: MCP definitions plus `services/mcp`; no backend change.
   - Bench tasks: a, b, c, e, f.

2. **Validate-first errors instead of mandatory info/schema.**
   - What: drop the "SCHEMA DRILL-DOWN RULE — HARD REQUIREMENT" and "Run `info` for ALL tools first". When a `call` fails validation, return the failing field's summarized schema (as `schema <tool> <field>` would) inside the error. Keep `info` optional.
   - Removes: A1, P3, P9, P15 (mostly), P11 (indirectly).
   - Saves, upper bound if every info and schema call is replaced by the call itself (validation errors measured at 23–51 tokens each):
     - job 1: 17 calls / 36,603 tokens;
     - job 2: 1 / 3,732;
     - job 3: 3 / 1,801;
     - job 4: 6 / 20,547;
     - job 5: 3 / 9,261;
     - job 6: 2 / 6,342;
     - job 7: 2 / 20,372;
     - job 8: 3 / 5,291;
     - job 9: 2 / 944;
     - job 10: 6 / 1,517.
     - Schema drills alone: job 1 8 / 16,784; job 5 1 / 5,887; job 6 1 / 4,678; job 9 2 / 944.
   - Where:
     - `services/mcp/src/templates/sections/cli-schema-drilldown.md` (the rule);
     - the hint text in `src/tools/schema-utils.ts` `summarizeObject` (line 336);
     - `src/tools/exec.ts` `call` case (around line 2137): on a Zod error, attach `summarizeSchema(schema, tool, failingPath)`.
   - Size: M.
   - Risk of decline: **medium-high**. "Never guess a schema" is a stated design rule. PR 129174 shows they A/B instruction changes with evals and revert losers. Enriching errors alone is low risk.
   - Scope: `services/mcp` alone.
   - Bench tasks: all six through the info calls (a: insight-create 22.5 KB and dashboard-create 7.8 KB; b and f: insight-update 20.0 KB; c: create-feature-flag 16.9 KB; d: execute-sql 46.6 KB; e: 3 infos, about 7 KB). The schema-drill half affects none of the six (no `schema` calls in the unmodified build's runs).

3. **Tool-name aliases (no renames), and suggestions in the unknown-tool error.**
   - What: in `findTool`, resolve verb/noun permutations and singular/plural (`feature-flag-create` → `create-feature-flag`, `action-list` → `actions-get-all`) through the existing redirect mechanism, or put the top 3 `search` matches in the error. Fix the "Example tool names" line. Do not rename tools.
   - Removes: P12, P13.
   - Saves: 1 error call (33 tokens), 1 search call (336 tokens) and 1 turn per miss. In this session that was 2 errors and 1 search in job 4b. Jobs 1–10 saw no miss, because the agent searched first.
   - Where: `services/mcp/src/tools/exec.ts` `findTool` (about line 1756), `DEPRECATED_TOOL_REDIRECTS` (line 611) and `src/tools/tool-search.ts`; `templates/sections/tool-search.md:26`.
   - Size: S.
   - Risk of decline: **low**. They already ship `superseded_by` redirects and the "fall back to search — it may have been renamed" advice.
   - Scope: `services/mcp` alone.
   - Bench tasks: **c** (6 of 6 runs missed `feature-flag-create`; runs 17 and 25 missed a second name).

4. **Per-session notes: `_agentNote` once per conversation per tool, and nothing that prescribes duplicate calls.**
   - What: send each tool's note once per session (Redis session state already exists). Drop "call insight-query" when the create was preceded by a test query, or when results are returned as in change 6.
   - Removes: A8, A13.
   - Saves: job 1 2,596 tokens + 3 calls (484 tokens); job 3 3,270 tokens; job 6 649 tokens + 1 call (82).
   - Where: `services/mcp/scripts/generate-tools.ts` agent_note wrapping (lines 1053, 1354, 1732) and `src/tools/tool-utils.ts` `withAgentNote`. It needs a per-session "seen" set.
   - Size: S–M.
   - Risk of decline: **medium**. The notes carry product nudges (alerts, subscriptions) that PostHog wants offered; deduplication keeps the offer.
   - Scope: `services/mcp`.
   - Bench tasks: a (3 insight-creates → 2 notes saved), f (3 insight-updates → 2 saved).

5. **Batch tools with per-item results, for insights and annotations.**
   - What: `insights-batch-update` (`items:[{id, tags?, name?, description?, deleted?}]`), `annotations-batch-create` and `annotations-batch-delete`, with per-item receipts, on the model of `feature-flags-bulk-delete-create` (44 tokens for 2 flags).
   - Removes: A10 (and A11).
   - Saves: job 3 20 of 30 calls; job 10 20 of 35 calls. Tokens: the per-item receipt replaces 930-token update echoes and about 250-token annotation echoes. Turns: 0 for an agent that already parallelises.
   - Where: hand-written tools under `services/mcp/src/tools/`, fanning out to the existing endpoints at a paced rate (the harness uses 2 per second) and aggregating results. Backend bulk endpoints would be better but are not needed.
   - Size: M.
   - Risk of decline: **medium**. Fan-out counts against the 480/min limit, and PostHog may prefer real backend bulk endpoints.
   - Scope: `services/mcp` (fan-out), or a backend change for native bulk.
   - Bench tasks: f (3 updates → 1), a (3 creates → 1 with batch create).

6. **Create-with-children with rollback: `dashboard-create` with insight tiles** (`tiles:[{name, query, layouts}]`, validated per tile, receipt with tile ids in order, optional `return_results`).
   - Removes: A4, A6, A7, A13, P11.
   - Saves in job 1: 7 writes (562 + 6,836 + 11,175 = 18,573 tokens) become 1 call; plus the 3 prescribed re-queries (484); and `info dashboard-widgets-batch-add` (1,067) is no longer needed.
   - Where: a new hand-written tool in `services/mcp/src/tools/` calling the existing dashboard and insight APIs (insight-create already accepts `dashboards:[id]`).
   - Size: M.
   - Risk of decline: **medium**. It cuts across the `building-a-dashboard` skill's "reuse existing insights" workflow.
   - Scope: `services/mcp` alone.
   - Bench tasks: **a**.

7. **Schema de-duplication.**
   - What: (a) DRF "* `x` - x" lists dropped when an enum exists; (b) `$defs` for repeated sub-schemas (property filters, retention entities, `dateRange`); (c) "same as `insight-create.query`, already shown in this session" for update tools.
   - Removes: B1, B6, A9, I10.
   - Saves: DRF 6,059 tokens over the session; job 1 6,760 (second retention entity) + 436 (two `dateRange` copies); job 2 3,732; job 4 about 4,060; job 7 about 9,800. The (c) figures assume the create schema was already shown.
   - Where: `services/mcp/src/tools/schema-utils.ts` `summarizeSchema` / `summarizeObject`; `exec.ts` `info` case (line 2024, serialization); `scripts/generate-tool-schema.ts` for DRF stripping.
   - Size: M–L.
   - Risk of decline: **low-medium**. It fits PR 129174's CI schema budgets, but they chose to keep JSON Schema as JSON so as not to obscure `$ref`.
   - Scope: `services/mcp`.
   - Bench tasks: a, b, c, f (through the size of their info calls; the per-task byte drop was not computed).

8. **Summary fields in list results: flag list with a rollout summary, and `system.feature_flags` with `active` and `tags`.** Also fix the null `rollout_percentage` SQL example.
   - Removes: A15, B8.
   - Saves in job 4: 4 calls and about 11,100 tokens (`info execute-sql` 10,742 + 3 SQL calls).
   - Where:
     - an `include` of `filters.groups.*.rollout_percentage` and `filters.multivariate` on `feature-flag-get-all` in `products/feature_flags/mcp/tools.yaml` (MCP-only);
     - `system.feature_flags` columns are a **backend** HogQL system-table change;
     - the example lives in `services/mcp/src/templates/execute-sql-*.md`.
   - Size: S.
   - Risk of decline: low.
   - Bench tasks: **d** (its unmodified-build run used SQL, then two `feature-flag-get-all` calls because SQL has no `active` column). The rollout half affects none.

9. **Consistent tool instructions when `learn` is off.** Gate "Prioritize skills over tools", skill-loading sentences and experiment "RULES" on learn availability, and name `insight-create {dashboards}` for insight tiles.
   - Removes: P10, P11, P14 (the "plan" wording needs a schema description override).
   - Saves: 3 of 8 guesses; 1,067 tokens (job 1); description tokens not measured separately.
   - Where: `services/mcp/src/hono/instructions.ts` (`buildExecToolDescription`, `getExecLearnCapabilities`), `src/templates/sections/*.md`, and `products/*/mcp/tools.yaml` descriptions and agent_notes. The "plan" wording is in `frontend/src/queries/schema/schema-assistant-queries.ts`, or can be overridden in the query-wrapper generator.
   - Size: S.
   - Risk of decline: low (the "plan" part is medium, because it is shared with PostHog AI).
   - Bench tasks: none measurably (task a sees the dashboard-create skill text, but no call depends on it).

10. **Seen events first: `read-data-schema` lists seen events, unseen ones as a count.**
    - Removes: B2.
    - Saves: 3,010 tokens per events read on this project; job 1 had 2 such reads.
    - Where: **backend** (`ee/hogai/utils/helpers.py` events formatting behind the read-data-schema MCP tool).
    - Size: S.
    - Risk of decline: medium (they deliberately list unseen events with a marker).
    - Bench tasks: none in the unmodified build's runs (one bug-fix build run used it).

11. **Read-only exec batching** (several `info`/`schema`/`search` lines per request, never `call`).
    - Removes: A3.
    - Saves calls, not tokens: job 1 12, job 3 4, job 8 4, job 10 5, job 4 1, job 9 1. No turns for an agent that parallelises.
    - Where: the splitter and `batchedCommandMessage` in `services/mcp/src/tools/exec.ts` (around lines 395–432).
    - Size: S.
    - Risk of decline: **medium-high**. "One command per request" is an explicit design, and the per-command analytics depend on it.
    - Bench tasks: a, c, e, f have 2–5 discovery calls each (fewer requests, same tokens).

12. **Compact query results: `query-retention` output.**
    - Removes: I8.
    - Saves: about 3,400 tokens per retention query (job 1: 1 call).
    - Where: the retention formatter in `services/mcp/src/tools/insights/query.ts` / `query-wrapper-factory.ts`.
    - Size: S.
    - Risk of decline: low.
    - Bench tasks: none (no unmodified-build task-a run executed a retention query).

13. **Version-checked partial updates for nested arrays** (`query_patch`, questions by id, a flag condition by `condition_id`).
    - Removes: A16 (and A9's resend).
    - Saves: request tokens only (169–246 per call measured), plus fewer lost-field mistakes.
    - Where: MCP-side read-merge-write in the generated update handlers; a lost-update risk without backend versioning (cf. `probes/insights_race.py`).
    - Size: M–L.
    - Risk of decline: medium-high.
    - Bench tasks: b and f only through safety; no call savings.

## 4. Recommended first five

1. **Compact write receipts (change 1).**
   - Why: it is the largest measured token sink that needs no behaviour change from the agent: about 57K tokens across nine jobs. It sits in a direction PostHog is already taking in PR 129174, and is mostly YAML `response:` blocks.
   - Bench tasks: a, b, c, e, f; not d.
   - Measurable in the benchmark as result bytes, not calls.
2. **Tool-name aliases (no renames) and suggestions (change 3).**
   - Why: it is small, and it is the only change here aimed at a failure the benchmark records in every run of one task.
   - Bench tasks: **c**, which should lose 1–2 failed calls and 1 search per run.
3. **Per-session notes (change 4).**
   - Why: small, it removes repeated text and the duplicate re-query calls it prescribes, and it keeps PostHog's nudges.
   - Bench tasks: a and f.
4. **Validate-first errors, in their low-risk form (change 2, errors carry the field schema; the rule softened rather than removed).**
   - Why: lookup overhead is 57% of response tokens, and #139/#140 show the server's own errors already name the field in 23–51 tokens.
   - Bench tasks: all six through `info`. It is the change most likely to need PostHog's own evals before they accept it.
5. **Summary fields in list results: flag rollout summary, and `active`/`tags` on `system.feature_flags` (change 8).**
   - Why: it removes a 10.7K-token detour for a common question. The YAML half is S.
   - Bench tasks: **d**, through the `active` column (backend half only). The rollout half affects none of the six.

Not in the first five, despite large savings in this session:
- **Create-with-children with rollback (change 6):** it affects only task a, and it carries design risk.
- **Batch writes (change 5):** only f and a, and agents that parallelise gain no turns.

## Not published

The call ledger, the full response of every call, the proxy capture and the client scripts. They carry the
local instance's identifiers and object data.
