# PostHog MCP server write-path experiment

An independent research experiment by [IsoKron](https://isokron.ai). It is based on PostHog's MCP server
(`services/mcp` in [PostHog/posthog](https://github.com/PostHog/posthog)) at commit `7b516983` (master, 10 November
2026), in three builds: the unmodified server, a bug-fix build (14 commits) and a research build (the bug fixes plus 14
usability changes that change how the server handles writes, responses and errors), with the benchmark harness and the
self-hosted PostHog setup used to measure them.

> **Not affiliated with, sponsored by, or endorsed by PostHog.** This is not an official PostHog release and not a
> supported distribution. It was built to measure what fixing write-path and usability friction changes for AI agents,
> and it is published so others can inspect the changes and reproduce the measurement. Use the official server for real
> work. If you run this build, point it at a disposable test project, for example the self-hosted instance in
> [`selfhost/`](selfhost/), with a key scoped to that project.

## What is in this repository

PostHog's monorepo is large; this experiment concerns `services/mcp` only. The first commit (tag `upstream-7b516983`)
imports, unmodified, just the files needed to build the MCP server bundle:

- `services/mcp/` (the server), `packages/llm-normalizer/`, `packages/quill/`, `tools/openapi-codegen/` (workspace
  dependencies of `@posthog/mcp`), `patches/` (pnpm patches for npm dependencies), the root `package.json`,
  `pnpm-workspace.yaml`, `pnpm-lock.yaml`, `turbo.json` and `tsconfig*.json`;
- `products/*/mcp/` (tool definitions the server is generated from) and `products/*/package.json`;
- `products/posthog_ai/skills/querying-posthog-data/` and `products/ai_observability/backend/prompts/` (inlined into the
  bundle), and the two `products/notebooks/` files the server imports;
- PostHog's `LICENSE` and `README.md`.

Nothing from `ee/` (PostHog's separately licensed directory) is included, and nothing else from the monorepo. Every
imported file has the same mode and blob hash as upstream, so `git rev-parse upstream-7b516983:services/mcp` gives the
same tree id as `git rev-parse 7b516983:services/mcp` in PostHog's repository (`9fdb7af7…`). To get the full monorepo at
the same commit:

```sh
git clone --filter=blob:none https://github.com/PostHog/posthog && cd posthog
git checkout 7b516983bef16b9692a00a6b7780a6b5a802257c
```

IsoKron's additions, all outside PostHog's paths:

| Path | What it is |
| --- | --- |
| [`EXPERIMENT.md`](EXPERIMENT.md), [`CHANGES-EXPERIMENT.md`](CHANGES-EXPERIMENT.md), [`NOTICE`](NOTICE), [`SECURITY.md`](SECURITY.md), [`SUPPORT.md`](SUPPORT.md) | This description, the change list, attribution, reporting |
| [`experiment-patches/`](experiment-patches/) | The two patch series, applicable to a clean upstream checkout (`bugfix/`, then `usability/`, each in its `SERIES` order). Not `patches/`, which is PostHog's directory of npm dependency patches |
| [`results/`](results/) | [`BENCHMARK.md`](results/BENCHMARK.md), the analysis of each measured series, per-run summary metrics and call sequences, build records |
| [`harness/`](harness/) | The benchmark harness: tasks, mechanical checkers, fixtures, agent runner, build scripts, offline tests |
| [`selfhost/`](selfhost/) | The local PostHog open-source instance the measurements ran against: compose override, pinned image digests, setup scripts |

## Three builds

| Name used here | Git tag | What it is | Bundle sha256 (`services/mcp/dist/hono-server.mjs`) |
| --- | --- | --- | --- |
| Unmodified | `upstream-7b516983` | PostHog's MCP server at commit `7b516983` | `d573fa771cd73130cbdf30de29e73edc592992be2b3588af5c2ee87c1729d55b` |
| Bug-fix build | `fixed-r3` | Unmodified plus 14 bug-fix commits | `cf5053c3409b2ad5b90c2c73189cc88496054cf6e95f6aa029353f239e75d4a1` |
| Research build | `usability-r3` | The bug-fix build plus 17 commits: 14 usability changes, a design note and two integration fixes | `57a1a7b97ef827a88e40979e65c3a226f2820b6b4fb2a0f691539105c9d475e0` |

The tag names are identifiers only; the harness, the analysis files and `runs.csv` call the same builds `baseline`,
`fixed` and `usability`. `main` adds only documentation, results, the harness, the self-host files and CI to the
research build; the server source is the same.

These are the bundles that were measured. Built from this repository (or by applying the patch series to a clean
upstream checkout) with Node 25.8.1 and the pnpm version upstream pins (11.28.5), each reproduces its hash byte for byte.
The UI apps (`public/ui-apps`, static assets for clients that render MCP Apps) are not built; the benchmark does not use
them.

## What it changes

Each change targets a defect found in IsoKron's
[audit of PostHog's MCP server](https://isokron.ai/research/posthog-mcp-server-audit) or friction measured in a usability
pass of ten everyday jobs on the unmodified server. Details, files and tests for each:
[CHANGES-EXPERIMENT.md](CHANGES-EXPERIMENT.md).

**Bug-fix build (14 commits, fixes for 13 audit findings).** Upstream status on 10 November 2026: the two commits of
[PostHog/posthog#131514](https://github.com/PostHog/posthog/pull/131514) (strict booleans and nullable integers in
generated schemas; open), [#132356](https://github.com/PostHog/posthog/pull/132356) (accept real comment ids in
`tasks-comments-retrieve`; open) and [#132357](https://github.com/PostHog/posthog/pull/132357) (keep the next-page hint
on exec text results; open). The other ten are prepared and will be offered upstream one small pull request at a time:
the project test-account default for actors queries, three exec parser fixes (whitespace, non-object bodies, `info`
flags), search notes and keywords, scope hints, host-free 403/429 messages, a trimmed `user-settings-update` response,
and an error for an unreadable 2xx body.

**Research build (14 usability changes, research only, not offered upstream).** IsoKron's design work; several changes
run against choices PostHog has made on purpose, such as one command per `exec` request.

| Change | Design pattern |
| --- | --- |
| Writes and deletes return identity, version, each changed field as from and to, and a link; user objects cut to id and name; a `full` flag returns the old response | Compact write receipts |
| Each tool's `_agentNote` is sent once per session; the insight-create note no longer asks for a re-query of a query just tested | Per-session notes |
| `info` and `schema` print a repeated sub-schema once; an update tool points at its create tool's schema when that was already shown | Schema de-duplication |
| Retention results come back as a compact table | Compact query results |
| `feature-flag-get-all` rows carry a one-line rollout summary; the SQL example for flags is corrected | Summary fields in list results |
| `exec` refuses a destructive call without `--confirm`, says nothing ran and gives the exact command to re-run | Confirm for destructive calls |
| Guessed tool names resolve when exactly one real tool fits (verb order, synonyms, singular and plural); the unknown-tool error lists the closest real names. Nothing is renamed | Tool-name aliases (no renames) |
| Validation errors carry the schema of the failing field; the "look everything up first" rule becomes "look up the schema if a call fails or the shape is unfamiliar" | Validate-first errors |
| Instructions stop requiring skills where skills cannot be loaded, point dashboards at the tool that adds insight tiles, and drop planner wording meant for PostHog's own assistant | Consistent tool instructions |
| The events listing shows events the project has seen and counts the rest | Seen events first |
| Several read-only commands can share one `exec` request; a request holding a write is refused whole | Read-only batching |
| `insights-batch-update`, `annotations-batch-create`, `annotations-batch-delete`: every item validated before anything is written, then best-effort writes with one result per item (not all-or-nothing, and the result says so) | Batch tools with per-item results |
| `dashboard-create-with-insights`: validates every tile, creates the dashboard and its insights in order, and undoes what it wrote if a later step fails. PostHog's API has no transaction, so other readers can briefly see a partial dashboard | Create-with-children with rollback |
| `insight-update-query-partial`, `feature-flag-update-conditions`, `survey-update-question` change one element of a nested array, checking the object's version just before writing. A window of one round trip remains on insights and surveys, whose API has no precondition | Version-checked partial updates |

Design note for these patterns: [`services/mcp/docs/atomic-and-batch-tools.md`](services/mcp/docs/atomic-and-batch-tools.md)
(despite its file name, it states that separate REST calls are not a transaction and says which guarantee each tool
gives instead).

## What it measured

The three builds against a **self-hosted PostHog open-source instance at the same pinned commit**, never PostHog Cloud.
The hosted service may behave differently, and nothing here is a measurement of PostHog Cloud. Twelve tasks in two
separately reported sets, 3 runs per task and build: 108 runs on 10 and 11 November 2026 (UTC), one `claude-sonnet-5-5`
agent per run through the Claude Agent SDK 0.3.319 (Claude Code 2.1.319), with the local PostHog MCP server as the only
tool source, in the server's default `cli` mode (one `exec` tool). The harness was hashed and timestamped before the first
measured run, fixtures were reset to the same state hash before every run, the three builds of each task ran back to back
in a balanced order, and only the server bundle changed between them. Correctness is a mechanical check of PostHog's end
state; no model judges anything. All 108 runs finished and all are counted.

Against the unmodified server, on totals over the 18 runs per build: on the pre-registered tasks, the fair test, the
research build used 15.8% fewer tool calls, 14.0% fewer turns and 23.9% fewer tool-result bytes, while the bug-fix build
used 4.8% more tool calls and 14.4% more bytes. On the friction-derived tasks, which favour the research build by
construction, the research build used 31.0% fewer tool calls, 28.9% fewer turns and 60.5% fewer bytes.

**Pre-registered tasks** (the fair test: six ordinary jobs written and frozen before the usability change list existed;
dashboard with three insights, insight rename, flag rollout change, flag inventory, deploy annotation, tag triage).
Totals over 18 runs per build; the percentage is the change from the unmodified build's total:

| Measure | Unmodified | Bug-fix build | Research build |
| --- | --- | --- | --- |
| Runs correct | 18 of 18 | 18 of 18 | 18 of 18 |
| Tool calls, total | 146 | 153 (+4.8%) | 123 (−15.8%) |
| PostHog MCP calls, total | 128 | 135 (+5.5%) | 105 (−18.0%) |
| Model turns, total | 164 | 171 (+4.3%) | 141 (−14.0%) |
| Tool-result bytes, total | 604,187 | 691,059 (+14.4%) | 459,793 (−23.9%) |
| Failed tool calls, total | 4 | 4 | 4 |
| Cost, USD (SDK estimate), total | 1.73 | 1.90 (+9.3%) | 1.72 (−0.7%) |

**Friction-derived tasks** (written after the usability changes were designed, from the jobs that motivated them; they
favour the research build by construction and are never pooled with the set above):

| Measure | Unmodified | Bug-fix build | Research build |
| --- | --- | --- | --- |
| Runs correct | 18 of 18 | 17 of 18 | 18 of 18 |
| Tool calls, total | 245 | 249 (+1.6%) | 169 (−31.0%) |
| PostHog MCP calls, total | 227 | 231 (+1.8%) | 151 (−33.5%) |
| Model turns, total | 263 | 267 (+1.5%) | 187 (−28.9%) |
| Tool-result bytes, total | 965,442 | 888,477 (−8.0%) | 381,661 (−60.5%) |
| Failed tool calls, total | 2 | 3 | 8 |
| Cost, USD (SDK estimate), total | 2.28 | 2.09 (−8.6%) | 1.77 (−22.4%) |

Tool calls include the client's own tool search, one per run; PostHog MCP calls exclude it. Percentages are to one
decimal; failed calls carry none, because the counts are too small for one to mean much. Cost was near-flat on the fair
set: most of each run's input is read back from the prompt cache at a fraction of the normal price, so fewer calls and
smaller results lower cost much less than they lower calls and bytes. Per round of the six tasks (secondary detail,
median of 3 rounds), the research build used 41 tool calls against 48 unmodified on the fair set, with no overlap
between the builds' observed ranges.

Caveats:

- The bug-fix build alone did not make the agent more efficient on either set (an earlier two-build series of the six
  pre-registered tasks showed the same: 143 tool calls unmodified against 156 on the bug-fix build). The fixes correct
  specific defects that these tasks rarely hit.
- The results measure each combined set of changes, not each change on its own; the effect of each change is attributed
  by reading which tools the agents called. The create-with-children tool was never called in any run.
- The research build failed more calls on the friction-derived set: 8 against 2 unmodified and 3 on the bug-fix build.
  Four are its own new refusals, which write nothing (a destructive batch sent without `--confirm`, a write placed in a
  read-only exec batch); the other four are two SQL field errors, which the other builds hit too, and two not-found reads
  in one run. Every one of those runs was correct.
- One model, one client, one server mode. The pre-registered tasks were written by the team that wrote the fixes, from the
  same audit findings. Cost is the SDK's estimate and depends on prompt-cache state.
- The local build differs from PostHog's hosted server: Node 25 instead of the pinned Node 26, no edge worker, a local
  Redis, analytics off, the skills archives served from a pinned local copy.
- The research build's single `exec` tool definition is 605 bytes (1.5%) larger; the seven new tools are reached through
  `exec`, not listed separately, in `cli` mode.

Per-task tables, per-round medians, every failed call with the server's reason, method and limitations:
[results/BENCHMARK.md](results/BENCHMARK.md).

**What is published, and what is not.** Published: the analysis of each series, a CSV of per-run summary metrics
(correctness, calls, turns, failures, bytes, tokens, cost, wall time), each run's sequence of tool calls (tool, exec verb
and tool name, bytes, error flag, latency; no arguments or results), the build records, the catalog each build showed the
agent, and a copy of the frozen manifest with local paths and instance identifiers removed. Not published: raw agent
transcripts, MCP request/response captures, end-state snapshots, answers and the agents' own friction notes. They carry
identifiers and tokens of the local test instance, and the summaries above are computed from them.

## Build and compare

Each build in its own worktree, so the dependency installs stay apart (Node 25 or 26, and corepack or pnpm 10+, which
switches to the pnpm version upstream pins):

```sh
git clone <this repository> posthog-mcp-experiment && cd posthog-mcp-experiment
for ref in upstream-7b516983 fixed-r3 usability-r3; do
  git worktree add "../build-$ref" "$ref"
  (cd "../build-$ref" &&
   CI=1 HUSKY=0 pnpm install --frozen-lockfile --filter '@posthog/mcp...' --config.engine-strict=false &&
   cd services/mcp && pnpm exec tsx scripts/build-hono.ts && shasum -a 256 dist/hono-server.mjs)
done
```

`--config.engine-strict=false` lets Node 25 install a repository that asks for Node 26; the measured bundles were built
on Node 25.8.1. Or apply the patch series to a clean upstream checkout at the same commit (a full clone, or the sparse
checkout in [`harness/build/clone.sh`](harness/build/clone.sh)):

```sh
cd posthog && git checkout 7b516983bef16b9692a00a6b7780a6b5a802257c
for s in bugfix usability; do
  sed 's/#.*//; /^[[:space:]]*$/d' /path/to/experiment-patches/$s/SERIES |
    while read -r p; do git am "/path/to/experiment-patches/$s/$p" < /dev/null; done
done
```

(Stop after `bugfix` for the bug-fix build.) [`harness/build/build.sh`](harness/build/build.sh) `baseline|fixed|usability`
does the same from its own clone of upstream and records every hash in `build/out/<build>/BUILD.json`. Run a bundle with
`node dist/hono-server.mjs` (environment as in [`harness/server/start-server.sh`](harness/server/start-server.sh)) and
point your MCP client at it.

`pnpm --filter @posthog/mcp exec vitest run --project unit` and `... vitest run --config vitest.hono.config.mts` run the
upstream unit suites plus the tests each change adds.

To repeat the measurement: set up the instance in [`selfhost/`](selfhost/README.md) (Docker; PostHog asks for about
4 vCPU, 16 GB RAM and 30 GB of disk), then follow [`harness/README.md`](harness/README.md). A full series of 108 runs cost
11.50 USD in API usage. `python3 harness/tests/test_offline.py` checks the harness without network, key or model.

## Reporting

- **Your results differ from ours:** please open an issue here with the task, model, client version, build hashes and
  counts (tool calls, turns, failed calls, correctness). Reproductions that disagree are the most useful feedback.
- **A bug in one of the experiment commits, the harness or the self-host setup:** open an issue here.
- **Anything in the upstream server:** report it to [PostHog/posthog](https://github.com/PostHog/posthog), following
  PostHog's security policy for vulnerabilities. This repository does not track upstream.

This build is not maintained against later upstream commits. Fixes that prove useful are offered upstream as small,
separate pull requests.

## License

MIT, as upstream outside `ee/`. PostHog's copyright and permission notice, with its carve-outs, is kept in
[LICENSE](LICENSE); nothing under `ee/` is included. One imported file carries a third-party notice of its own
(`services/mcp/worker-configuration.d.ts`, generated Cloudflare Workers type definitions under the Apache License 2.0),
kept as upstream ships it. The experiment commits, the harness and the self-host files are by IsoKron (Stormhaven
Enterprises LLC) and are released under the same MIT license; see [NOTICE](NOTICE).
