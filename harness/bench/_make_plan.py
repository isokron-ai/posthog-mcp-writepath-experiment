"""Builds bench/BENCH-PLAN.json: 6 tasks x 2 builds x 3 repetitions = 36 runs, interleaved by build.
Order: inside each repetition the six tasks are shuffled; each task runs on both builds back to back, and which build goes
first is randomised but balanced (9 of the 18 pairs start with baseline). Time drift therefore does not land on one build.
  python3 -I -B bench/_make_plan.py [--seed N]     (the seed is recorded in the plan; default: a fresh random seed)

A named series (series/<NAME>/SERIES.json: builds, task sets, repetitions, model) gets its own plan and a dry-run plan:
  python3 -I -B bench/_make_plan.py --series NAME [--seed N]
    -> series/<NAME>/BENCH-PLAN.json      every task of every set x every build x the repetitions. Inside each repetition the
                                          tasks of both sets are shuffled together; each task runs on all builds back to back;
                                          the build order of each such block is one of the build permutations, and every
                                          permutation is used equally often (so each build is first, second, ... equally often).
    -> series/<NAME>/DRY-RUN-PLAN.json    the same design for ONE repetition (own seed, recorded): every task once on every
                                          build; NOT MEASURED (run tags d001.., repetition 0), for bench/run-bench.sh --dry-run-plan.
The plain form above (no --series) is the 2026-11-10 two-build plan and is unchanged."""
import argparse, itertools, json, os, random, secrets
HERE = os.path.dirname(os.path.abspath(__file__)); ROOT = os.path.dirname(HERE)
TASKS = [("a", "a-dashboard-three-insights", 60), ("b", "b-insight-rename", 40), ("c", "c-flag-rollout-change", 40),
         ("d", "d-flag-inventory", 40), ("e", "e-annotate-deploy", 40), ("f", "f-tag-triage", 60)]
BUILDS = ("baseline", "fixed"); REPS = 3; MODEL = "claude-sonnet-5-5"


def make(seed):
    rng = random.Random(seed)
    first = ["baseline"] * (len(TASKS) * REPS // 2) + ["fixed"] * (len(TASKS) * REPS - len(TASKS) * REPS // 2)
    rng.shuffle(first)
    runs, k = [], 0
    for rep in range(1, REPS + 1):
        order = TASKS[:]; rng.shuffle(order)
        for letter, tid, turns in order:
            b1 = first[k]; k += 1
            for build in (b1, "fixed" if b1 == "baseline" else "baseline"):
                runs.append({"run_seq": len(runs) + 1, "run_id": "P-%s-%s-r%d" % (letter, build, rep), "task": tid, "build": build,
                             "repetition": rep, "model": MODEL, "max_turns": turns, "run_tag": "r%03d" % (len(runs) + 1)})
    return {"audit_id": "posthog-mcp-bench", "planned_runs": len(runs), "order_seed": seed, "model": MODEL,
            "design": "6 tasks x 2 builds x 3 repetitions; per repetition the tasks are shuffled, each task runs on both builds back to back, first build randomised and balanced; one run at a time",
            "max_turns_rule": "40 for single-object tasks (b, c, d, e), 60 for multi-object tasks (a, f), as in the Grafana plan (40 / 60)",
            "runs": runs}


def task_sets():
    return json.load(open(os.path.join(HERE, "TASKSETS.json")))


def series_config(name):
    p = os.path.join(ROOT, "series", name, "SERIES.json")
    if not os.path.exists(p):
        raise SystemExit("series/%s/SERIES.json not found" % name)
    return json.load(open(p))


def make_series(cfg, seed, dry=False):
    """Plan for a named series. dry=True: one repetition, dry-run run ids/tags, repetition 0."""
    rng = random.Random(seed)
    reg = task_sets()["sets"]
    tasks = [(t["letter"], t["id"], t["max_turns"], s) for s in cfg["task_sets"] for t in reg[s]["tasks"]]
    builds = list(cfg["builds"]); reps = 1 if dry else int(cfg["repetitions"])
    perms = list(itertools.permutations(builds))
    blocks = len(tasks) * reps
    if blocks % len(perms):
        raise SystemExit("%d task blocks cannot use the %d build orders equally often" % (blocks, len(perms)))
    orders = perms * (blocks // len(perms)); rng.shuffle(orders)
    runs, k = [], 0
    for rep in range(1, reps + 1):
        order = tasks[:]; rng.shuffle(order)
        for letter, tid, turns, tset in order:
            for build in orders[k]:
                n = len(runs) + 1
                runs.append({"run_seq": n, "run_id": ("DRY-%s-%s" % (letter, build)) if dry else ("P-%s-%s-r%d" % (letter, build, rep)),
                             "task": tid, "task_set": tset, "build": build, "repetition": 0 if dry else rep, "model": cfg["model"],
                             "max_turns": turns, "run_tag": ("d%03d" if dry else "r%03d") % n, "block": k + 1})
            k += 1
    first = {b: sum(1 for i in range(0, len(runs), len(builds)) if runs[i]["build"] == b) for b in builds}
    return {"audit_id": cfg.get("audit_id", "posthog-mcp-bench"), "series": cfg["series"], "kind": "dry-run plan (NOT MEASURED)" if dry else "measured plan",
            "planned_runs": len(runs), "order_seed": seed, "model": cfg["model"], "builds": builds, "task_sets": cfg["task_sets"], "repetitions": reps,
            "design": "%d tasks (%s) x %d builds x %d repetition(s); per repetition the tasks of both sets are shuffled together, each task runs on all builds back to back, the build order of each block is one of the %d permutations and each permutation is used %d times; one run at a time" % (
                len(tasks), " + ".join("%d %s" % (len(reg[s]["tasks"]), s) for s in cfg["task_sets"]), len(builds), reps, len(perms), blocks // len(perms)),
            "first_build_counts": first, "max_turns_rule": task_sets()["max_turns_rule"], "runs": runs}


def write_series(name, seed=None):
    cfg = series_config(name); d = os.path.join(ROOT, "series", name)
    seed = seed if seed is not None else secrets.randbelow(2 ** 31)
    dry_seed = random.Random(seed).randrange(2 ** 31)
    for fname, plan in (("BENCH-PLAN.json", make_series(cfg, seed)), ("DRY-RUN-PLAN.json", make_series(cfg, dry_seed, dry=True))):
        with open(os.path.join(d, fname), "w") as f:
            json.dump(plan, f, indent=2); f.write("\n")
        print("series=%s %s planned_runs=%d seed=%d first_build_counts=%s" % (name, fname, plan["planned_runs"], plan["order_seed"], plan["first_build_counts"]))
    return seed


if __name__ == "__main__":
    ap = argparse.ArgumentParser(); ap.add_argument("--seed", type=int); ap.add_argument("--series")
    a = ap.parse_args()
    if a.series:
        write_series(a.series, a.seed); raise SystemExit(0)
    out = os.path.join(HERE, "BENCH-PLAN.json")
    seed = a.seed if a.seed is not None else secrets.randbelow(2 ** 31)
    plan = make(seed)
    with open(out, "w") as f:
        json.dump(plan, f, indent=2); f.write("\n")
    print("planned_runs=%d seed=%d baseline_first_pairs=%d" % (plan["planned_runs"], seed, sum(1 for i in range(0, 36, 2) if plan["runs"][i]["build"] == "baseline")))
    print(" ".join("%d:%s" % (r["run_seq"], r["run_id"]) for r in plan["runs"]))
