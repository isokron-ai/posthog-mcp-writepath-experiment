# Changes in the PostHog MCP server experiment

Based on `PostHog/posthog` at commit `7b516983` (the `upstream-7b516983` tag; see [EXPERIMENT.md](EXPERIMENT.md) for what was imported). Two series of commits sit on top, in this order:

- **Bug-fix build** (14 commits, tag `fixed-r3`): fixes for findings of IsoKron's audit of the PostHog MCP server; each fix has a test that fails before and passes after (the regenerate commit is generator output). Patch files: [`experiment-patches/bugfix/`](experiment-patches/bugfix/), order in its `SERIES` file.
- **Research build** (17 more commits, tag `usability-r3`): the bug-fix build plus 14 usability changes, a design note and two integration fixes. The changes are every item on the ranked list from a [usability pass](results/usability-pass-2026-11-10/USABILITY-PASS.md) of ten everyday jobs on the unmodified server (self-hosted PostHog, 10 November 2026) that needs no change to PostHog's backend, in three groups (A response shaping, B exec behaviour, C new batch, create-with-children and partial-update tools). They are IsoKron's design work and are not offered upstream. Patch files: [`experiment-patches/usability/`](experiment-patches/usability/).

The tag names are identifiers: the unmodified server is `upstream-7b516983`, the bug-fix build `fixed-r3`, the research build `usability-r3` (the harness calls them `baseline`, `fixed` and `usability`).

Sizes from the usability pass are tokens (cl100k estimate), not Claude's tokenizer. Lookup overhead is the output of `info`, `schema` and `search`: looking up tools and their schemas before acting.

Every commit keeps the message it was made with; the messages carry the full reasoning, and `git show <commit>` gives the diff. Generated files under `services/mcp/src/tools/generated/` and `services/mcp/schema/` were edited by hand to match what the generator emits where noted, because the generator needs PostHog's backend OpenAPI schema, which a build of this repository does not have.

One more fix from the same audit, K3 (`fix(error-tracking): point the suppression skill at the rule update tool`), is not here: it edits a skill file outside the imported paths, and it was not applied to any measured build.

## Bug-fix series

### X1: fix(mcp): stop coercing booleans and nullable integers in generated schemas

Commit `d5dc6e7118`. Upstream: IsoKron's [PostHog/posthog#131514](https://github.com/PostHog/posthog/pull/131514) (open; both commits of the PR).

- **Why:** Generated schemas used `z.coerce.boolean()`, so the string `"false"` was saved as true, and integer-or-null unions turned `null` into 0 (a real group type index).
- **Change:** Booleans are strict, and integer-or-null union members are inlined as strict primitives; lone number fields keep coercion.
- **Files:** `services/mcp/scripts/lib/json-schema-to-zod.ts`
- **Tests:** `services/mcp/tests/unit/json-schema-to-zod.test.ts`, `services/mcp/tests/unit/query-wrapper-factory.test.ts`, `services/mcp/tests/unit/query-wrappers-generated.test.ts`

### X1: chore(mcp): regenerate tool schemas

Commit `7d5199bd41`. Upstream: Part of [#131514](https://github.com/PostHog/posthog/pull/131514).

- **Why:** Generated output of the generator change above.
- **Change:** `z.coerce.boolean()` becomes `z.boolean()` in the generated tool files.
- **Files:** `services/mcp/src/tools/generated/ai_observability.ts`, `services/mcp/src/tools/generated/marketing_analytics.ts`, `services/mcp/src/tools/generated/mcp_analytics.ts`, `services/mcp/src/tools/generated/product_analytics.ts`, `services/mcp/src/tools/generated/query-wrappers.ts`, `services/mcp/src/tools/generated/replay.ts`, `services/mcp/src/tools/generated/web_analytics.ts`
- **Tests:** none (generated output)

### V1: fix(mcp): accept real comment ids in tasks-comments-retrieve

Commit `2f326a8e62`. Upstream: [PostHog/posthog#132356](https://github.com/PostHog/posthog/pull/132356) (open).

- **Why:** Comment ids are UUIDTs, which rarely carry RFC 4122 version digits, so ids returned by `tasks-comments-list` were rejected as "Invalid UUID".
- **Change:** Both id fields use `z.guid()`.
- **Files:** `services/mcp/src/tools/tasksContext.ts`
- **Tests:** `services/mcp/tests/unit/__snapshots__/tool-schemas/tasks-comments-retrieve.json`, `services/mcp/tests/unit/tasks-context.test.ts`

### V6: fix(mcp): keep the next-page hint on exec text results

Commit `377952757f`. Upstream: [PostHog/posthog#132357](https://github.com/PostHog/posthog/pull/132357) (open).

- **Why:** The next-page footer was added only on the direct tool path; through `exec`, plain paginated list results lost `next`, `count` and the hint, so a partial page read as the whole list.
- **Change:** The exec text branch appends the same footer.
- **Files:** `services/mcp/src/tools/exec.ts`
- **Tests:** `services/mcp/tests/unit/exec.test.ts`

### V5: fix(mcp): apply the project test-account default to actors queries

Commit `a5a446af3f`. Upstream: Prepared, not yet filed.

- **Why:** The six `query-*-actors` tools carry `filterTestAccounts` on `source`, so they kept the generated `false` default and listed users the insight being drilled into had excluded.
- **Change:** The query wrapper factory also strips the default from the actors `source` and applies the project setting there.
- **Files:** `services/mcp/src/tools/query-wrapper-factory.ts`
- **Tests:** `services/mcp/tests/unit/__snapshots__/tool-schemas/query-funnel-actors.json`, `services/mcp/tests/unit/__snapshots__/tool-schemas/query-lifecycle-actors.json`, `services/mcp/tests/unit/__snapshots__/tool-schemas/query-paths-actors.json`, `services/mcp/tests/unit/__snapshots__/tool-schemas/query-retention-actors.json`, `services/mcp/tests/unit/__snapshots__/tool-schemas/query-stickiness-actors.json`, `services/mcp/tests/unit/__snapshots__/tool-schemas/query-trends-actors.json`, `services/mcp/tests/unit/query-wrapper-factory.test.ts`

### X3: fix(mcp): reject a non-object exec call body with a typed error

Commit `ff2a25896f`. Upstream: Prepared, not yet filed.

- **Why:** `call <tool> null` (or a number, string or boolean body) threw an untyped TypeError before validation.
- **Change:** A non-object JSON body raises `ExecCommandError` with the existing `invalid_json` reason.
- **Files:** `services/mcp/src/tools/exec.ts`
- **Tests:** `services/mcp/tests/unit/exec.test.ts`

### X2: fix(mcp): accept any whitespace between exec command parts

Commit `a29ab41506`. Upstream: Prepared, not yet filed.

- **Why:** The exec parser split on the first space only, so a JSON body after a newline or tab was read as part of the tool name.
- **Change:** `parseCommand` splits on the first whitespace of any kind.
- **Files:** `services/mcp/src/tools/exec.ts`
- **Tests:** `services/mcp/tests/unit/exec.test.ts`

### X4: fix(mcp): read flags and extra input after the tool name in exec info

Commit `97fee45d2e`. Upstream: Prepared, not yet filed.

- **Why:** `info <tool> --json`, or any extra word, was looked up as one tool name and reported as an unknown tool.
- **Change:** `info` accepts `--json` after the tool name, as `call` does, and rejects other trailing input with a usage error.
- **Files:** `services/mcp/src/tools/exec.ts`
- **Tests:** `services/mcp/tests/unit/exec.test.ts`

### Q5: fix(mcp): keep search notes when a scope-gated tool also matches

Commit `ac4562fbbf`. Upstream: Prepared, not yet filed.

- **Why:** When an exec search also matched a scope-gated tool, the truncation flag and the other search notes were dropped.
- **Change:** The scope-gated matches and their hint are added to the normal response instead of replacing it.
- **Files:** `services/mcp/src/tools/exec.ts`
- **Tests:** `services/mcp/tests/unit/exec.test.ts`

### K1: fix(mcp): match search keywords in hosted exec search

Commit `67eb0b119b`. Upstream: Prepared, not yet filed.

- **Why:** `ToolCatalog.getFilteredTools` did not copy `search_keywords`, so keyword search never found a tool the caller can call (affects tools behind the `metrics` flag).
- **Change:** `getFilteredTools` carries the keywords.
- **Files:** `services/mcp/src/hono/tool-catalog.ts`
- **Tests:** `services/mcp/tests/unit/tool-catalog.test.ts`

### P4: fix(mcp): stop hinting at tools gated on server-minted scopes

Commit `f258972530`. Upstream: Prepared, not yet filed.

- **Why:** The scope hint listed tools that need a server-minted scope, which no user key can hold.
- **Change:** `getScopeGatedTools` leaves those tools out, as it already did for staff-only tools.
- **Files:** `services/mcp/src/lib/api.ts`, `services/mcp/src/tools/toolDefinitions.ts`
- **Tests:** `services/mcp/tests/unit/tool-filtering.test.ts`

### R3: fix(mcp): leave the api host out of 403 and 429 error messages

Commit `b10e2101d0`. Upstream: Prepared, not yet filed.

- **Why:** The 403 and 429 messages printed the full request URL; the default message already used the path only.
- **Change:** Both use the path-only form.
- **Files:** `services/mcp/src/lib/errors.ts`
- **Tests:** `services/mcp/tests/unit/permission-errors.test.ts`, `services/mcp/tests/unit/rate-limit-errors.test.ts`

### V2: fix(mcp): trim the user-settings-update response like user-get

Commit `ea23e81b20`. Upstream: Prepared, not yet filed.

- **Why:** `user-settings-update` echoed the raw user object, including every organization project with its API token.
- **Change:** The tool declares the same response fields as `user-get`. The generated handler is edited by hand to match the generator's output, because codegen needs the backend OpenAPI schema.
- **Files:** `services/mcp/definitions/core.yaml`, `services/mcp/src/tools/generated/core.ts`
- **Tests:** `services/mcp/tests/unit/user-settings-update-response.test.ts`

### J1: fix(mcp): stop returning an unreadable 2xx body as a tool result

Commit `ceb85be7f5`. Upstream: Prepared, not yet filed.

- **Why:** A 2xx whose JSON or HTML body did not parse (a proxy's sign-in page, truncated JSON) came back as a successful result.
- **Change:** Such a body is a transport error; other content types and empty bodies are unchanged.
- **Files:** `services/mcp/src/api/client.ts`
- **Tests:** `services/mcp/tests/unit/api-client.test.ts`

## Research build: usability series

| Change | Design pattern | What prompted it; sizes are tokens (cl100k estimate) |
| --- | --- | --- |
| feat(mcp): return short receipts from writes and deletes | Compact write receipts | 73 writes and deletes returned 61,363 tokens; 4,187 were needed |
| feat(mcp): send each tool's _agentNote once per session | Per-session notes | `_agentNote` texts were 7,807 tokens of write echoes, repeated word for word |
| feat(mcp): de-duplicate schemas in exec info and schema output | Schema de-duplication | `info insight-update` repeated insight-create's whole query schema (3,732 tokens) |
| feat(mcp): format query-retention results as a compact table | Compact query results | a retention result was 3,874 tokens against 303 for trends |
| feat(mcp): list feature flags with a rollout summary | Summary fields in list results | listing flags with their rollout took 4 calls and 11,229 tokens |
| feat(mcp): require --confirm for destructive tools over MCP | Confirm for destructive calls | over MCP, a delete ran without the documented `--confirm` |
| feat(mcp): resolve guessed tool-name orderings and name close tools | Tool-name aliases (no renames) | every benchmark run of the flag task guessed `feature-flag-create`; the unknown-tool error named no tools |
| feat(mcp): carry the failing field's schema in call validation errors | Validate-first errors | lookup overhead was 57% of all response tokens; errors already named the field |
| feat(mcp): keep exec text consistent when skills cannot be loaded | Consistent tool instructions | 3 of the session's 8 guesses came from skills that cannot be loaded |
| feat(mcp): list only seen events from read-data-schema | Seen events first | 66 of 71 event rows were events the project never sent |
| feat(mcp): batch read-only exec commands in one request | Read-only batching | one command per request, so each lookup cost a request |
| feat(mcp): add batch tools for insights and annotations | Batch tools with per-item results | the bulk job took 30 calls and the cleanup job 35, one per object |
| feat(mcp): add dashboard-create-with-insights with compensating rollback | Create-with-children with rollback | a dashboard with five tiles took 36 calls and 13 turns, with an 11,175-token reorder echo |
| feat(mcp): add version-checked partial updates for nested arrays | Version-checked partial updates | one-field edits resent whole arrays of conditions or questions, or a whole query |

### U01 (group A): feat(mcp): return short receipts from writes and deletes

Commit `c026ae1fe2`. Research build only; not offered upstream.

- **Why:** In the usability pass, 73 writes and deletes returned 61,363 tokens (cl100k estimate), of which 4,187 were needed: whole objects with every tile's query, compiled HogQL, cached results and user objects.
- **Change:** Tools that declare `response.receipt` return their identity fields, the fields they changed (`changed.<path>: {from, to}`) and `_posthogUrl`; an optional `full` parameter returns the old response. User objects in model-facing text shrink to `{id, name}`.
- **Design pattern:** Compact write receipts
- **Files:** `products/actions/mcp/tools.yaml`, `products/annotations/mcp/tools.yaml`, `products/cohorts/mcp/tools.yaml`, `products/dashboards/mcp/tools.yaml`, `products/product_analytics/mcp/tools.yaml`, `products/surveys/mcp/tools.yaml`, `services/mcp/scripts/generate-tools.ts`, `services/mcp/scripts/yaml-config-schema.ts` and 9 more
- **Tests:** `services/mcp/tests/unit/__snapshots__/tool-schemas/action-create.json`, `services/mcp/tests/unit/__snapshots__/tool-schemas/action-delete.json`, `services/mcp/tests/unit/__snapshots__/tool-schemas/action-update.json`, `services/mcp/tests/unit/__snapshots__/tool-schemas/annotation-create.json`, `services/mcp/tests/unit/__snapshots__/tool-schemas/annotation-delete.json`, `services/mcp/tests/unit/__snapshots__/tool-schemas/annotations-partial-update.json`, `services/mcp/tests/unit/__snapshots__/tool-schemas/cohorts-create.json`, `services/mcp/tests/unit/__snapshots__/tool-schemas/cohorts-partial-update.json` and 10 more

### U02 (group A): feat(mcp): send each tool's _agentNote once per session

Commit `65e189b348`. Research build only; not offered upstream.

- **Why:** The same `_agentNote` came back on every insight-create (649 tokens, cl100k estimate), insight-update and dashboard-create, and the insight-create note asked for a re-query that repeated work.
- **Change:** Notes are shown once per MCP session (session store, set-if-absent); requests without a session get them every time, as before. The insight-create note no longer asks for a re-query of a tested query.
- **Design pattern:** Per-session notes
- **Files:** `products/product_analytics/mcp/tools.yaml`, `services/mcp/scripts/generate-tools.ts`, `services/mcp/src/lib/StateManager.ts`, `services/mcp/src/tools/generated/access_control.ts`, `services/mcp/src/tools/generated/conversations.ts`, `services/mcp/src/tools/generated/dashboards.ts`, `services/mcp/src/tools/generated/product_analytics.ts`, `services/mcp/src/tools/generated/replay_vision.ts` and 3 more
- **Tests:** `services/mcp/tests/unit/agent-note-once.test.ts`

### U03 (group A): feat(mcp): de-duplicate schemas in exec info and schema output

Commit `a700bf5898`. Research build only; not offered upstream.

- **Why:** `info` and `schema` repeated the same sub-schemas, enum label lists and, for update tools, the create tool's schema.
- **Change:** Repeated sub-schemas move into `$defs`, redundant DRF choice lines are dropped, and an update tool's properties identical to an already shown create tool become references. Inlining gives back the original schema.
- **Design pattern:** Schema de-duplication
- **Files:** `services/mcp/src/tools/exec.ts`, `services/mcp/src/tools/schema-utils.ts`
- **Tests:** `services/mcp/tests/unit/schema-compaction.test.ts`

### U04 (group A): feat(mcp): format query-retention results as a compact table

Commit `e7c1bfe41c`. Research build only; not offered upstream.

- **Why:** Retention results were the raw payload (3,874 tokens, cl100k estimate, in the usability pass against 303 for trends).
- **Change:** query-retention text is a pipe table in the style of the backend's trends output (759 tokens for the same query, cl100k estimate); JSON output and the UI payload are unchanged.
- **Design pattern:** Compact query results
- **Files:** `services/mcp/src/tools/insights/query.ts`, `services/mcp/src/tools/insights/retention-format.ts`, `services/mcp/src/tools/query-wrapper-factory.ts`
- **Tests:** `services/mcp/tests/fixtures/retention-query-result.json`, `services/mcp/tests/unit/retention-format.test.ts`

### U05 (group A): feat(mcp): list feature flags with a rollout summary

Commit `d26fa61a88`. Research build only; not offered upstream.

- **Why:** Listing flags with their rollout took 4 calls and 11,229 tokens (cl100k estimate); list rows had no rollout, and the SQL guidance pointed at a legacy column that is usually null.
- **Change:** `feature-flag-get-all` rows carry a one-line `rollout` summary; the SQL example selects release conditions from `filters.groups`.
- **Design pattern:** Summary fields in list results
- **Files:** `products/feature_flags/mcp/tools.yaml`, `products/posthog_ai/skills/querying-posthog-data/references/guidelines.md`, `services/mcp/schema/generated-tool-definitions.json`, `services/mcp/schema/tool-definitions-all.json`, `services/mcp/src/tools/featureFlags/listRolloutHooks.ts`, `services/mcp/src/tools/featureFlags/rolloutSummary.ts`, `services/mcp/src/tools/generated/feature_flags.ts`
- **Tests:** `services/mcp/tests/unit/feature-flag-list-rollout.test.ts`

### U06 (group B): feat(mcp): require --confirm for destructive tools over MCP

Commit `544d85681a`. Research build only; not offered upstream.

- **Why:** The command reference said `--confirm` was required for destructive tools, but only the agent CLI enforced it.
- **Change:** exec refuses a destructive tool call without `--confirm` on every surface and says exactly how to re-run it. (In the benchmark this refusal was 3 of the research build's 8 failed calls on the friction-derived set, plus 1 on the pre-registered set; every one of those runs passed.)
- **Design pattern:** Confirm for destructive calls
- **Files:** `services/mcp/schema/exec-command-reference.md`, `services/mcp/src/templates/sections/cli-syntax.md`, `services/mcp/src/tools/exec.ts`
- **Tests:** `services/mcp/tests/unit/__snapshots__/instructions/exec-command-reference-claude-chat-skills.txt`, `services/mcp/tests/unit/__snapshots__/instructions/exec-command-reference-claude-chat.txt`, `services/mcp/tests/unit/__snapshots__/instructions/exec-command-reference-full.txt`, `services/mcp/tests/unit/exec.test.ts`, `services/mcp/tests/unit/gateway-tools.test.ts`

### U07 (group B): feat(mcp): resolve guessed tool-name orderings and name close tools

Commit `23bd0ade33`. Research build only; not offered upstream.

- **Why:** The catalog mixes verb-first and noun-first names; every task-c run guessed `feature-flag-create`, and the unknown-tool error named no alternatives.
- **Change:** `findTool` resolves an unambiguous alias one verb move, synonym or plural away from a real name; the unknown-tool error lists the three closest real names.
- **Design pattern:** Tool-name aliases (no renames)
- **Files:** `services/mcp/src/templates/sections/cli-error-handling.md`, `services/mcp/src/templates/sections/tool-search.md`, `services/mcp/src/tools/exec.ts`, `services/mcp/src/tools/tool-search.ts`
- **Tests:** `services/mcp/tests/unit/__snapshots__/instructions/exec-command-reference-claude-chat-skills.txt`, `services/mcp/tests/unit/__snapshots__/instructions/exec-command-reference-claude-chat.txt`, `services/mcp/tests/unit/__snapshots__/instructions/exec-command-reference-full.txt`, `services/mcp/tests/unit/__snapshots__/instructions/tools-instructions.txt`, `services/mcp/tests/unit/tool-aliases.test.ts`

### U08 (group B): feat(mcp): carry the failing field's schema in call validation errors

Commit `8ce9b4a652`. Research build only; not offered upstream.

- **Why:** Lookup overhead (info, schema and search output) was 57% of response tokens (cl100k estimate) in the usability pass, mostly required up front by the instructions.
- **Change:** A failed call returns the summarized schema of each failing field (capped at 8,000 characters), and the drill-down rule becomes "look up the schema if a call fails or the shape is unfamiliar".
- **Design pattern:** Validate-first errors
- **Files:** `services/mcp/schema/exec-command-reference.md`, `services/mcp/src/templates/sections/cli-examples-claude.md`, `services/mcp/src/templates/sections/cli-examples.md`, `services/mcp/src/templates/sections/cli-schema-drilldown.md`, `services/mcp/src/templates/sections/exec-tool-blurb-compact.md`, `services/mcp/src/templates/sections/exec-tool-blurb.md`, `services/mcp/src/tools/exec-schema-view.ts`, `services/mcp/src/tools/exec.ts`
- **Tests:** `services/mcp/tests/unit/__snapshots__/instructions/exec-command-reference-claude-chat-skills.txt`, `services/mcp/tests/unit/__snapshots__/instructions/exec-command-reference-claude-chat.txt`, `services/mcp/tests/unit/__snapshots__/instructions/exec-command-reference-full.txt`, `services/mcp/tests/unit/__snapshots__/instructions/exec-tool-description.txt`, `services/mcp/tests/unit/exec-validate-first.test.ts`, `services/mcp/tests/unit/instructions-formatter.test.ts`

### U09 (group B): feat(mcp): keep exec text consistent when skills cannot be loaded

Commit `2b1d3a54b0`. Research build only; not offered upstream.

- **Why:** Where skills cannot be loaded (self-hosted, and clients outside the feature flag) the text still required them, sent dashboards to a tool without insight tiles, and carried PostHog AI planner wording.
- **Change:** Skill steps are dropped when skills are unavailable, the dashboard guidance names insight-create with `dashboards`, and planner wording is rewritten where exec hands a schema to an agent.
- **Design pattern:** Consistent tool instructions
- **Files:** `services/mcp/src/hono/instructions.ts`, `services/mcp/src/hono/tool-executor.ts`, `services/mcp/src/lib/instructions-formatter.ts`, `services/mcp/src/templates/sections/analysis-artifacts.md`, `services/mcp/src/templates/sections/compact-instructions.md`, `services/mcp/src/tools/exec-schema-view.ts`, `services/mcp/src/tools/exec.ts`, `services/mcp/src/tools/skill-mentions.ts`
- **Tests:** `services/mcp/tests/unit/__snapshots__/instructions/exec-command-reference-full.txt`, `services/mcp/tests/unit/__snapshots__/instructions/exec-instructions.txt`, `services/mcp/tests/unit/__snapshots__/instructions/tools-instructions.txt`, `services/mcp/tests/unit/exec-learn-off-consistency.test.ts`, `services/mcp/tests/unit/exec-validate-first.test.ts`

### U10 (group B): feat(mcp): list only seen events from read-data-schema

Commit `e5d0a4082e`. Research build only; not offered upstream.

- **Why:** 66 of 71 event rows were PostHog's catalogue of events the project never sent.
- **Change:** Unseen events are reported as a count, with `include_unseen: true` to list them.
- **Design pattern:** Seen events first
- **Files:** `services/mcp/schema/tool-inputs.json`, `services/mcp/src/schema/tool-inputs.ts`, `services/mcp/src/tools/posthogAiTools/readDataSchema.ts`
- **Tests:** `services/mcp/tests/unit/read-data-schema-unseen.test.ts`

### U11 (group B): feat(mcp): batch read-only exec commands in one request

Commit `8f11da834c`. Research build only; not offered upstream.

- **Why:** exec rejected any request with more than one command, so discovery cost one request per command.
- **Change:** Up to 10 read-only commands (help, tools, search, info, schema, and calls to read-only tools) can share a request; a batch with any write is refused whole before anything runs.
- **Design pattern:** Read-only batching
- **Files:** `services/mcp/schema/exec-command-reference.md`, `services/mcp/src/templates/sections/cli-syntax.md`, `services/mcp/src/templates/sections/exec-tool-blurb.md`, `services/mcp/src/tools/exec.ts`
- **Tests:** `services/mcp/tests/unit/__snapshots__/instructions/exec-command-reference-claude-chat-skills.txt`, `services/mcp/tests/unit/__snapshots__/instructions/exec-command-reference-claude-chat.txt`, `services/mcp/tests/unit/__snapshots__/instructions/exec-command-reference-full.txt`, `services/mcp/tests/unit/__snapshots__/instructions/exec-tool-description.txt`, `services/mcp/tests/unit/exec.test.ts`

### U12 (group C): feat(mcp): add batch tools for insights and annotations

Commit `39c18c7765`. Research build only; not offered upstream.

- **Why:** In the usability pass, tagging 10 insights, adding 8 annotations and archiving 5 took 30 calls, and the cleanup job 35.
- **Change:** `insights-batch-update`, `annotations-batch-create` and `annotations-batch-delete`: every item validated before any write, best-effort writes with one result per item (not atomic, and the result says so), dry runs, at most 50 items, and a version guard on read-merge-write items.
- **Design pattern:** Batch tools with per-item results
- **Files:** `services/mcp/schema/tool-definitions-all.json`, `services/mcp/schema/tool-definitions.json`, `services/mcp/src/tools/atomic/annotationsBatch.ts`, `services/mcp/src/tools/atomic/batch.ts`, `services/mcp/src/tools/atomic/concurrency.ts`, `services/mcp/src/tools/atomic/errors.ts`, `services/mcp/src/tools/atomic/index.ts`, `services/mcp/src/tools/atomic/insightsBatchUpdate.ts` and 4 more
- **Tests:** `services/mcp/tests/fixtures/fake-posthog-backend.ts`, `services/mcp/tests/unit/__snapshots__/tool-schemas/annotations-batch-create.json`, `services/mcp/tests/unit/__snapshots__/tool-schemas/annotations-batch-delete.json`, `services/mcp/tests/unit/__snapshots__/tool-schemas/insights-batch-update.json`, `services/mcp/tests/unit/atomic-batch-tools.test.ts`, `services/mcp/tests/unit/atomic-concurrency.test.ts`, `services/mcp/tests/unit/atomic-tools-registration.test.ts`

### U13 (group C): feat(mcp): add dashboard-create-with-insights with compensating rollback

Commit `66c3f40835`. Research build only; not offered upstream.

- **Why:** A five-tile dashboard took 11 calls and an 11,175-token (cl100k estimate) reorder echo.
- **Change:** One call validates every tile, then creates the dashboard and tiles; if a later step fails, what the call wrote is undone newest first (soft delete or detach). The REST API has no transaction, so other readers can briefly see the partial dashboard.
- **Design pattern:** Create-with-children with rollback
- **Files:** `services/mcp/schema/tool-definitions-all.json`, `services/mcp/schema/tool-definitions.json`, `services/mcp/src/tools/atomic/compensation.ts`, `services/mcp/src/tools/atomic/dashboardCreateWithInsights.ts`, `services/mcp/src/tools/atomic/index.ts`
- **Tests:** `services/mcp/tests/unit/__snapshots__/tool-schemas/dashboard-create-with-insights.json`, `services/mcp/tests/unit/atomic-dashboard-create-with-insights.test.ts`

### U14 (group C): feat(mcp): add version-checked partial updates for nested arrays

Commit `91b196ecd9`. Research build only; not offered upstream.

- **Why:** Changing one element of a nested array (a funnel step, a flag variant, a survey question) needed the whole value resent.
- **Change:** `insight-update-query-partial`, `feature-flag-update-conditions` and `survey-update-question` patch one element through a version-checked read-merge-write. A remaining race window for insights and surveys (one round trip, where the API has no precondition) is stated in each description and reproduced by a test.
- **Design pattern:** Version-checked partial updates
- **Files:** `services/mcp/schema/tool-definitions-all.json`, `services/mcp/schema/tool-definitions.json`, `services/mcp/src/tools/atomic/index.ts`, `services/mcp/src/tools/atomic/jsonPatch.ts`, `services/mcp/src/tools/atomic/partialUpdates.ts`
- **Tests:** `services/mcp/tests/unit/__snapshots__/tool-schemas/feature-flag-update-conditions.json`, `services/mcp/tests/unit/__snapshots__/tool-schemas/insight-update-query-partial.json`, `services/mcp/tests/unit/__snapshots__/tool-schemas/survey-update-question.json`, `services/mcp/tests/unit/atomic-json-patch.test.ts`, `services/mcp/tests/unit/atomic-partial-updates.test.ts`, `services/mcp/tests/unit/atomic-version-guard.test.ts`

### U15 (group C): docs(mcp): describe the atomic-write and batch patterns

Commit `6bdc0cf926`. Research build only; not offered upstream.

- **Why:** The patterns behind the new tools should be reusable in other MCP servers over REST.
- **Change:** Adds [`services/mcp/docs/atomic-and-batch-tools.md`](services/mcp/docs/atomic-and-batch-tools.md) (despite the file name, it states that separate REST calls are not a transaction) and documents each new tool's guarantees in the MCP README.
- **Files:** `services/mcp/README.md`, `services/mcp/docs/atomic-and-batch-tools.md`, `services/mcp/src/tools/README.md`
- **Tests:** none

### U16 (integration): fix(mcp): keep annotation-create's receipt flag out of batch items

Commit `85e7e8f2f2`. Research build only; not offered upstream.

- **Why:** Combining A and C: the batch item schema inherited the single tool's `full` flag, which would have reached the API as a body field.
- **Change:** The batch item schema leaves out annotation-create's response-control fields.
- **Files:** `services/mcp/src/tools/atomic/validation.ts`
- **Tests:** `services/mcp/tests/unit/atomic-batch-tools.test.ts`

### U17 (integration): test(mcp): refresh the read-data-schema schema snapshot for include_unseen

Commit `3d62d814d3`. Research build only; not offered upstream.

- **Why:** The seen-events change added `include_unseen` without updating its schema snapshot.
- **Change:** The snapshot records it.
- **Files:** none outside the tests
- **Tests:** `services/mcp/tests/unit/__snapshots__/tool-schemas/read-data-schema.json`

## Tests

Checked on 10 November 2026 with Node 25.8.1 in a sparse upstream checkout with the same paths as this repository (plus three unused workspace packages), `services/mcp`:

| Suite | Unmodified (`upstream-7b516983`) | Research build (`usability-r3`) |
| --- | --- | --- |
| `vitest run --project unit` | 192 of 197 files pass; 5,470 of 5,471 tests pass | 209 of 214 files pass; 5,698 of 5,699 tests pass |
| `vitest run --config vitest.hono.config.mts` | 32 of 32 files; 1,068 tests pass, 1 skipped | 32 of 32 files; 1,068 tests pass, 1 skipped |

The same five unit test files fail on both, because they read files outside the imported paths: four import `products/product_analytics/frontend/...` or other frontend modules, and `mcp-property-taxonomy.test.ts` reads `frontend/src/taxonomy/`. In a full checkout of the monorepo they are expected to pass. The research build's commits add 17 test files and 228 tests, all passing. Not run: the integration and live suites (they need a PostHog backend), codegen (it needs the backend OpenAPI schema) and typecheck in a full checkout.
