# Benchmark harness: PostHog MCP server, three builds, two task sets

IsoKron's harness for the measurement in [`../results/BENCHMARK.md`](../results/BENCHMARK.md). It compares local builds
of `services/mcp` from PostHog/posthog at one pinned commit, on two separately reported task sets (six pre-registered
tasks, six friction-derived tasks), with mechanical end-state checkers. The harness names the builds by their ids:

| Harness id | Name in the write-up | Git tag | Source |
| --- | --- | --- | --- |
| `baseline` | Unmodified | `upstream-7b516983` | the pinned commit |
| `fixed` | Bug-fix build | `fixed-r3` | plus `../experiment-patches/bugfix/` |
| `usability` | Research build | `usability-r3` | plus `../experiment-patches/usability/` (14 usability changes, a design note, two integration fixes) |
Plan and scoring: [`bench/BENCH-PLAN.md`](bench/BENCH-PLAN.md).

It is published as it was used, not packaged as a general tool. It is IsoKron's working harness, so some comments name
IsoKron's own conventions (for example `~/.isokron`, where IsoKron keeps a Cloud key that the self-hosted target refuses).

## What differs from the frozen harness

The measured series froze 109 harness files by sha256 (`../results/2026-11-11-three-builds/MANIFEST.public.json`,
`harness_files`). 98 of them are published byte-identical: every task, checker, fixture, plan, runner, server and library
file. Changed for publication, with nothing else changed in them:

| File | Change |
| --- | --- |
| `config.env`, `config.selfhosted.env` | Templates: IsoKron's project and organization ids, key-file paths and local directories replaced by `<FILL_ME>` or relative paths |
| `build/build.sh` | Reads the patch series from `../experiment-patches/` instead of copying them in from a private folder; messages name the new paths |
| `bench/_make_manifest.py` | Hashes `../experiment-patches/` in place of the old `patches/` and `patches-usability/` folders |
| `tests/test_offline.py` | A Cloud project id in a test fixture replaced by a dummy |
| `patches/SERIES`, `patches-usability/SERIES` | Now `../experiment-patches/*/SERIES`; same order, with K3 (which did not apply) left out of the list |

Not published: `patches/K3-…` (not applied to any build), the two skills archives in `server/assets/` (see below), and
everything written at run time (`runs/`, `dryruns/`, `evidence/`, `state/`, `logs/`, `.kl/`, the series' evidence chain
and the internal ledger). `README.md`, `.gitignore` and `bench/agent-cwd/.keep` were never part of the frozen set.

## Backends

`TARGET` is required, with no default (`lib/target.py`):

- `TARGET=selfhosted`: a local PostHog open-source instance (set up with [`../selfhost/`](../selfhost/README.md)),
  `config.selfhosted.env` on top of `config.env`. The harness refuses a non-loopback host. The MCP server runs with
  `server/local-runtime.mjs` preloaded: a loopback-only egress guard (each connection logged as `[egress]` in the server
  log) and the pinned skills archives (`server/assets/`, sha256 in `SHA256SUMS`) served on loopback. Every published
  result used this target.
- `TARGET=cloud`: PostHog Cloud, `config.env`. For harness development only. PostHog's Cloud terms of service (section
  2.1(i)) restrict benchmarking PostHog Cloud and publishing the results without PostHog's written consent.

No load or fuzz testing: harness requests are capped at 2 per second.

## Layout

    config.env                non-secret settings (Cloud target, model, budget, ports); config.selfhosted.env overlays it
    build/                    PIN (commit), clone.sh, build.sh baseline|fixed|usability -> build/out/<name>/{hono-server.mjs,BUILD.json}
    server/                   redis.sh, start-server.sh, local-runtime.mjs, mcp-proxy.mjs (adds the key, pins mode and project,
                              redacted capture), smoke.py, catalog.sh, assets/ (PROVENANCE.json, SHA256SUMS)
    lib/                      ph.py (REST client: guard, throttle, path and prefix refusals, redaction), redact.mjs, lock.py, target.py
    seed/                     spec.py (fixtures), state.py (snapshot and state hash), seed.py --init|--reset|--check
    bench/                    tasks/, checkers/, system.md, bench-agent.mjs, run-bench.sh + run_bench.py (driver), preflight.py,
                              cleanup.py, _make_plan.py, _make_manifest.py, freeze.py, analyze.py, BENCH-PLAN.md/.json, TASKSETS.json
    series/                   SERIES.json and the run plans of the measured three-build series
    probes/                   insights_race.py (lost-update probe, not part of the benchmark), shape_check*.py (checker validation)
    runner/                   package.json (Claude Agent SDK 0.3.319, kronicle-lite 0.10.2), kl.py (evidence chain)
    tests/                    test_offline.py + fake_posthog.py (no network, no key, no model)
    catalog/selfhosted/       what the agent saw from each build (initialize + tools/list)

## Before a run

Run every command from this directory.

1. A self-hosted PostHog instance: [`../selfhost/README.md`](../selfhost/README.md). Its `local/create-account.py` prints
   the project and organization ids and writes a project-scoped key with the MCP Server preset scopes to
   `../selfhost/.secrets/api-key`.
2. `config.selfhosted.env`: fill in `POSTHOG_PROJECT_ID` and `EXPECTED_ORG_ID` (the preflight refuses unless the key
   resolves to exactly this project in this organization).
3. `config.env`: set `ANTHROPIC_KEY_FILE` to the path of a file whose first line is your Anthropic API key (mode 600).
   Runs are billed to that key; the measured series of 108 runs cost 11.50 USD.
4. Docker (for the dedicated Redis container), Node 25 or 26, pnpm, Python 3.9+, `openssl`.
5. `(cd runner && npm ci)`, `build/clone.sh`, `build/build.sh baseline`, `build/build.sh fixed`, `build/build.sh usability`.
   Compare each `build/out/<name>/BUILD.json` `entry_sha256` with the hashes in [`../EXPERIMENT.md`](../EXPERIMENT.md).
6. The skills archives: the MCP server downloads two archives at start-up from GitHub release assets that float
   (`server/assets/PROVENANCE.json`). The runs served pinned copies from loopback, and `server/local-runtime.mjs` refuses
   files that do not match `server/assets/SHA256SUMS`. `server/assets/fetch.sh` downloads both; `skills-mcp-resources.zip`
   comes from a fixed release (v1.62.0), but `skills.zip` is re-published under the same `agent-skills-latest` tag (last
   on 11 November 2026, after the runs), so a fresh download may not match. Either use the
   current file and record its sha256 in `SHA256SUMS` (a disclosed difference from the measured runs), or ask IsoKron
   for the measured copy.

## Commands

Every live command needs `export TARGET=selfhosted` first; without it scripts refuse. `python3 -I -B lib/target.py --show`
prints the resolved target.

    python3 -I -B tests/test_offline.py                       offline tests (no network, no key, no model)
    python3 -I -B bench/preflight.py [--inventory]            read-only preflight (1 request; --inventory adds 5 list requests)
    server/catalog.sh baseline                                what the agent will see (initialize + tools/list; no tool call)
    build/build.sh fixed                                      the pin + ../experiment-patches/bugfix in SERIES order
    build/build.sh usability                                  the pin + bugfix + ../experiment-patches/usability in SERIES order
    python3 -I -B bench/freeze.py --series NAME               a series' plans, manifest, RFC 3161 stamps and chain record in series/NAME/
    python3 -I -B seed/seed.py --nonce <n12> --init --fixtures v2   seed the fixtures of both task sets
    bench/run-bench.sh --series NAME --dry-run-plan           DRY RUN, NOT MEASURED: the one-repetition plan, own nonce
    bench/run-bench.sh --series NAME                          the measured series (108 runs; resumable; stops at the series budget)
    python3 -I -B bench/analyze.py --series-dir runs/series-<n12>   each task set reported separately, per build
    python3 -I -B bench/cleanup.py --nonce <n12> [--dry-run]  soft-delete every object carrying bench-<n12>- (and nothing else)
    server/redis.sh down                                      remove the Redis container when finished

To run your own series, copy `series/usability-3build-20261110-r3/SERIES.json` to `series/<your-name>/SERIES.json`,
drop its `supersedes` and `relation_to_earlier_series` fields, and freeze it. `bench/freeze.py` commits the plan files to
the git repository it runs in and refuses to freeze an uncommitted working tree, so work in your own clone or branch.
To also anchor the freeze off-box, export `KRONICLE_ANCHOR_KEY` before `bench/freeze.py` (the script never reads a key
file and never prints the value).

## Safety rules, and where they are enforced

1. Preflight guard (`lib/ph.py` `guard()`): GET `/api/projects/<id>/`; refuses unless id == `POSTHOG_PROJECT_ID` and
   organization == `EXPECTED_ORG_ID`. No write is possible before it passes. Only `/api/projects/<id>/...` paths can be
   requested at all.
2. Name prefix: every created object is `bench-<nonce12>-...`; writes on anything else are refused (`require_prefixed`).
3. Cleanup deletes only objects with the given nonce prefix, and checks the prefix twice.
4. Throttle: one shared file lock, at most 2 requests per second and a capped hourly budget from harness scripts.
5. The PostHog key exists only in `lib/ph.py` and `server/mcp-proxy.mjs` memory; the agent process never has it.
   Captures, transcripts and logs are redacted as they are written (`ph?_...`, `sk-ant-...`, `Bearer ...`,
   Authorization values, and the literal key). Even so, treat run directories as private: they hold the instance's ids
   and object data, which is why IsoKron published summaries only.
6. One-runner lock: `.lock/runner` (mkdir). A second session is refused; a stale lock is reported, never broken.
7. Unique capture paths: one new directory per run and attempt; the proxy and the agent refuse to write to an existing file.
8. Billing: the driver refuses without `ANTHROPIC_API_KEY`; the agent removes `CLAUDE_CODE_OAUTH_TOKEN` and aborts unless
   the SDK reports `apiKeySource == ANTHROPIC_API_KEY`.
