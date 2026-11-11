# PostHog MCP server write-path experiment

An independent research experiment by [IsoKron](https://isokron.ai). It is based on PostHog's MCP server
(`services/mcp` in [PostHog/posthog](https://github.com/PostHog/posthog)) at commit `7b516983` (master, 10 November
2026), with 14 bug-fix commits and 17 usability commits that change how the server handles writes, responses and
errors, plus the benchmark harness and the self-hosted PostHog setup used to measure them.

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

| Build | Git ref | Bundle sha256 (`services/mcp/dist/hono-server.mjs`) |
| --- | --- | --- |
| Baseline: unmodified upstream `7b516983` | tag `upstream-7b516983` | `d573fa771cd73130cbdf30de29e73edc592992be2b3588af5c2ee87c1729d55b` |
| Fixed: baseline + 14 bug-fix commits | tag `fixed-r3` | `cf5053c3409b2ad5b90c2c73189cc88496054cf6e95f6aa029353f239e75d4a1` |
| Usability: fixed + 17 usability commits | tag `usability-r3`; `main` adds only docs, results, harness and self-host files | `57a1a7b97ef827a88e40979e65c3a226f2820b6b4fb2a0f691539105c9d475e0` |

These are the bundles that were measured. Built from this repository (or by applying the patch series to a clean
upstream checkout) with Node 25.8.1 and the pnpm version upstream pins (11.28.5), each reproduces its hash byte for byte.
The UI apps (`public/ui-apps`, static assets for clients that render MCP Apps) are not built; the benchmark does not use
them.

## What it changes

Each change targets a defect found in IsoKron's
[audit of PostHog's MCP server](https://isokron.ai/research/posthog-mcp-server-audit) or friction measured in a hands-on
session of ten real jobs on the baseline build. Details, files and tests for each:
[CHANGES-EXPERIMENT.md](CHANGES-EXPERIMENT.md).

**Bug fixes (14 commits).** Upstream status on 10 November 2026: the two commits of
[PostHog/posthog#131514](https://github.com/PostHog/posthog/pull/131514) (strict booleans and nullable integers in
generated schemas; open), [#132356](https://github.com/PostHog/posthog/pull/132356) (accept real comment ids in
`tasks-comments-retrieve`; open) and [#132357](https://github.com/PostHog/posthog/pull/132357) (keep the next-page hint
on exec text results; open). The other ten are prepared and will be offered upstream one small pull request at a time:
the project test-account default for actors queries, three exec parser fixes (whitespace, non-object bodies, `info`
flags), search notes and keywords, scope hints, host-free 403/429 messages, a trimmed `user-settings-update` response,
and an error for an unreadable 2xx body.

**Usability changes (17 commits, research only, not offered upstream as they are):**

| Group | Change |
| --- | --- |
| A, response shaping | Short receipts from writes and deletes (identity, what changed, URL) instead of the whole object; each `_agentNote` once per session; de-duplicated schemas in `info` and `schema`; retention results as a compact table; a rollout summary on every flag in `feature-flag-get-all` |
| B, exec behaviour | `--confirm` required for destructive tools over MCP; guessed tool names (verb order, synonyms, plurals) resolved when unambiguous, and the three closest names on an unknown tool; the failing field's schema in validation errors, with the "drill down first" rule relaxed; consistent text when skills cannot be loaded; only seen events from `read-data-schema`; up to 10 read-only commands per exec request |
| C, new tools | `insights-batch-update`, `annotations-batch-create`, `annotations-batch-delete` (validate every item first, then best-effort writes with one result per item); `dashboard-create-with-insights` (one call, compensating rollback); `insight-update-query-partial`, `feature-flag-update-conditions`, `survey-update-question` (version-checked partial updates of nested arrays). Design note: [`services/mcp/docs/atomic-and-batch-tools.md`](services/mcp/docs/atomic-and-batch-tools.md) |

## What it measured

The three builds against a **self-hosted PostHog open-source instance at the same pinned commit**, never PostHog Cloud.
The hosted service may behave differently, and nothing here is a measurement of PostHog Cloud. Twelve tasks in two
separately reported sets, 3 runs per task and build: 108 runs by `claude-sonnet-5-5` through the Claude Agent SDK 0.3.319
(Claude Code 2.1.319), with the local PostHog MCP server as the only tool source, in the server's default `cli` mode (one
`exec` tool). The harness was hashed and timestamped before the first measured run, fixtures were reset to the same
state hash before every run, the three builds of each task ran back to back in a balanced order, and only the server
bundle changed between them. Correctness is a mechanical check of PostHog's end state; no model judges anything.

**Pre-registered tasks** (the fair test: six ordinary jobs written and frozen before the usability changes existed;
dashboard with three insights, insight rename, flag rollout change, flag inventory, deploy annotation, tag triage):

| Per round of all six tasks (median of 3 rounds, [min–max]) | baseline | fixed | usability |
| --- | --- | --- | --- |
| Tool calls (all) | 48 [48–50] | 52 [48–53] | **41 [39–43]** (−15%) |
| PostHog MCP calls | 42 [42–44] | 46 [42–47] | **35 [33–37]** (−17%) |
| Turns | 54 [54–56] | 58 [54–59] | **47 [45–49]** (−13%) |
| Failed tool calls | 1 [1–2] | 1 [1–2] | 1 [0–3] |
| Tool-result bytes | 188,652 [186,397–229,138] | 226,390 [217,976–246,693] | 139,775 [113,241–206,777] |
| Runs passing their end-state checks | 18 of 18 | 18 of 18 | 18 of 18 |

**Friction-derived tasks** (written after the usability changes were designed, from the jobs that motivated them; they
favour the usability build by construction and are never pooled with the set above):

| Per round of all six tasks (median of 3 rounds, [min–max]) | baseline | fixed | usability |
| --- | --- | --- | --- |
| Tool calls (all) | 81 [76–88] | 86 [73–90] | 57 [54–58] (−30%) |
| Turns | 87 [82–94] | 92 [79–96] | 63 [60–64] (−28%) |
| Failed tool calls | 1 [0–1] | 1 [1–1] | 3 [1–4] |
| Tool-result bytes | 324,367 [288,444–352,631] | 293,954 [291,786–302,737] | 122,825 [116,400–142,436] (−62%) |
| Runs passing their end-state checks | 18 of 18 | 17 of 18 | 18 of 18 |

Percentages compare the usability build with the baseline. Bold marks non-overlapping observed ranges on the fair test;
with three rounds per build this is descriptive, not a significance test. Caveats:

- The bug fixes alone did not reduce calls or turns on either task set (an earlier two-build series of the six
  pre-registered tasks found the same: 48 calls per round on the baseline, 52 on the fixed build). They fix defects; they
  do not make ordinary jobs shorter.
- The results measure each combined set of changes, not each change on its own.
- The usability build failed more calls on the friction-derived set: 8 in 18 runs, against 2 on the baseline and 3 on
  the fixed build. Four are its own new refusals, which write nothing (a destructive batch sent without `--confirm`, a
  write placed in a read-only exec batch); the other four are two SQL field errors, which the other builds hit too, and
  two not-found reads in one run. Every one of those runs passed. On the pre-registered set each build failed 4 calls in 18 runs.
- One model, one client, one server mode. The pre-registered tasks were written by the team that wrote the fixes, from the
  same audit findings. Cost (reported by the SDK) and wall time are in the analysis but are not headline results: they
  depend on prompt-cache state.
- The local build differs from PostHog's hosted server: Node 25 instead of the pinned Node 26, no edge worker, a local
  Redis, analytics off, the skills archives served from a pinned local copy.
- The usability build's single `exec` tool definition is 605 bytes (1.5%) larger; the seven new tools are reached through
  `exec`, not listed separately, in `cli` mode.

Per-task tables, every failed call with the server's reason, method and limitations:
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

(Stop after `bugfix` for the fixed build.) [`harness/build/build.sh`](harness/build/build.sh) `baseline|fixed|usability`
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
