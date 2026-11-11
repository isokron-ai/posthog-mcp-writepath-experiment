<!-- Copied from the harness output ANALYSIS-20261110T191034Z.md. Only change: object ids in two failed-call URLs replaced by <project>/<id>. -->
# PostHog MCP benchmark: baseline vs fixed build

Series `series-007817e94cfb` · model `claude-sonnet-5-5` · manifest `e27c0aac349c37438705d716f743c314d3de3518f65c275c4b967062a698f24d` · generated 2026-11-10T19:10:34Z
Build hashes: baseline `d573fa771cd73130cbdf30de29e73edc592992be2b3588af5c2ee87c1729d55b`, fixed `cf5053c3409b2ad5b90c2c73189cc88496054cf6e95f6aa029353f239e75d4a1`
Finished attempts: 36 (usable: 36). Correctness is the mechanical checker's verdict on PostHog's end state; nothing here is judged by a model.

Cells are `median [min-max]` over the runs in that cell.

## Per build (all tasks)

| metric | baseline | fixed |
|---|---|---|
| runs usable | 18 | 18 |
| correct (checker) | 18/18 | 18/18 |
| tool calls (all) | 8 [5-11] | 9 [5-14] |
| PostHog MCP calls | 7 [4-10] | 8 [4-13] |
|   of which `call <tool>` | 4 [3-5] | 4 [2-10] |
|   of which discovery (info/schema/search/tools/help) | 3 [1-5] | 3 [1-6] |
| model turns | 9 [6-12] | 10 [6-15] |
| failed tool calls | 0 [0-2] | 0 [0-2] |
| repeated identical calls | 0 [0-0] | 0 [0-0] |
| retries after an error | 0 [0-0] | 0 [0-2] |
| tool-result bytes | 26288.5 [11292-59390] | 37015 [11506-94880] |
| input tokens | 12 [10-16] | 12 [10-20] |
| output tokens | 1807 [1264-2482] | 1911 [1375-3237] |
| cache-write tokens | 25099 [6169-40248] | 26235 [6437-53634] |
| cache-read tokens | 126595 [74648-222536] | 123969.5 [74501-254130] |
| reported cost USD | 0.093 [0.039-0.145] | 0.096 [0.040-0.186] |
| wall seconds | 19.5 [16-28] | 20 [15-42] |
| total reported cost USD | 1.70 | 1.89 |

## Per task and build

| task | build | correct | tool calls | PostHog calls | turns | failed calls | repeated | result bytes | cost USD | wall s |
|---|---|---|---|---|---|---|---|---|---|---|
| a-dashboard-three-insights | baseline | 3/3 | 9 [8-9] | 8 [7-8] | 10 [9-10] | 0 [0-0] | 0 [0-0] | 54098 [46329-54174] | 0.133 [0.125-0.136] | 21 [21-22] |
| a-dashboard-three-insights | fixed | 3/3 | 9 [9-14] | 8 [8-13] | 10 [10-15] | 0 [0-0] | 0 [0-0] | 54167 [54157-93731] | 0.137 [0.130-0.186] | 22 [19-32] |
| b-insight-rename | baseline | 3/3 | 5 [5-6] | 4 [4-5] | 6 [6-7] | 0 [0-0] | 0 [0-0] | 25756 [25140-26821] | 0.051 [0.049-0.089] | 16 [16-21] |
| b-insight-rename | fixed | 3/3 | 6 [6-13] | 5 [5-12] | 7 [7-14] | 0 [0-2] | 0 [0-0] | 28812 [26433-45218] | 0.096 [0.089-0.110] | 20 [17-42] |
| c-flag-rollout-change | baseline | 3/3 | 8 [8-9] | 7 [7-8] | 9 [9-10] | 1 [1-2] | 0 [0-0] | 24035 [24035-24196] | 0.097 [0.096-0.099] | 18 [18-18] |
| c-flag-rollout-change | fixed | 3/3 | 8 [8-8] | 7 [7-7] | 9 [9-9] | 1 [1-2] | 0 [0-0] | 24035 [23931-24035] | 0.096 [0.094-0.097] | 19 [17-21] |
| d-flag-inventory | baseline | 3/3 | 7 [5-8] | 6 [4-7] | 8 [6-9] | 0 [0-0] | 0 [0-0] | 58467 [11292-59390] | 0.100 [0.039-0.145] | 26 [19-28] |
| d-flag-inventory | fixed | 3/3 | 6 [5-7] | 5 [4-6] | 7 [6-8] | 0 [0-0] | 0 [0-0] | 57984 [11775-94880] | 0.132 [0.040-0.134] | 22 [19-25] |
| e-annotate-deploy | baseline | 3/3 | 10 [10-11] | 9 [9-10] | 11 [11-12] | 0 [0-0] | 0 [0-0] | 13653 [12095-13807] | 0.085 [0.083-0.088] | 20 [17-21] |
| e-annotate-deploy | fixed | 3/3 | 9 [9-12] | 8 [8-11] | 10 [10-13] | 0 [0-0] | 0 [0-0] | 11506 [11506-15753] | 0.081 [0.078-0.096] | 16 [15-27] |
| f-tag-triage | baseline | 3/3 | 8 [8-9] | 7 [7-8] | 9 [9-10] | 0 [0-0] | 0 [0-0] | 45257 [45022-46678] | 0.082 [0.082-0.123] | 19 [18-20] |
| f-tag-triage | fixed | 3/3 | 9 [9-9] | 8 [8-8] | 10 [10-10] | 0 [0-0] | 0 [0-0] | 46554 [46167-46554] | 0.084 [0.084-0.122] | 20 [20-20] |

## Per round (repetition) totals

| round | build | runs | correct | tool calls | turns | failed calls | repeated | result bytes | cost USD | wall s |
|---|---|---|---|---|---|---|---|---|---|---|
| 1 | baseline | 6 | 6 | 48 | 54 | 1 | 0 | 221129 | 0.59 | 122 |
| 1 | fixed | 6 | 6 | 48 | 54 | 1 | 0 | 220669 | 0.62 | 118 |
| 2 | baseline | 6 | 6 | 47 | 53 | 1 | 0 | 213569 | 0.58 | 127 |
| 2 | fixed | 6 | 6 | 52 | 58 | 2 | 0 | 299027 | 0.67 | 131 |
| 3 | baseline | 6 | 6 | 48 | 54 | 2 | 0 | 175547 | 0.53 | 110 |
| 3 | fixed | 6 | 6 | 56 | 62 | 3 | 0 | 197502 | 0.60 | 144 |

## Where the calls went (per tool; in cli mode the tool is the command inside `exec`)

| tool / command | baseline calls | fixed calls | baseline result bytes | fixed result bytes | baseline failed | fixed failed |
|---|---|---|---|---|---|---|
| `ToolSearch` | 18 | 18 | 1080 | 1080 | 0 | 0 |
| `search` | 15 | 18 | 19372 | 23082 | 0 | 0 |
| `call execute-sql` | 15 | 18 | 17078 | 21097 | 0 | 0 |
| `call insight-update` | 12 | 13 | 44994 | 45199 | 0 | 1 |
| `call insight-create` | 9 | 9 | 49444 | 49440 | 0 | 0 |
| `info insight-update` | 6 | 6 | 120000 | 120000 | 0 | 0 |
| `call feature-flag-get-all` | 5 | 4 | 9826 | 46387 | 0 | 0 |
| `call annotations-list` | 4 | 4 | 2416 | 2416 | 0 | 0 |
| `info insight-create` | 3 | 3 | 67224 | 67224 | 0 | 0 |
| `call dashboard-create` | 3 | 3 | 7704 | 7702 | 0 | 0 |
| `call dashboard-get` | 3 | 3 | 10200 | 10390 | 0 | 0 |
| `info feature-flag-get-all` | 3 | 3 | 12261 | 12261 | 0 | 0 |
| `info annotation-create` | 3 | 3 | 8901 | 8901 | 0 | 0 |
| `call dashboards-get-all` | 3 | 3 | 3549 | 3549 | 0 | 0 |
| `call annotation-create` | 3 | 3 | 2361 | 2361 | 0 | 0 |
| `info annotations-partial-update` | 3 | 3 | 8844 | 8844 | 0 | 0 |
| `call annotations-partial-update` | 3 | 3 | 2361 | 2361 | 0 | 0 |
| `info feature-flag-create` | 3 | 3 | 483 | 483 | 3 | 3 |
| `info create-feature-flag` | 3 | 3 | 50529 | 50529 | 0 | 0 |
| `info feature-flag-set-release-condition-rollout` | 3 | 3 | 10497 | 10497 | 0 | 0 |
| `call create-feature-flag` | 3 | 3 | 5238 | 5238 | 0 | 0 |
| `call feature-flag-set-release-condition-rollout` | 3 | 3 | 1560 | 1560 | 0 | 0 |
| `info insights-list` | 3 | 3 | 13785 | 13785 | 0 | 0 |
| `call insights-list` | 3 | 3 | 27973 | 27738 | 0 | 0 |
| `info dashboard-create` | 2 | 3 | 15538 | 23307 | 0 | 0 |
| `call feature-flag-get-definition-by-key` | 3 | 2 | 849 | 566 | 0 | 0 |
| `info execute-sql` | 2 | 2 | 93104 | 93104 | 0 | 0 |
| `info annotations-list` | 3 | 1 | 2913 | 971 | 0 | 0 |
| `call insight-get` | 0 | 3 | 0 | 5332 | 0 | 1 |
| `info feature-flags-partial-update` | 0 | 1 | 0 | 179 | 0 | 1 |
| `call read-data-schema` | 0 | 1 | 0 | 13595 | 0 | 0 |
| `schema insight-create` | 0 | 1 | 0 | 15245 | 0 | 0 |
| `info query-retention` | 0 | 1 | 0 | 8525 | 0 | 0 |
| `info feature-flag-update` | 1 | 0 | 161 | 0 | 1 | 0 |
| `info dashboards-get-all` | 0 | 1 | 0 | 2839 | 0 | 0 |
| `call project-get` | 0 | 1 | 0 | 5507 | 0 | 0 |
| `call advanced-activity-logs-list` | 0 | 1 | 0 | 5904 | 0 | 0 |

## Failed tool calls, with the reason the server gave

- run 7 (c-flag-rollout-change, fixed): `info feature-flag-create` — Error: [exec]: Unknown tool: "feature-flag-create". Run "search feature-flag-create" to find the current tool name before claiming the capability is unavailable.
- run 8 (c-flag-rollout-change, baseline): `info feature-flag-create` — Error: [exec]: Unknown tool: "feature-flag-create". Run "search feature-flag-create" to find the current tool name before claiming the capability is unavailable.
- run 17 (c-flag-rollout-change, fixed): `info feature-flag-create` — Error: [exec]: Unknown tool: "feature-flag-create". Run "search feature-flag-create" to find the current tool name before claiming the capability is unavailable.
- run 17 (c-flag-rollout-change, fixed): `info feature-flags-partial-update` — Error: [exec]: Unknown tool: "feature-flags-partial-update". Run "search feature-flags-partial-update" to find the current tool name before claiming the capability is unavailable.
- run 18 (c-flag-rollout-change, baseline): `info feature-flag-create` — Error: [exec]: Unknown tool: "feature-flag-create". Run "search feature-flag-create" to find the current tool name before claiming the capability is unavailable.
- run 25 (c-flag-rollout-change, baseline): `info feature-flag-create` — Error: [exec]: Unknown tool: "feature-flag-create". Run "search feature-flag-create" to find the current tool name before claiming the capability is unavailable.
- run 25 (c-flag-rollout-change, baseline): `info feature-flag-update` — Error: [exec]: Unknown tool: "feature-flag-update". Run "search feature-flag-update" to find the current tool name before claiming the capability is unavailable.
- run 26 (c-flag-rollout-change, fixed): `info feature-flag-create` — Error: [exec]: Unknown tool: "feature-flag-create". Run "search feature-flag-create" to find the current tool name before claiming the capability is unavailable.
- run 36 (b-insight-rename, fixed): `call insight-update` — Error: [insight-update]: Request failed: Path: PATCH /api/projects/<project>/insights/<id>/ Status Code: 404 (Not Found) Error Message: {"type":"invalid_request","code":"not_found","detail":"Not found.","attr":null}
- run 36 (b-insight-rename, fixed): `call insight-get` — Error: [insight-get]: Request failed: Path: GET /api/projects/<project>/insights/<id>/ Status Code: 404 (Not Found) Error Message: {"type":"invalid_request","code":"not_found","detail":"Not found.","attr":null}

## Runs the checker marked incorrect

None.

## Every attempt, including failed ones

| run | attempt | id | status | agent subtype | correct | cost USD |
|---|---|---|---|---|---|---|
| 1 | 1 | P-a-fixed-r1 | completed | success | True | 0.13677879999999998 |
| 2 | 1 | P-a-baseline-r1 | completed | success | True | 0.1328711 |
| 3 | 1 | P-d-fixed-r1 | completed | success | True | 0.1343707 |
| 4 | 1 | P-d-baseline-r1 | completed | success | True | 0.0998572 |
| 5 | 1 | P-e-baseline-r1 | completed | success | True | 0.0827788 |
| 6 | 1 | P-e-fixed-r1 | completed | success | True | 0.0779231 |
| 7 | 1 | P-c-fixed-r1 | completed | success | True | 0.09711520000000001 |
| 8 | 1 | P-c-baseline-r1 | completed | success | True | 0.0962163 |
| 9 | 1 | P-b-fixed-r1 | completed | success | True | 0.08918259999999999 |
| 10 | 1 | P-b-baseline-r1 | completed | success | True | 0.050721699999999995 |
| 11 | 1 | P-f-baseline-r1 | completed | success | True | 0.12262029999999999 |
| 12 | 1 | P-f-fixed-r1 | completed | success | True | 0.08365999999999998 |
| 13 | 1 | P-f-fixed-r2 | completed | success | True | 0.08441219999999999 |
| 14 | 1 | P-f-baseline-r2 | completed | success | True | 0.08192279999999999 |
| 15 | 1 | P-e-baseline-r2 | completed | success | True | 0.08500369999999999 |
| 16 | 1 | P-e-fixed-r2 | completed | success | True | 0.08110060000000001 |
| 17 | 1 | P-c-fixed-r2 | completed | success | True | 0.0944913 |
| 18 | 1 | P-c-baseline-r2 | completed | success | True | 0.09715320000000001 |
| 19 | 1 | P-a-fixed-r2 | completed | success | True | 0.186489 |
| 20 | 1 | P-a-baseline-r2 | completed | success | True | 0.1247312 |
| 21 | 1 | P-b-fixed-r2 | completed | success | True | 0.09565360000000002 |
| 22 | 1 | P-b-baseline-r2 | completed | success | True | 0.04925330000000001 |
| 23 | 1 | P-d-baseline-r2 | completed | success | True | 0.1447448 |
| 24 | 1 | P-d-fixed-r2 | completed | success | True | 0.1317794 |
| 25 | 1 | P-c-baseline-r3 | completed | success | True | 0.0986011 |
| 26 | 1 | P-c-fixed-r3 | completed | success | True | 0.09620490000000001 |
| 27 | 1 | P-d-baseline-r3 | completed | success | True | 0.038912 |
| 28 | 1 | P-d-fixed-r3 | completed | success | True | 0.0401323 |
| 29 | 1 | P-f-fixed-r3 | completed | success | True | 0.1222815 |
| 30 | 1 | P-f-baseline-r3 | completed | success | True | 0.08207400000000001 |
| 31 | 1 | P-a-baseline-r3 | completed | success | True | 0.1359226 |
| 32 | 1 | P-a-fixed-r3 | completed | success | True | 0.1301369 |
| 33 | 1 | P-e-baseline-r3 | completed | success | True | 0.0884761 |
| 34 | 1 | P-e-fixed-r3 | completed | success | True | 0.09622639999999999 |
| 35 | 1 | P-b-baseline-r3 | completed | success | True | 0.08912830000000001 |
| 36 | 1 | P-b-fixed-r3 | completed | success | True | 0.11040549999999999 |

## Limitations

- Three repetitions per task and build show spread, not a distribution; no significance test is claimed. Differences inside the min-max ranges of the other build are not evidence of a difference.
- One model (`claude-sonnet-5-5`), one client (Claude Agent SDK), one server mode (cli: a single `exec` tool). Other models, clients or tools mode may behave differently.
- The six tasks were written by the same team that wrote the fixes, and the same findings informed both: the tasks exercise the behaviours the patches change (partial updates, flag filter preservation, paging signals, tag lists). The result says how the fixes do on these tasks, not how the server does on PostHog work in general.
- Correctness is a mechanical end-state check with exact criteria; a run can be marked incorrect for a deviation a human would accept (and the reverse cannot be ruled out for criteria the checker does not have).
- Cost is the SDK's reported estimate and depends on prompt-cache state; baseline and fixed runs alternate so that cache and time effects do not fall on one build, but they are not eliminated.
- The backend is PostHog Cloud (shared, changing): latency and server-side behaviour can drift during the series; the two builds differ only in the local MCP server bundle.
- The local build differs from PostHog's hosted MCP in its surroundings: Node 25 instead of the pinned Node 26, no edge worker, a local Redis, analytics off, UI apps not built.
- The friction lists in each run are the agent's own opinion; they are leads and are not used in any number above.
- Fixtures are reset by repair (not by a fresh project); the state hash covers the benchmark's own objects only, not the rest of the project.


---
**Correction (2026-11-11):** the Limitations line "The backend is PostHog Cloud" above is a stale template line from the harness's Cloud-era analysis script. This series ran against the self-hosted open-source instance: its freeze (`state/freeze.json` in the harness) records `target: selfhosted`. The analysis script was later changed to name the target from the manifest. The numbers above are unaffected.
