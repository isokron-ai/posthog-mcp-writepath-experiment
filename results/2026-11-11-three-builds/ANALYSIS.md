<!-- Copied from the harness output ANALYSIS-20261111T004907Z.md. Only change: object ids in two failed-call URLs replaced by <project>/<id>. -->
# PostHog MCP benchmark: baseline vs fixed vs usability

Series `series-64ff29b657a3` (usability-3build-20261110-r3) · model `claude-sonnet-5-5` · manifest `ba28998491b76e9dd48faa52ef9c77f130c07721a34e2c584876a525090ac872` · generated 2026-11-11T00:49:07Z
Build hashes: baseline `d573fa771cd73130cbdf30de29e73edc592992be2b3588af5c2ee87c1729d55b`, fixed `cf5053c3409b2ad5b90c2c73189cc88496054cf6e95f6aa029353f239e75d4a1`, usability `57a1a7b97ef827a88e40979e65c3a226f2820b6b4fb2a0f691539105c9d475e0`
Finished attempts: 108 (usable: 108). Correctness is the mechanical checker's verdict on PostHog's end state; nothing here is judged by a model.

Cells are `median [min-max]` over the runs in that cell. **Each task set is reported on its own, per build. The sets are never added together:** the pre-registered set is the fair test; the friction-derived set was written after the usability changes were designed and favours the usability build by construction.

## Task set: pre-registered

The fair test. Written and frozen on 2026-11-10 (first freeze f9e60755, then e27c0aac), before the usability change list existed. Prompts and checker criteria unchanged since then.

### Per build (the 6 tasks of this set)

| metric | baseline | fixed | usability |
|---|---|---|---|
| runs usable | 18 | 18 | 18 |
| correct (checker) | 18/18 | 18/18 | 18/18 |
| tool calls (all) | 8 [6-11] | 8.5 [6-12] | 7 [4-10] |
| PostHog MCP calls | 7 [5-10] | 7.5 [5-11] | 6 [3-9] |
|   of which `call <tool>` | 4 [2-6] | 4.5 [2-6] | 4 [1-5] |
|   of which discovery (info/schema/search/tools/help) | 2.5 [1-5] | 3 [1-6] | 2 [1-5] |
| model turns | 9 [7-12] | 9.5 [7-13] | 8 [5-11] |
| failed tool calls | 0 [0-2] | 0 [0-2] | 0 [0-1] |
| repeated identical calls | 0 [0-0] | 0 [0-0] | 0 [0-0] |
| retries after an error | 0 [0-0] | 0 [0-0] | 0 [0-1] |
| tool-result bytes | 26825.5 [11432-67417] | 38167 [14251-67137] | 21702.5 [9890-95935] |
| input tokens | 12 [10-16] | 14 [10-16] | 11 [10-18] |
| output tokens | 1759 [1304-2635] | 1995 [1391-2634] | 1608 [949-2211] |
| cache-write tokens | 26076 [6651-43832] | 26460.5 [11160-43670] | 24593 [21178-55940] |
| cache-read tokens | 121108.5 [75021-171856] | 126947 [75144-182563] | 110056 [70332-220237] |
| reported cost USD | 0.090 [0.043-0.153] | 0.097 [0.052-0.153] | 0.085 [0.076-0.167] |
| wall seconds | 18 [13-23] | 19.5 [14-25] | 17.5 [12-23] |
| reported cost USD, this set | 1.73 | 1.90 | 1.72 |

### Per task and build

| task | build | correct | tool calls | PostHog calls | turns | failed calls | repeated | result bytes | cost USD | wall s |
|---|---|---|---|---|---|---|---|---|---|---|
| a-dashboard-three-insights | baseline | 3/3 | 10 [9-10] | 9 [8-9] | 11 [10-11] | 0 [0-0] | 0 [0-0] | 67168 [53549-67417] | 0.153 [0.133-0.153] | 23 [22-23] |
| a-dashboard-three-insights | fixed | 3/3 | 10 [9-10] | 9 [8-9] | 11 [10-11] | 0 [0-0] | 0 [0-0] | 57587 [53521-67137] | 0.140 [0.133-0.153] | 24 [22-24] |
| a-dashboard-three-insights | usability | 3/3 | 8 [8-8] | 7 [7-7] | 9 [9-9] | 0 [0-1] | 0 [0-0] | 35443 [35443-41038] | 0.115 [0.112-0.129] | 19 [18-23] |
| b-insight-rename | baseline | 3/3 | 6 [6-7] | 5 [5-6] | 7 [7-8] | 0 [0-0] | 0 [0-0] | 27343 [26308-35556] | 0.073 [0.051-0.089] | 15 [13-18] |
| b-insight-rename | fixed | 3/3 | 6 [6-7] | 5 [5-6] | 7 [7-8] | 0 [0-0] | 0 [0-0] | 26693 [26565-35661] | 0.090 [0.052-0.113] | 15 [14-20] |
| b-insight-rename | usability | 3/3 | 6 [6-8] | 5 [5-7] | 7 [7-9] | 0 [0-1] | 0 [0-0] | 21894 [21511-28963] | 0.083 [0.083-0.109] | 15 [14-19] |
| c-flag-rollout-change | baseline | 3/3 | 7 [7-9] | 6 [6-8] | 8 [8-10] | 1 [1-2] | 0 [0-0] | 23752 [23752-24196] | 0.092 [0.092-0.100] | 16 [15-21] |
| c-flag-rollout-change | fixed | 3/3 | 8 [7-9] | 7 [6-8] | 9 [8-10] | 1 [1-2] | 0 [0-0] | 24035 [23752-24196] | 0.097 [0.092-0.099] | 18 [17-19] |
| c-flag-rollout-change | usability | 3/3 | 4 [4-6] | 3 [3-5] | 5 [5-7] | 0 [0-1] | 0 [0-0] | 17751 [17751-22863] | 0.077 [0.076-0.085] | 13 [12-13] |
| d-flag-inventory | baseline | 3/3 | 6 [6-7] | 5 [5-6] | 7 [7-8] | 0 [0-0] | 0 [0-0] | 11915 [11432-58467] | 0.043 [0.043-0.131] | 20 [19-22] |
| d-flag-inventory | fixed | 3/3 | 7 [7-7] | 6 [6-6] | 8 [8-8] | 0 [0-0] | 0 [0-0] | 57984 [57984-57984] | 0.127 [0.098-0.138] | 25 [21-25] |
| d-flag-inventory | usability | 3/3 | 5 [4-5] | 4 [3-4] | 6 [5-6] | 0 [0-0] | 0 [0-0] | 11875 [11875-95935] | 0.078 [0.078-0.167] | 19 [18-19] |
| e-annotate-deploy | baseline | 3/3 | 10 [10-11] | 9 [9-10] | 11 [11-12] | 0 [0-0] | 0 [0-0] | 12546 [12260-12546] | 0.087 [0.084-0.088] | 18 [17-20] |
| e-annotate-deploy | fixed | 3/3 | 12 [11-12] | 11 [10-11] | 13 [12-13] | 0 [0-0] | 0 [0-0] | 15222 [14251-15481] | 0.093 [0.092-0.097] | 20 [19-22] |
| e-annotate-deploy | usability | 3/3 | 10 [9-10] | 9 [8-9] | 11 [10-11] | 0 [0-0] | 0 [0-0] | 10608 [9890-10823] | 0.084 [0.080-0.085] | 17 [16-18] |
| f-tag-triage | baseline | 3/3 | 8 [8-9] | 7 [7-8] | 9 [9-10] | 0 [0-0] | 0 [0-0] | 45268 [45033-45679] | 0.118 [0.082-0.122] | 17 [16-17] |
| f-tag-triage | fixed | 3/3 | 9 [7-9] | 8 [6-8] | 10 [8-10] | 0 [0-0] | 0 [0-0] | 45679 [40673-46654] | 0.088 [0.072-0.121] | 18 [15-19] |
| f-tag-triage | usability | 3/3 | 7 [7-8] | 6 [6-7] | 8 [8-9] | 0 [0-1] | 0 [0-0] | 25146 [15838-25146] | 0.095 [0.087-0.100] | 17 [16-19] |

### Per round (repetition) totals, this set

| round | build | runs | correct | tool calls | turns | failed calls | repeated | result bytes | cost USD | wall s |
|---|---|---|---|---|---|---|---|---|---|---|
| 1 | baseline | 6 | 6 | 50 | 56 | 2 | 0 | 186397 | 0.59 | 114 |
| 1 | fixed | 6 | 6 | 48 | 54 | 1 | 0 | 217976 | 0.58 | 114 |
| 1 | usability | 6 | 6 | 41 | 47 | 1 | 0 | 113241 | 0.52 | 98 |
| 2 | baseline | 6 | 6 | 48 | 54 | 1 | 0 | 229138 | 0.60 | 113 |
| 2 | fixed | 6 | 6 | 52 | 58 | 2 | 0 | 226390 | 0.64 | 119 |
| 2 | usability | 6 | 6 | 39 | 45 | 0 | 0 | 206777 | 0.62 | 99 |
| 3 | baseline | 6 | 6 | 48 | 54 | 1 | 0 | 188652 | 0.54 | 105 |
| 3 | fixed | 6 | 6 | 53 | 59 | 1 | 0 | 246693 | 0.68 | 124 |
| 3 | usability | 6 | 6 | 43 | 49 | 3 | 0 | 139775 | 0.58 | 108 |

### Where the calls went, this set (per tool; in cli mode the tool is the command inside `exec`)

| tool / command | baseline calls | fixed calls | usability calls | baseline result bytes | fixed result bytes | usability result bytes | baseline failed | fixed failed | usability failed |
|---|---|---|---|---|---|---|---|---|---|
| `ToolSearch` | 18 | 18 | 18 | 1080 | 1080 | 1080 | 0 | 0 | 0 |
| `call execute-sql` | 17 | 17 | 15 | 25601 | 24374 | 18614 | 0 | 0 | 1 |
| `search` | 15 | 16 | 10 | 19129 | 19147 | 13004 | 0 | 0 | 0 |
| `call insight-update` | 12 | 12 | 9 | 45015 | 45015 | 11718 | 0 | 0 | 0 |
| `call insight-create` | 9 | 9 | 10 | 48444 | 48223 | 11962 | 0 | 0 | 1 |
| `info insight-update` | 6 | 6 | 5 | 120000 | 120000 | 85440 | 0 | 0 | 0 |
| `call feature-flag-get-all` | 6 | 6 | 3 | 9966 | 9966 | 51494 | 0 | 0 | 0 |
| `call annotations-list` | 4 | 6 | 4 | 1219 | 2733 | 1820 | 0 | 0 | 0 |
| `info insight-create` | 3 | 3 | 3 | 67224 | 67224 | 66293 | 0 | 0 | 0 |
| `call dashboard-create` | 3 | 3 | 3 | 7704 | 7704 | 5748 | 0 | 0 | 0 |
| `info feature-flag-create` | 3 | 3 | 3 | 483 | 483 | 45693 | 3 | 3 | 0 |
| `call create-feature-flag` | 3 | 3 | 3 | 5238 | 5238 | 3690 | 0 | 0 | 0 |
| `call insights-list` | 3 | 3 | 3 | 28232 | 28232 | 14739 | 0 | 0 | 0 |
| `info annotation-create` | 3 | 3 | 3 | 8901 | 8901 | 9030 | 0 | 0 | 0 |
| `call dashboards-get-all` | 3 | 3 | 3 | 3555 | 3555 | 2697 | 0 | 0 | 0 |
| `call annotation-create` | 3 | 3 | 3 | 2370 | 2370 | 468 | 0 | 0 | 0 |
| `info annotations-partial-update` | 3 | 3 | 3 | 8844 | 8844 | 8040 | 0 | 0 | 0 |
| `call annotations-partial-update` | 3 | 3 | 3 | 2370 | 2370 | 1315 | 0 | 0 | 0 |
| `info feature-flag-get-all` | 3 | 3 | 3 | 12261 | 12261 | 13182 | 0 | 0 | 0 |
| `info dashboard-create` | 3 | 3 | 2 | 23307 | 23307 | 14148 | 0 | 0 | 0 |
| `call dashboard-get` | 3 | 3 | 2 | 9774 | 9774 | 6516 | 0 | 0 | 0 |
| `info create-feature-flag` | 3 | 3 | 0 | 50529 | 50529 | 0 | 0 | 0 | 0 |
| `info feature-flag-set-release-condition-rollout` | 3 | 3 | 0 | 10497 | 10497 | 0 | 0 | 0 | 0 |
| `call feature-flag-set-release-condition-rollout` | 3 | 3 | 0 | 1560 | 1560 | 0 | 0 | 0 | 0 |
| `info insights-list` | 3 | 2 | 1 | 13785 | 9190 | 4595 | 0 | 0 | 0 |
| `info annotations-list` | 3 | 2 | 1 | 2913 | 1942 | 971 | 0 | 0 | 0 |
| `info execute-sql` | 1 | 3 | 1 | 46552 | 139656 | 46903 | 0 | 0 | 0 |
| `call read-data-schema` | 2 | 1 | 0 | 27190 | 13595 | 0 | 0 | 0 | 0 |
| `call feature-flag-get-definition-by-key` | 1 | 2 | 0 | 283 | 566 | 0 | 0 | 0 | 0 |
| `info dashboards-get-all` | 0 | 3 | 0 | 0 | 8517 | 0 | 0 | 0 | 0 |
| `info feature-flag-update` | 1 | 1 | 0 | 161 | 161 | 0 | 1 | 1 | 0 |
| `call update-feature-flag` | 0 | 0 | 2 | 0 | 0 | 2460 | 0 | 0 | 0 |
| `call insights-batch-update` | 0 | 0 | 2 | 0 | 0 | 1285 | 0 | 0 | 1 |
| `info insights-batch-update` | 0 | 0 | 1 | 0 | 0 | 3469 | 0 | 0 | 0 |
| `info read-data-schema` | 0 | 1 | 0 | 0 | 4045 | 0 | 0 | 0 | 0 |
| `info dashboard-get` | 0 | 0 | 1 | 0 | 0 | 7077 | 0 | 0 | 0 |
| `info feature-flags-partial-update` | 0 | 0 | 1 | 0 | 0 | 318 | 0 | 0 | 1 |
| `info feature-flag-update-conditions` | 0 | 0 | 1 | 0 | 0 | 5714 | 0 | 0 | 0 |
| `call feature-flag-update-conditions` | 0 | 0 | 1 | 0 | 0 | 310 | 0 | 0 | 0 |

## Task set: friction-derived

Built on 2026-11-10 from the jobs of the friction session (FRICTION-REPORT-20261110), AFTER the usability changes were designed. It exercises what those changes target and therefore favours the usability build by construction; it is never pooled with the pre-registered set.

### Per build (the 6 tasks of this set)

| metric | baseline | fixed | usability |
|---|---|---|---|
| runs usable | 18 | 18 | 18 |
| correct (checker) | 18/18 | 17/18 | 18/18 |
| tool calls (all) | 9 [5-39] | 9 [5-37] | 9 [4-18] |
| PostHog MCP calls | 8 [4-38] | 8 [4-36] | 8 [3-17] |
|   of which `call <tool>` | 5.5 [2-32] | 5.5 [2-31] | 6 [1-11] |
|   of which discovery (info/schema/search/tools/help) | 2.5 [2-6] | 3 [2-6] | 2 [1-6] |
| model turns | 10 [6-40] | 10 [6-38] | 10 [5-19] |
| failed tool calls | 0 [0-1] | 0 [0-1] | 0 [0-2] |
| repeated identical calls | 0 [0-0] | 0 [0-0] | 0 [0-0] |
| retries after an error | 0 [0-1] | 0 [0-1] | 0 [0-2] |
| tool-result bytes | 43463 [25807-133941] | 45190 [24151-88946] | 21335 [6577-38967] |
| input tokens | 12 [10-18] | 12 [10-16] | 14 [10-20] |
| output tokens | 2319 [1185-6343] | 2399.5 [1196-4741] | 2212.5 [701-3477] |
| cache-write tokens | 27917 [12274-76334] | 31159 [10585-58258] | 25386.5 [9186-34742] |
| cache-read tokens | 117976 [74791-332342] | 121106.5 [76014-193843] | 130120.5 [69092-258891] |
| reported cost USD | 0.095 [0.056-0.288] | 0.109 [0.048-0.212] | 0.101 [0.060-0.148] |
| wall seconds | 20 [14-41] | 22 [13-41] | 22.5 [11-30] |
| reported cost USD, this set | 2.28 | 2.09 | 1.77 |

### Per task and build

| task | build | correct | tool calls | PostHog calls | turns | failed calls | repeated | result bytes | cost USD | wall s |
|---|---|---|---|---|---|---|---|---|---|---|
| g-dashboard-five-tiles | baseline | 3/3 | 12 [11-13] | 11 [10-12] | 13 [12-14] | 0 [0-0] | 0 [0-0] | 79386 [65440-100324] | 0.176 [0.154-0.195] | 27 [23-30] |
| g-dashboard-five-tiles | fixed | 3/3 | 12 [11-12] | 11 [10-11] | 13 [12-13] | 0 [0-0] | 0 [0-0] | 70931 [63360-71204] | 0.163 [0.150-0.164] | 25 [24-29] |
| g-dashboard-five-tiles | usability | 3/3 | 9 [9-10] | 8 [8-9] | 10 [10-11] | 0 [0-1] | 0 [0-0] | 37426 [37426-38967] | 0.129 [0.122-0.148] | 23 [22-29] |
| h-bulk-tag-annotate | baseline | 3/3 | 28 [28-39] | 27 [27-38] | 29 [29-40] | 0 [0-1] | 0 [0-0] | 83894 [83894-133941] | 0.188 [0.188-0.288] | 28 [27-41] |
| h-bulk-tag-annotate | fixed | 3/3 | 37 [26-37] | 36 [25-36] | 38 [27-38] | 1 [0-1] | 0 [0-0] | 87148 [78334-88946] | 0.211 [0.182-0.212] | 36 [27-41] |
| h-bulk-tag-annotate | usability | 3/3 | 10 [10-11] | 9 [9-10] | 11 [11-12] | 1 [1-2] | 0 [0-0] | 19477 [13839-27006] | 0.114 [0.109-0.124] | 30 [29-30] |
| i-flag-add-variant | baseline | 3/3 | 5 [5-5] | 4 [4-4] | 6 [6-6] | 0 [0-0] | 0 [0-0] | 25807 [25807-25911] | 0.084 [0.084-0.088] | 15 [14-15] |
| i-flag-add-variant | fixed | 3/3 | 5 [5-5] | 4 [4-4] | 6 [6-6] | 0 [0-0] | 0 [0-0] | 25808 [25807-25809] | 0.048 [0.048-0.049] | 13 [13-14] |
| i-flag-add-variant | usability | 3/3 | 5 [4-5] | 4 [3-4] | 6 [5-6] | 0 [0-0] | 0 [0-0] | 23216 [23193-23329] | 0.083 [0.082-0.085] | 13 [13-13] |
| j-survey-edit-question | baseline | 3/3 | 6 [6-7] | 5 [5-6] | 7 [7-8] | 0 [0-1] | 0 [0-0] | 58741 [58191-59011] | 0.087 [0.083-0.127] | 16 [16-17] |
| j-survey-edit-question | fixed | 3/3 | 6 [6-7] | 5 [5-6] | 7 [7-8] | 0 [0-1] | 0 [0-0] | 61030 [59012-61032] | 0.123 [0.091-0.123] | 15 [14-17] |
| j-survey-edit-question | usability | 3/3 | 5 [5-7] | 4 [4-6] | 6 [6-8] | 0 [0-1] | 0 [0-0] | 6658 [6577-6659] | 0.060 [0.060-0.072] | 11 [11-16] |
| k-funnel-step-edit | baseline | 3/3 | 6 [6-6] | 5 [5-5] | 7 [7-7] | 0 [0-0] | 0 [0-0] | 28614 [28519-28735] | 0.094 [0.056-0.094] | 16 [16-16] |
| k-funnel-step-edit | fixed | 3/3 | 7 [6-7] | 6 [5-6] | 8 [7-8] | 0 [0-0] | 0 [0-0] | 28492 [28470-29086] | 0.065 [0.061-0.094] | 17 [16-20] |
| k-funnel-step-edit | usability | 3/3 | 9 [7-10] | 8 [6-9] | 10 [8-11] | 0 [0-2] | 0 [0-0] | 25921 [16464-33855] | 0.098 [0.095-0.110] | 21 [19-23] |
| l-cleanup | baseline | 3/3 | 20 [20-22] | 19 [19-21] | 21 [21-23] | 0 [0-0] | 0 [0-0] | 26588 [26043-26596] | 0.097 [0.086-0.118] | 26 [24-30] |
| l-cleanup | fixed | 2/3 | 21 [17-22] | 20 [16-21] | 22 [18-23] | 0 [0-0] | 0 [0-0] | 28489 [24151-31368] | 0.089 [0.085-0.131] | 25 [24-27] |
| l-cleanup | usability | 3/3 | 18 [17-18] | 17 [16-17] | 19 [18-19] | 0 [0-0] | 0 [0-0] | 14161 [13182-14305] | 0.104 [0.070-0.110] | 25 [25-26] |

### Per round (repetition) totals, this set

| round | build | runs | correct | tool calls | turns | failed calls | repeated | result bytes | cost USD | wall s |
|---|---|---|---|---|---|---|---|---|---|---|
| 1 | baseline | 6 | 6 | 76 | 82 | 0 | 0 | 288444 | 0.69 | 122 |
| 1 | fixed | 6 | 6 | 86 | 92 | 1 | 0 | 291786 | 0.72 | 137 |
| 1 | usability | 6 | 6 | 57 | 63 | 3 | 0 | 116400 | 0.59 | 126 |
| 2 | baseline | 6 | 6 | 81 | 87 | 1 | 0 | 324367 | 0.78 | 128 |
| 2 | fixed | 6 | 6 | 90 | 96 | 1 | 0 | 302737 | 0.70 | 136 |
| 2 | usability | 6 | 6 | 58 | 64 | 4 | 0 | 122825 | 0.61 | 131 |
| 3 | baseline | 6 | 6 | 88 | 94 | 1 | 0 | 352631 | 0.82 | 147 |
| 3 | fixed | 6 | 5 | 73 | 79 | 1 | 0 | 293954 | 0.67 | 124 |
| 3 | usability | 6 | 6 | 54 | 60 | 1 | 0 | 142436 | 0.57 | 122 |

### Where the calls went, this set (per tool; in cli mode the tool is the command inside `exec`)

| tool / command | baseline calls | fixed calls | usability calls | baseline result bytes | fixed result bytes | usability result bytes | baseline failed | fixed failed | usability failed |
|---|---|---|---|---|---|---|---|---|---|
| `search` | 22 | 22 | 22 | 24410 | 21665 | 26198 | 0 | 0 | 0 |
| `call insight-update` | 33 | 33 | 0 | 119283 | 118769 | 0 | 0 | 0 | 0 |
| `call execute-sql` | 20 | 18 | 17 | 19395 | 27689 | 15303 | 2 | 3 | 2 |
| `ToolSearch` | 18 | 18 | 18 | 1080 | 1080 | 1080 | 0 | 0 | 0 |
| `call insight-delete` | 18 | 16 | 18 | 34182 | 30384 | 1836 | 0 | 0 | 0 |
| `call annotation-create` | 24 | 24 | 0 | 17955 | 17955 | 0 | 0 | 0 | 0 |
| `call insight-create` | 15 | 15 | 16 | 79774 | 77547 | 13859 | 0 | 0 | 1 |
| `call insight-get` | 13 | 23 | 4 | 25626 | 44510 | 3933 | 0 | 0 | 2 |
| `call annotation-delete` | 15 | 15 | 0 | 11313 | 11313 | 0 | 0 | 0 | 0 |
| `call annotations-list` | 4 | 5 | 6 | 3457 | 6452 | 12268 | 0 | 0 | 0 |
| `info insight-update` | 6 | 6 | 2 | 120000 | 120000 | 34176 | 0 | 0 | 0 |
| `call dashboard-create` | 3 | 3 | 3 | 7755 | 7755 | 5751 | 0 | 0 | 0 |
| `call dashboard-get` | 3 | 3 | 3 | 14196 | 14196 | 14196 | 0 | 0 | 0 |
| `info update-feature-flag` | 3 | 3 | 3 | 62007 | 62007 | 58841 | 0 | 0 | 0 |
| `call update-feature-flag` | 3 | 3 | 3 | 6352 | 6251 | 4703 | 0 | 0 | 0 |
| `info annotations-list` | 4 | 3 | 2 | 3884 | 2913 | 1942 | 0 | 0 | 0 |
| `info insight-delete` | 3 | 3 | 3 | 1839 | 1839 | 2310 | 0 | 0 | 0 |
| `info dashboard-create` | 3 | 3 | 2 | 23307 | 23307 | 53222 | 0 | 0 | 0 |
| `call feature-flag-get-definition-by-key` | 3 | 3 | 2 | 6217 | 6217 | 3092 | 0 | 0 | 0 |
| `info insight-create` | 3 | 3 | 1 | 67224 | 67224 | 26611 | 0 | 0 | 0 |
| `info dashboard-delete` | 3 | 3 | 1 | 1590 | 1590 | 687 | 0 | 0 | 0 |
| `call dashboard-delete` | 3 | 3 | 1 | 2706 | 2706 | 84 | 0 | 0 | 0 |
| `info survey-update` | 3 | 3 | 0 | 156405 | 156405 | 0 | 0 | 0 | 0 |
| `call survey-update` | 3 | 3 | 0 | 8275 | 8043 | 0 | 0 | 0 | 0 |
| `info annotation-create` | 3 | 3 | 0 | 8901 | 8901 | 0 | 0 | 0 | 0 |
| `call insights-batch-update` | 0 | 0 | 6 | 0 | 0 | 6792 | 0 | 0 | 3 |
| `info annotation-delete` | 3 | 3 | 0 | 1662 | 1662 | 0 | 0 | 0 | 0 |
| `call survey-get` | 3 | 1 | 1 | 9260 | 3194 | 2615 | 0 | 0 | 0 |
| `call insights-list` | 2 | 1 | 2 | 23242 | 11621 | 1440 | 0 | 0 | 0 |
| `call surveys-get-all` | 0 | 2 | 2 | 0 | 6721 | 6149 | 0 | 0 | 0 |
| `info survey-update-question` | 0 | 0 | 3 | 0 | 0 | 8244 | 0 | 0 | 0 |
| `call survey-update-question` | 0 | 0 | 3 | 0 | 0 | 1020 | 0 | 0 | 0 |
| `info insights-list` | 2 | 0 | 1 | 9190 | 0 | 4595 | 0 | 0 | 0 |
| `info insights-batch-update` | 0 | 0 | 3 | 0 | 0 | 29701 | 0 | 0 | 0 |
| `call annotations-batch-create` | 0 | 0 | 3 | 0 | 0 | 3159 | 0 | 0 | 0 |
| `info annotations-batch-delete` | 0 | 0 | 3 | 0 | 0 | 4827 | 0 | 0 | 0 |
| `call annotations-batch-delete` | 0 | 0 | 3 | 0 | 0 | 2385 | 0 | 0 | 0 |
| `info insight-update-query-partial` | 0 | 0 | 3 | 0 | 0 | 13701 | 0 | 0 | 0 |
| `call insight-update-query-partial` | 0 | 0 | 3 | 0 | 0 | 5016 | 0 | 0 | 0 |
| `info surveys-get-all` | 0 | 2 | 0 | 0 | 4926 | 0 | 0 | 0 | 0 |
| `info dashboards-bulk-delete` | 0 | 0 | 2 | 0 | 0 | 2302 | 0 | 0 | 0 |
| `call dashboards-bulk-delete` | 0 | 0 | 2 | 0 | 0 | 108 | 0 | 0 | 0 |
| `info dashboard-widgets-batch-add` | 0 | 2 | 0 | 0 | 10996 | 0 | 0 | 0 | 0 |
| `schema query-retention` | 2 | 0 | 0 | 34808 | 0 | 0 | 0 | 0 | 0 |
| `info insight-get` | 0 | 1 | 0 | 0 | 2639 | 0 | 0 | 0 | 0 |
| `call project-get` | 0 | 0 | 1 | 0 | 0 | 5507 | 0 | 0 | 0 |
| `info annotations-batch-create` | 0 | 0 | 1 | 0 | 0 | 4008 | 0 | 0 | 0 |
| `call read-data-schema` | 1 | 0 | 0 | 13595 | 0 | 0 | 0 | 0 | 0 |
| `info execute-sql` | 1 | 0 | 0 | 46552 | 0 | 0 | 0 | 0 | 0 |

## Failed tool calls, with the reason the server gave

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

## Runs the checker marked incorrect

- run 77 l-cleanup (friction-derived, fixed): failed criteria reported_count_matches, tmp_insights_gone

## Every attempt, including failed ones

| run | attempt | set | id | status | agent subtype | correct | cost USD |
|---|---|---|---|---|---|---|---|
| 1 | 1 | pre-registered | P-a-usability-r1 | completed | success | True | 0.1150892 |
| 2 | 1 | pre-registered | P-a-baseline-r1 | completed | success | True | 0.15322390000000002 |
| 3 | 1 | pre-registered | P-a-fixed-r1 | completed | success | True | 0.1330002 |
| 4 | 1 | friction-derived | P-j-fixed-r1 | completed | success | True | 0.1227892 |
| 5 | 1 | friction-derived | P-j-usability-r1 | completed | success | True | 0.060021700000000004 |
| 6 | 1 | friction-derived | P-j-baseline-r1 | completed | success | True | 0.0871123 |
| 7 | 1 | pre-registered | P-c-fixed-r1 | completed | success | True | 0.09225140000000001 |
| 8 | 1 | pre-registered | P-c-baseline-r1 | completed | success | True | 0.0999392 |
| 9 | 1 | pre-registered | P-c-usability-r1 | completed | success | True | 0.076041 |
| 10 | 1 | friction-derived | P-g-fixed-r1 | completed | success | True | 0.1502503 |
| 11 | 1 | friction-derived | P-g-baseline-r1 | completed | success | True | 0.15380939999999999 |
| 12 | 1 | friction-derived | P-g-usability-r1 | completed | success | True | 0.12871550000000004 |
| 13 | 1 | friction-derived | P-i-usability-r1 | completed | success | True | 0.0848419 |
| 14 | 1 | friction-derived | P-i-baseline-r1 | completed | success | True | 0.0838001 |
| 15 | 1 | friction-derived | P-i-fixed-r1 | completed | success | True | 0.0476569 |
| 16 | 1 | pre-registered | P-f-baseline-r1 | completed | success | True | 0.1182111 |
| 17 | 1 | pre-registered | P-f-fixed-r1 | completed | success | True | 0.0721065 |
| 18 | 1 | pre-registered | P-f-usability-r1 | completed | success | True | 0.08656839999999999 |
| 19 | 1 | friction-derived | P-h-baseline-r1 | completed | success | True | 0.1876681 |
| 20 | 1 | friction-derived | P-h-usability-r1 | completed | success | True | 0.1136151 |
| 21 | 1 | friction-derived | P-h-fixed-r1 | completed | success | True | 0.21199620000000002 |
| 22 | 1 | pre-registered | P-b-baseline-r1 | completed | success | True | 0.0888928 |
| 23 | 1 | pre-registered | P-b-usability-r1 | completed | success | True | 0.08255810000000001 |
| 24 | 1 | pre-registered | P-b-fixed-r1 | completed | success | True | 0.052219299999999996 |
| 25 | 1 | friction-derived | P-l-usability-r1 | completed | success | True | 0.10978660000000001 |
| 26 | 1 | friction-derived | P-l-baseline-r1 | completed | success | True | 0.1175388 |
| 27 | 1 | friction-derived | P-l-fixed-r1 | completed | success | True | 0.0890232 |
| 28 | 1 | friction-derived | P-k-fixed-r1 | completed | success | True | 0.0943444 |
| 29 | 1 | friction-derived | P-k-baseline-r1 | completed | success | True | 0.055944400000000005 |
| 30 | 1 | friction-derived | P-k-usability-r1 | completed | success | True | 0.09497299999999999 |
| 31 | 1 | pre-registered | P-e-baseline-r1 | completed | success | True | 0.0881988 |
| 32 | 1 | pre-registered | P-e-usability-r1 | completed | success | True | 0.08354809999999999 |
| 33 | 1 | pre-registered | P-e-fixed-r1 | completed | success | True | 0.09341189999999999 |
| 34 | 1 | pre-registered | P-d-fixed-r1 | completed | success | True | 0.1376177 |
| 35 | 1 | pre-registered | P-d-usability-r1 | completed | success | True | 0.07761670000000001 |
| 36 | 1 | pre-registered | P-d-baseline-r1 | completed | success | True | 0.0430286 |
| 37 | 1 | friction-derived | P-h-baseline-r2 | completed | success | True | 0.1876924 |
| 38 | 1 | friction-derived | P-h-fixed-r2 | completed | success | True | 0.2105577 |
| 39 | 1 | friction-derived | P-h-usability-r2 | completed | success | True | 0.1087036 |
| 40 | 1 | friction-derived | P-i-baseline-r2 | completed | success | True | 0.0880007 |
| 41 | 1 | friction-derived | P-i-fixed-r2 | completed | success | True | 0.048031899999999995 |
| 42 | 1 | friction-derived | P-i-usability-r2 | completed | success | True | 0.0822774 |
| 43 | 1 | pre-registered | P-d-baseline-r2 | completed | success | True | 0.1314758 |
| 44 | 1 | pre-registered | P-d-usability-r2 | completed | success | True | 0.16693829999999998 |
| 45 | 1 | pre-registered | P-d-fixed-r2 | completed | success | True | 0.09758280000000001 |
| 46 | 1 | friction-derived | P-j-usability-r2 | completed | success | True | 0.0717779 |
| 47 | 1 | friction-derived | P-j-baseline-r2 | completed | success | True | 0.127263 |
| 48 | 1 | friction-derived | P-j-fixed-r2 | completed | success | True | 0.0910816 |
| 49 | 1 | pre-registered | P-a-usability-r2 | completed | success | True | 0.1123758 |
| 50 | 1 | pre-registered | P-a-fixed-r2 | completed | success | True | 0.14047030000000002 |
| 51 | 1 | pre-registered | P-a-baseline-r2 | completed | success | True | 0.1330883 |
| 52 | 1 | pre-registered | P-f-usability-r2 | completed | success | True | 0.09502890000000001 |
| 53 | 1 | pre-registered | P-f-fixed-r2 | completed | success | True | 0.1210243 |
| 54 | 1 | pre-registered | P-f-baseline-r2 | completed | success | True | 0.0817353 |
| 55 | 1 | friction-derived | P-k-usability-r2 | completed | success | True | 0.0976708 |
| 56 | 1 | friction-derived | P-k-baseline-r2 | completed | success | True | 0.0939682 |
| 57 | 1 | friction-derived | P-k-fixed-r2 | completed | success | True | 0.0607758 |
| 58 | 1 | friction-derived | P-g-fixed-r2 | completed | success | True | 0.16296109999999997 |
| 59 | 1 | friction-derived | P-g-baseline-r2 | completed | success | True | 0.19528749999999997 |
| 60 | 1 | friction-derived | P-g-usability-r2 | completed | success | True | 0.1477338 |
| 61 | 1 | pre-registered | P-e-fixed-r2 | completed | success | True | 0.0919258 |
| 62 | 1 | pre-registered | P-e-usability-r2 | completed | success | True | 0.08539079999999999 |
| 63 | 1 | pre-registered | P-e-baseline-r2 | completed | success | True | 0.08707809999999999 |
| 64 | 1 | pre-registered | P-b-fixed-r2 | completed | success | True | 0.08963760000000001 |
| 65 | 1 | pre-registered | P-b-baseline-r2 | completed | success | True | 0.0729438 |
| 66 | 1 | pre-registered | P-b-usability-r2 | completed | success | True | 0.0832007 |
| 67 | 1 | pre-registered | P-c-usability-r2 | completed | success | True | 0.0771576 |
| 68 | 1 | pre-registered | P-c-fixed-r2 | completed | success | True | 0.09890780000000002 |
| 69 | 1 | pre-registered | P-c-baseline-r2 | completed | success | True | 0.092104 |
| 70 | 1 | friction-derived | P-l-fixed-r2 | completed | success | True | 0.13113589999999997 |
| 71 | 1 | friction-derived | P-l-usability-r2 | completed | success | True | 0.104172 |
| 72 | 1 | friction-derived | P-l-baseline-r2 | completed | success | True | 0.08563050000000001 |
| 73 | 1 | pre-registered | P-e-baseline-r3 | completed | success | True | 0.083661 |
| 74 | 1 | pre-registered | P-e-fixed-r3 | completed | success | True | 0.09679389999999999 |
| 75 | 1 | pre-registered | P-e-usability-r3 | completed | success | True | 0.07955519999999999 |
| 76 | 1 | friction-derived | P-l-usability-r3 | completed | success | True | 0.0703594 |
| 77 | 1 | friction-derived | P-l-fixed-r3 | completed | success | False | 0.0846551 |
| 78 | 1 | friction-derived | P-l-baseline-r3 | completed | success | True | 0.0965117 |
| 79 | 1 | friction-derived | P-g-fixed-r3 | completed | success | True | 0.1640448 |
| 80 | 1 | friction-derived | P-g-usability-r3 | completed | success | True | 0.1221397 |
| 81 | 1 | friction-derived | P-g-baseline-r3 | completed | success | True | 0.1757497 |
| 82 | 1 | pre-registered | P-d-usability-r3 | completed | success | True | 0.0784661 |
| 83 | 1 | pre-registered | P-d-fixed-r3 | completed | success | True | 0.1270303 |
| 84 | 1 | pre-registered | P-d-baseline-r3 | completed | success | True | 0.0428172 |
| 85 | 1 | pre-registered | P-f-baseline-r3 | completed | success | True | 0.12181589999999999 |
| 86 | 1 | pre-registered | P-f-usability-r3 | completed | success | True | 0.0999661 |
| 87 | 1 | pre-registered | P-f-fixed-r3 | completed | success | True | 0.0880336 |
| 88 | 1 | friction-derived | P-j-fixed-r3 | completed | success | True | 0.1232422 |
| 89 | 1 | friction-derived | P-j-usability-r3 | completed | success | True | 0.06021110000000001 |
| 90 | 1 | friction-derived | P-j-baseline-r3 | completed | success | True | 0.083032 |
| 91 | 1 | pre-registered | P-b-fixed-r3 | completed | success | True | 0.1134443 |
| 92 | 1 | pre-registered | P-b-baseline-r3 | completed | success | True | 0.0512779 |
| 93 | 1 | pre-registered | P-b-usability-r3 | completed | success | True | 0.108742 |
| 94 | 1 | pre-registered | P-a-baseline-r3 | completed | success | True | 0.1528379 |
| 95 | 1 | pre-registered | P-a-fixed-r3 | completed | success | True | 0.15317460000000002 |
| 96 | 1 | pre-registered | P-a-usability-r3 | completed | success | True | 0.128604 |
| 97 | 1 | friction-derived | P-k-baseline-r3 | completed | success | True | 0.09350350000000002 |
| 98 | 1 | friction-derived | P-k-fixed-r3 | completed | success | True | 0.0648695 |
| 99 | 1 | friction-derived | P-k-usability-r3 | completed | success | True | 0.10989879999999999 |
| 100 | 1 | pre-registered | P-c-usability-r3 | completed | success | True | 0.0850855 |
| 101 | 1 | pre-registered | P-c-fixed-r3 | completed | success | True | 0.09718729999999999 |
| 102 | 1 | pre-registered | P-c-baseline-r3 | completed | success | True | 0.091576 |
| 103 | 1 | friction-derived | P-i-usability-r3 | completed | success | True | 0.0832005 |
| 104 | 1 | friction-derived | P-i-baseline-r3 | completed | success | True | 0.0839122 |
| 105 | 1 | friction-derived | P-i-fixed-r3 | completed | success | True | 0.0491814 |
| 106 | 1 | friction-derived | P-h-baseline-r3 | completed | success | True | 0.2879336 |
| 107 | 1 | friction-derived | P-h-usability-r3 | completed | success | True | 0.1236763 |
| 108 | 1 | friction-derived | P-h-fixed-r3 | completed | success | True | 0.1816841 |

## Limitations

- Three repetitions per task and build show spread, not a distribution; no significance test is claimed. Differences inside the min-max ranges of another build are not evidence of a difference.
- One model (`claude-sonnet-5-5`), one client (Claude Agent SDK), one server mode (cli: a single `exec` tool). Other models, clients or tools mode may behave differently.
- The pre-registered tasks were written by the same team that wrote the fixes, and the same findings informed both: they exercise behaviours the bug-fix patches change. The result says how the builds do on these tasks, not how the server does on PostHog work in general.
- The friction-derived set was written after the usability changes were designed, from the jobs that motivated them; it favours the usability build by construction and must not be read as a fair comparison. It is reported apart from the pre-registered set and never pooled with it.
- Correctness is a mechanical end-state check with exact criteria; a run can be marked incorrect for a deviation a human would accept (and the reverse cannot be ruled out for criteria the checker does not have).
- Cost is the SDK's reported estimate and depends on prompt-cache state; the builds of one task run back to back in a balanced order so that cache and time effects do not fall on one build, but they are not eliminated.
- The backend is the target recorded in the manifest (for the self-hosted series a local PostHog open-source instance at the same pin); latency and server-side behaviour can drift during a series; the builds differ only in the local MCP server bundle.
- The local build differs from PostHog's hosted MCP in its surroundings: Node 25 instead of the pinned Node 26, no edge worker, a local Redis, analytics off, UI apps not built.
- The friction lists in each run are the agent's own opinion; they are leads and are not used in any number above.
- Fixtures are reset by repair (not by a fresh project); the state hash covers the benchmark's own objects only, not the rest of the project.
