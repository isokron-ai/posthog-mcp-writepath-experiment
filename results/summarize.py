"""Recompute the headline tables of results/BENCHMARK.md from a runs.csv (standard library only).

    python3 results/summarize.py results/2026-11-11-three-builds/runs.csv

For each task set, per build: correct runs, and the per-round sums (one round = one run of every task of the set),
reported as the median over the rounds with [min-max]; then per task and build, the per-run median [min-max].
The task sets are never added together.
"""
import csv, statistics, sys
from collections import defaultdict

METRICS = [("tool_calls", "Tool calls (all)"), ("posthog_calls", "PostHog MCP calls"), ("turns", "Turns"), ("failed_tool_calls", "Failed tool calls"),
           ("tool_result_bytes", "Tool-result bytes"), ("cost_usd", "Reported cost, USD")]


def fmt(v, metric):
    if metric == "cost_usd":
        return "%.2f" % v
    return "%g" % v


def mmm(vals, metric):
    return "%s [%s–%s]" % (fmt(statistics.median(vals), metric), fmt(min(vals), metric), fmt(max(vals), metric))


rows = list(csv.DictReader(open(sys.argv[1])))
builds = [b for b in ("baseline", "fixed", "usability") if any(r["build"] == b for r in rows)]
for task_set in sorted({r["task_set"] for r in rows}, key=lambda s: s != "pre-registered"):
    rs = [r for r in rows if r["task_set"] == task_set]
    print("\n## Task set: %s (%d runs)\n" % (task_set, len(rs)))
    print("| Per round of all %d tasks (median of %d rounds, [min–max]) | %s |" % (
        len({r["task"] for r in rs}), len({r["repetition"] for r in rs}), " | ".join(builds)))
    print("|---|" + "---|" * len(builds))
    for metric, label in METRICS:
        cells = []
        for b in builds:
            per_round = defaultdict(float)
            for r in rs:
                if r["build"] == b:
                    per_round[r["repetition"]] += float(r[metric])
            cells.append(mmm(list(per_round.values()), metric))
        print("| %s | %s |" % (label, " | ".join(cells)))
    cells = []
    for b in builds:
        rb = [r for r in rs if r["build"] == b]
        cells.append("%d of %d" % (sum(r["correct"] == "True" for r in rb), len(rb)))
    print("| Runs passing their end-state checks | %s |" % " | ".join(cells))
    print("\n| Task | Build | Correct | Tool calls | Turns | Failed calls | Result bytes |")
    print("|---|---|---|---|---|---|---|")
    for task in sorted({r["task"] for r in rs}):
        for b in builds:
            rb = [r for r in rs if r["task"] == task and r["build"] == b]
            print("| %s | %s | %d/%d | %s | %s | %s | %s |" % (
                task, b, sum(r["correct"] == "True" for r in rb), len(rb),
                mmm([float(r["tool_calls"]) for r in rb], "tool_calls"), mmm([float(r["turns"]) for r in rb], "turns"),
                mmm([float(r["failed_tool_calls"]) for r in rb], "failed_tool_calls"),
                mmm([float(r["tool_result_bytes"]) for r in rb], "tool_result_bytes")))
