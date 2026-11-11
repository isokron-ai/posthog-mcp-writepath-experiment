"""Recompute the tables of results/BENCHMARK.md from a runs.csv (standard library only).

    python3 results/summarize.py results/2026-11-11-three-builds/runs.csv

For each task set, separately (the sets are never added together):
  1. totals over all runs of each build (18 per build and set in the measured series), with the change from the
     unmodified build's total in percent, to one decimal: the headline basis;
  2. per round (one run of every task of the set), the median over the rounds with [min-max]: secondary detail;
  3. per task and build, the per-run median with [min-max].
Builds are named as in the write-up: baseline = unmodified (tag upstream-7b516983), fixed = bug-fix build (tag
fixed-r3), usability = research build (tag usability-r3).
"""
import csv, statistics, sys
from collections import defaultdict

NAMES = {"baseline": "Unmodified", "fixed": "Bug-fix build", "usability": "Research build"}
METRICS = [("tool_calls", "Tool calls"), ("posthog_calls", "PostHog MCP calls"), ("turns", "Model turns"),
           ("tool_result_bytes", "Tool-result bytes"), ("failed_tool_calls", "Failed tool calls"),
           ("cost_usd", "Cost, USD (SDK estimate)")]
NO_PERCENT = {"failed_tool_calls"}


def fmt(v, metric):
    if metric == "cost_usd":
        return "%.2f" % v
    if float(v).is_integer():
        return "{:,}".format(int(v))
    return "{:,}".format(v)


def mmm(vals, metric):
    return "%s [%s–%s]" % (fmt(statistics.median(vals), metric), fmt(min(vals), metric), fmt(max(vals), metric))


def pct(v, base):
    return ("%+.1f%%" % ((v - base) / base * 100)).replace("-", "\u2212") if base else "n/a"


rows = list(csv.DictReader(open(sys.argv[1])))
builds = [b for b in ("baseline", "fixed", "usability") if any(r["build"] == b for r in rows)]
head = " | ".join(NAMES[b] for b in builds)
for task_set in sorted({r["task_set"] for r in rows}, key=lambda s: s != "pre-registered"):
    rs = [r for r in rows if r["task_set"] == task_set]
    per_build = {b: [r for r in rs if r["build"] == b] for b in builds}
    print("\n## Task set: %s (%d runs)\n" % (task_set, len(rs)))
    print("| Totals over %s runs per build | %s |" % ("/".join(sorted({str(len(v)) for v in per_build.values()})), head))
    print("|---|" + "---|" * len(builds))
    print("| Runs correct | %s |" % " | ".join("%d of %d" % (sum(r["correct"] == "True" for r in per_build[b]), len(per_build[b])) for b in builds))
    for metric, label in METRICS:
        tot = {b: sum(float(r[metric]) for r in per_build[b]) for b in builds}
        cells = [fmt(tot[b], metric) + ("" if b == "baseline" or metric in NO_PERCENT else " (%s)" % pct(tot[b], tot["baseline"])) for b in builds]
        print("| %s, total | %s |" % (label, " | ".join(cells)))
    print("\nSecondary detail: per round of all %d tasks, median of %d rounds [min–max].\n" % (
        len({r["task"] for r in rs}), len({r["repetition"] for r in rs})))
    print("| Per round | %s |" % head)
    print("|---|" + "---|" * len(builds))
    for metric, label in METRICS:
        cells = []
        for b in builds:
            per_round = defaultdict(float)
            for r in per_build[b]:
                per_round[r["repetition"]] += float(r[metric])
            cells.append(mmm(list(per_round.values()), metric))
        print("| %s | %s |" % (label, " | ".join(cells)))
    print("\nPer task: per-run median [min–max] over 3 runs.\n")
    print("| Task | Build | Correct | Tool calls | Model turns | Failed calls | Tool-result bytes |")
    print("|---|---|---|---|---|---|---|")
    for task in sorted({r["task"] for r in rs}):
        for b in builds:
            rb = [r for r in per_build[b] if r["task"] == task]
            print("| %s | %s | %d/%d | %s | %s | %s | %s |" % (
                task, NAMES[b], sum(r["correct"] == "True" for r in rb), len(rb),
                mmm([float(r["tool_calls"]) for r in rb], "tool_calls"), mmm([float(r["turns"]) for r in rb], "turns"),
                mmm([float(r["failed_tool_calls"]) for r in rb], "failed_tool_calls"),
                mmm([float(r["tool_result_bytes"]) for r in rb], "tool_result_bytes")))
