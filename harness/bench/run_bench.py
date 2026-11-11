"""Benchmark driver. Start it through bench/run-bench.sh (which exports the Anthropic key by path); do not call it directly.

  bench/run-bench.sh                     the measured series: every planned run not yet finished, in plan order (needs a freeze)
  bench/run-bench.sh --dry-run N         N tasks once, baseline only, own throwaway nonce, NOT MEASURED, cleaned up afterwards
  bench/run-bench.sh --only 3,4          measured: only these plan run numbers
  bench/run-bench.sh --simulate-costs 9.5,9.5,9.5,9.5,9.5   no agent, no network: exercises lock, log and budget stop only

A named series (series/<NAME>/: SERIES.json, plans, its own freeze) is run with --series NAME:
  bench/run-bench.sh --series NAME --dry-run-plan [--limit N]   the recorded dry-run plan (one repetition, every task on every
                                                                build), own throwaway nonce, NOT MEASURED, cleaned up afterwards
  bench/run-bench.sh --series NAME                              the measured series (needs that series' freeze; resumable)
Its budget is SERIES.json's budget_usd unless BENCH_BUDGET_USD is set; its chain record goes to its own kronicle-lite audit.

One run = guard -> reset fixtures (state hash must match) -> fresh Redis state, fresh server process for the build, fresh
proxy with a new capture file -> agent -> stop server -> checker -> reset fixtures (hash must match) -> log lines.
Design decisions that remove the Grafana rounds' failure modes:
  * the Anthropic key must be in the environment before anything starts, and the agent aborts unless the SDK reports
    apiKeySource == ANTHROPIC_API_KEY (round 1 of the Grafana benchmark ran without the key);
  * a mkdir lock: a second session is refused (two sessions once overwrote each other);
  * every run and every attempt gets its own new directory; an existing directory or capture file is an error;
  * the runs log is append-only: a line when a run starts and a line when it ends, failures and dry runs included;
  * spending ceiling: the driver adds up reported cost after every run and stops above BENCH_BUDGET_USD."""
import argparse, hashlib, json, os, secrets, signal, subprocess, sys, time, urllib.request
sys.dont_write_bytecode = True
HERE = os.path.dirname(os.path.abspath(__file__)); ROOT = os.path.dirname(HERE)
sys.path.insert(0, os.path.join(ROOT, "lib"))
import ph as P
import lock as LOCK

PY = [sys.executable, "-I", "-B"]
now = lambda: time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())
sha_file = lambda p: hashlib.sha256(open(p, "rb").read()).hexdigest() if os.path.exists(p) else None


def append_line(path, obj):
    """Append-only: O_APPEND, one JSON object per line, fsync. Nothing in the harness rewrites or truncates these files."""
    os.makedirs(os.path.dirname(path), exist_ok=True)
    fd = os.open(path, os.O_WRONLY | os.O_APPEND | os.O_CREAT, 0o644)
    try:
        os.write(fd, (json.dumps(obj, sort_keys=True) + "\n").encode()); os.fsync(fd)
    finally:
        os.close(fd)


def read_lines(path):
    return [json.loads(l) for l in open(path)] if os.path.exists(path) else []


def spent(lines):
    return round(sum((l.get("cost_usd") or 0) for l in lines if l.get("event") == "run_finished"), 6)


def over_budget(lines, budget):
    return spent(lines) > budget


def wait_http(url, seconds):
    end = time.time() + seconds
    while time.time() < end:
        try:
            with urllib.request.urlopen(url, timeout=2) as r:
                if r.status == 200: return True
        except Exception:
            time.sleep(0.5)
    return False


def stop(proc):
    if proc and proc.poll() is None:
        proc.send_signal(signal.SIGTERM)
        try: proc.wait(timeout=15)
        except subprocess.TimeoutExpired: proc.kill()


def sh(cmd, logpath, timeout, env=None):
    """Run a harness subprocess; its output goes, redacted, to logpath. Returns the exit code (124 on timeout)."""
    try:
        p = subprocess.run(cmd, capture_output=True, text=True, timeout=timeout, cwd=ROOT, env=env)
        rc, out = p.returncode, (p.stdout or "") + (p.stderr or "")
    except subprocess.TimeoutExpired as e:
        rc, out = 124, "TIMEOUT after %ss\n%s" % (timeout, (e.stdout or b"").decode("utf-8", "replace") if isinstance(e.stdout, bytes) else (e.stdout or ""))
    with open(logpath, "a") as f:
        f.write(P.redact(out, (os.environ.get("ANTHROPIC_API_KEY", ""),)))
    return rc


def run_one(entry, n12, cfg, series_dir, attempt, measured, log_paths, extra):
    """Returns the run_finished record (already appended to the logs)."""
    name = "run-%03d-%s-%s-rep%d-a%d" % (entry["run_seq"], entry["task"], entry["build"], entry["repetition"], attempt)
    out = os.path.join(series_dir, name)
    os.makedirs(out, exist_ok=False)  # never reuse a run directory
    letter = entry["task"].split("-")[0]
    base = {"run_seq": entry["run_seq"], "attempt": attempt, "run_id": entry["run_id"], "task": entry["task"], "build": entry["build"],
            "repetition": entry["repetition"], "run_tag": entry["run_tag"], "model": entry["model"], "max_turns": entry["max_turns"],
            "measured": measured, "nonce_n12": n12, "dir": os.path.relpath(out, ROOT), **extra}
    for lp in log_paths: append_line(lp, {"event": "run_started", "at": now(), **base})
    if entry.get("task_set"): base["task_set"] = entry["task_set"]
    rec = {"event": "run_finished", **base, "status": None, "cost_usd": None, "correct": None}
    server = proxy = None
    t0 = time.time()
    try:
        if sh(PY + ["seed/seed.py", "--nonce", n12, "--reset", "--request-log", os.path.join(out, "seed-requests.log")], os.path.join(out, "seed-before.txt"), 600) != 0:
            rec["status"] = "reset_before_failed"; return rec
        subprocess.run([os.path.join(ROOT, "server", "redis.sh"), "flush"], capture_output=True, cwd=ROOT)
        server = subprocess.Popen([os.path.join(ROOT, "server", "start-server.sh"), entry["build"]], stdout=open(os.path.join(out, "server.log"), "w"), stderr=subprocess.STDOUT, cwd=ROOT)
        if not wait_http("http://127.0.0.1:%s/readyz" % cfg["MCP_SERVER_PORT"], 90):
            rec["status"] = "server_failed"; return rec
        pcmd = ["node", "server/mcp-proxy.mjs", "--listen", cfg["MCP_PROXY_PORT"], "--upstream", "http://127.0.0.1:%s" % cfg["MCP_SERVER_PORT"],
                "--key-file", cfg["POSTHOG_KEY_FILE"], "--project-id", cfg["POSTHOG_PROJECT_ID"], "--mode", cfg["MCP_MODE"], "--capture", os.path.join(out, "mcp-capture.jsonl")] + (["--target", cfg["TARGET"]] if cfg.get("TARGET") else [])
        if cfg.get("MCP_FEATURES"): pcmd += ["--features", cfg["MCP_FEATURES"]]
        proxy = subprocess.Popen(pcmd, stdout=open(os.path.join(out, "proxy.log"), "w"), stderr=subprocess.STDOUT, cwd=ROOT)
        if not wait_http("http://127.0.0.1:%s/healthz" % cfg["MCP_PROXY_PORT"], 20):
            rec["status"] = "proxy_failed"; return rec
        agent_rc = sh(["node", "bench/bench-agent.mjs", "--task", entry["task"], "--build", entry["build"], "--model", entry["model"], "--nonce", n12,
                       "--run-tag", entry["run_tag"], "--out", out, "--mcp-url", "http://127.0.0.1:%s/mcp" % cfg["MCP_PROXY_PORT"],
                       "--max-turns", str(entry["max_turns"]), "--max-usd", cfg.get("BENCH_RUN_BUDGET_USD", "4")],
                      os.path.join(out, "agent.log"), int(cfg.get("BENCH_RUN_TIMEOUT_SECONDS", "1500")), env=dict(os.environ))
        rec["agent_rc"] = agent_rc
        stop(proxy); stop(server); proxy = server = None
        m = json.load(open(os.path.join(out, "metrics.json"))) if os.path.exists(os.path.join(out, "metrics.json")) else None
        if m:
            rec.update(cost_usd=m["cost_usd"], turns=m["turns"], wall_seconds=m["wall_seconds"], subtype=m["subtype"], tokens=m["tokens"], counts=m["counts"],
                       api_key_source=m.get("api_key_source"))
        if m and m.get("api_error_status") in (401, 403):
            rec["fatal"] = True  # the Anthropic key was rejected: every further run would fail the same way
        if agent_rc == 3:
            rec["status"] = "billing_guard_abort"; rec["fatal"] = True  # not on the API key: stop the whole series
        elif agent_rc == 2 and not m:
            rec["status"] = "agent_refused"; rec["fatal"] = True
        elif not m:
            rec["status"] = "agent_crashed"
        chk = sh(PY + ["bench/checkers/check_%s.py" % letter, "--nonce", n12, "--run-tag", entry["run_tag"], "--run-dir", out], os.path.join(out, "checker.log"), 300)
        cj = json.load(open(os.path.join(out, "checker.json"))) if os.path.exists(os.path.join(out, "checker.json")) else None
        rec["correct"] = cj["correct"] if cj else None
        rec["failed_criteria"] = sorted(k for k, v in cj["criteria"].items() if v is not True) if cj else None
        if rec["status"] is None:
            # "completed" = the pipeline ran end to end (the task may still be incorrect, or the agent may have hit max turns:
            # see subtype and correct). Anything else is a failed attempt and is reported as such.
            rec["status"] = ("completed" if (agent_rc == 0 and cj and chk == 0) else "checker_failed" if agent_rc == 0 else "agent_error")
        if sh(PY + ["seed/seed.py", "--nonce", n12, "--reset", "--request-log", os.path.join(out, "seed-requests.log")], os.path.join(out, "seed-after.txt"), 600) != 0:
            rec["reset_after_failed"] = True; rec["fatal"] = True  # fixture state unknown: stop rather than measure on a dirty state
        return rec
    finally:
        stop(proxy); stop(server)
        rec["ended_at"] = now(); rec["wall_seconds_total"] = round(time.time() - t0)
        rec["files_sha256"] = {f: sha_file(os.path.join(out, f)) for f in ("metrics.json", "checker.json", "answer.md", "transcript.redacted.jsonl", "mcp-capture.jsonl", "final-state.json", "prompt.md")}
        with open(os.path.join(out, "run-record.json"), "x") as f:
            json.dump(rec, f, indent=2, sort_keys=True); f.write("\n")
        for lp in log_paths: append_line(lp, rec)


def check_build(build):
    bj = os.path.join(ROOT, "build", "out", build, "BUILD.json")
    if not os.path.exists(bj): raise SystemExit("build %s is missing: run build/build.sh %s" % (build, build))
    j = json.load(open(bj))
    if sha_file(os.path.join(ROOT, "build", "out", build, j["entry"])) != j["entry_sha256"]:
        raise SystemExit("build %s: bundle hash does not match BUILD.json" % build)
    return j["entry_sha256"]


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--dry-run", type=int, metavar="N"); ap.add_argument("--only"); ap.add_argument("--simulate-costs")
    ap.add_argument("--budget", type=float); ap.add_argument("--lock-dir", help=argparse.SUPPRESS); ap.add_argument("--sim-dir", help=argparse.SUPPRESS)
    ap.add_argument("--series", metavar="NAME"); ap.add_argument("--dry-run-plan", action="store_true"); ap.add_argument("--limit", type=int)
    a = ap.parse_args()
    cfg = P.load_config()
    scfg = sdir = None
    if a.series:
        sdir = os.path.join(ROOT, "series", a.series)
        if not os.path.exists(os.path.join(sdir, "SERIES.json")): raise SystemExit("series/%s/SERIES.json not found" % a.series)
        scfg = json.load(open(os.path.join(sdir, "SERIES.json")))
        if scfg.get("target") and cfg["TARGET"] != scfg["target"]: raise SystemExit("series %s is for TARGET=%s" % (a.series, scfg["target"]))
        os.environ.update(PA_KL_AUDIT_ID=scfg["audit_id"], PA_KL_STATE=os.path.join(sdir, "kl-state"), PA_KL_EVIDENCE=os.path.join(sdir, "evidence", "chain-runs"))
    elif a.dry_run_plan:
        raise SystemExit("--dry-run-plan needs --series NAME")
    budget = a.budget if a.budget is not None else float(os.environ.get("BENCH_BUDGET_USD") or (scfg or {}).get("budget_usd") or cfg.get("BENCH_BUDGET_USD", 40))
    if scfg and scfg.get("run_budget_usd") and not os.environ.get("BENCH_RUN_BUDGET_USD"): cfg["BENCH_RUN_BUDGET_USD"] = str(scfg["run_budget_usd"])
    fixtures = ["--fixtures", scfg["fixtures"]] if scfg and scfg.get("fixtures") else []
    ALL = os.path.join(ROOT, "runs", "RUNS-ALL.jsonl")
    lock_dir = LOCK.acquire("run_bench %s" % " ".join(sys.argv[1:]), a.lock_dir or LOCK.LOCK)
    try:
        if a.simulate_costs is not None:  # no agent, no network, nothing measured: exercises the log + budget stop logic
            d = a.sim_dir or os.path.join(ROOT, "runs", "simulated-%s" % time.strftime("%Y%m%dT%H%M%SZ", time.gmtime())); log = os.path.join(d, "RUNS.jsonl")
            for i, c in enumerate(float(x) for x in a.simulate_costs.split(",")):
                if over_budget(read_lines(log), budget):
                    append_line(log, {"event": "budget_stop", "at": now(), "spent_usd": spent(read_lines(log)), "budget_usd": budget, "simulated": True})
                    print("BUDGET STOP: spent %.2f > %.2f USD after %d simulated runs" % (spent(read_lines(log)), budget, i)); return 5
                append_line(log, {"event": "run_started", "run_seq": i + 1, "simulated": True, "measured": False})
                append_line(log, {"event": "run_finished", "run_seq": i + 1, "cost_usd": c, "status": "simulated", "simulated": True, "measured": False})
            if over_budget(read_lines(log), budget):
                append_line(log, {"event": "budget_stop", "at": now(), "spent_usd": spent(read_lines(log)), "budget_usd": budget, "simulated": True})
                print("BUDGET STOP: spent %.2f > %.2f USD" % (spent(read_lines(log)), budget)); return 5
            print("simulated %d runs, spent %.2f of %.2f USD" % (len(a.simulate_costs.split(",")), spent(read_lines(log)), budget)); return 0

        if not os.environ.get("ANTHROPIC_API_KEY"):
            raise SystemExit("ANTHROPIC_API_KEY is not in the environment: start through bench/run-bench.sh (refusing to run on the plan)")
        os.environ.pop("CLAUDE_CODE_OAUTH_TOKEN", None)
        ph = P.PostHog(); info = ph.guard()
        plan = json.load(open(os.path.join(sdir, "BENCH-PLAN.json") if sdir else os.path.join(HERE, "BENCH-PLAN.json")))
        if subprocess.run([os.path.join(ROOT, "server", "redis.sh"), "up"], cwd=ROOT).returncode != 0: raise SystemExit("redis not available")

        if a.dry_run_plan:
            dplan = json.load(open(os.path.join(sdir, "DRY-RUN-PLAN.json")))
            dfz = os.path.join(sdir, "state", "freeze.json"); dextra = {}
            if os.path.exists(dfz):  # a dry run under a freeze checks that nothing changed since, like a measured session
                if subprocess.run(PY + ["bench/_make_manifest.py", "--verify", "--series", a.series], cwd=ROOT).returncode != 0:
                    raise SystemExit("the harness or a build changed after the freeze of series %s: refusing" % a.series)
                dextra = {"manifest_sha256": json.load(open(dfz))["manifest_sha256"]}
            else:
                print("note: series %s is not frozen yet; this dry run is not tied to a manifest" % a.series)
            runs = dplan["runs"][:a.limit] if a.limit else dplan["runs"]
            n12 = "000000" + secrets.token_hex(3); stamp = time.strftime("%Y%m%dT%H%M%SZ", time.gmtime())
            series_dir = os.path.join(ROOT, "dryruns", "dry-%s-%s" % (stamp, n12)); os.makedirs(series_dir, exist_ok=False)
            log = os.path.join(series_dir, "RUNS.jsonl"); hashes = {b: check_build(b) for b in sorted({r["build"] for r in runs})}
            print("DRY RUN PLAN - NOT MEASURED - series %s - nonce %s - %d of %d runs (%s) - results in %s" % (a.series, n12, len(runs), dplan["planned_runs"], ", ".join(sorted(hashes)), os.path.relpath(series_dir, ROOT)))
            print("seeding the dry-run fixtures first (fixture set %s, at 2 requests/second); they are deleted again at the end" % scfg.get("fixtures", "v1"), flush=True)
            if sh(PY + ["seed/seed.py", "--nonce", n12, "--init"] + fixtures, os.path.join(series_dir, "seed-init.txt"), 1200) != 0:
                raise SystemExit("dry-run seed failed: see %s/seed-init.txt" % os.path.relpath(series_dir, ROOT))
            try:
                for e in runs:
                    if over_budget(read_lines(log), budget):
                        append_line(log, {"event": "budget_stop", "at": now(), "spent_usd": spent(read_lines(log)), "budget_usd": budget, "before_run_seq": e["run_seq"]})
                        print("BUDGET STOP"); break
                    rec = run_one(e, n12, cfg, series_dir, 1, False, [log, ALL], dict({"label": "DRY RUN PLAN - NOT MEASURED", "series": a.series, "build_entry_sha256": hashes[e["build"]]}, **dextra))
                    print("dry %d/%d %s %s: status=%s correct=%s cost=%s turns=%s total=%.2f" % (e["run_seq"], len(runs), e["task"], e["build"], rec["status"], rec["correct"], rec["cost_usd"], rec.get("turns"), spent(read_lines(log))), flush=True)
                    if rec.get("fatal"): print("fatal condition: stopping"); break
            finally:
                rc = sh(PY + ["bench/cleanup.py", "--nonce", n12], os.path.join(series_dir, "cleanup.txt"), 900)
                print("dry-run cleanup rc=%d (see %s/cleanup.txt); dry-run spend %.4f USD" % (rc, os.path.relpath(series_dir, ROOT), spent(read_lines(log))))
            return 0

        if a.dry_run is not None:
            n12 = "000000" + secrets.token_hex(3); stamp = time.strftime("%Y%m%dT%H%M%SZ", time.gmtime())
            series_dir = os.path.join(ROOT, "dryruns", "dry-%s-%s" % (stamp, n12)); os.makedirs(series_dir, exist_ok=False)
            log = os.path.join(series_dir, "RUNS.jsonl"); entry_hash = check_build("baseline")
            print("DRY RUN - NOT MEASURED - nonce %s - %d task(s), baseline only - results in %s" % (n12, a.dry_run, os.path.relpath(series_dir, ROOT)))
            print("seeding the dry-run fixtures first (about 95 s at 2 requests/second); they are deleted again at the end", flush=True)
            seen, tasks = set(), []
            for r in sorted(plan["runs"], key=lambda r: r["task"]):
                if r["task"] not in seen: seen.add(r["task"]); tasks.append(r)
            if sh(PY + ["seed/seed.py", "--nonce", n12, "--init"] + fixtures, os.path.join(series_dir, "seed-init.txt"), 1200) != 0:
                raise SystemExit("dry-run seed failed: see %s/seed-init.txt" % os.path.relpath(series_dir, ROOT))
            try:
                for i, r in enumerate(tasks[:a.dry_run], 1):
                    if over_budget(read_lines(log), budget):
                        print("BUDGET STOP"); break
                    e = dict(r, build="baseline", run_seq=i, run_tag="d%03d" % i, run_id="DRY-%s" % r["task"].split("-")[0], repetition=0)
                    rec = run_one(e, n12, cfg, series_dir, 1, False, [log, ALL], {"label": "DRY RUN - NOT MEASURED", "build_entry_sha256": entry_hash})
                    print("dry %d/%d %s: status=%s correct=%s cost=%s turns=%s" % (i, a.dry_run, r["task"], rec["status"], rec["correct"], rec["cost_usd"], rec.get("turns")))
                    if rec.get("fatal"): print("fatal condition: stopping"); break
            finally:
                rc = sh(PY + ["bench/cleanup.py", "--nonce", n12], os.path.join(series_dir, "cleanup.txt"), 900)
                print("dry-run cleanup rc=%d (see %s/cleanup.txt); dry-run spend %.4f USD" % (rc, os.path.relpath(series_dir, ROOT), spent(read_lines(log))))
            return 0

        # ---- measured series ----
        fz_path = os.path.join(sdir, "state", "freeze.json") if sdir else os.path.join(ROOT, "state", "freeze.json")
        if not os.path.exists(fz_path): raise SystemExit("not frozen: run bench/freeze.py%s first (measured runs only happen after the freeze)" % (" --series " + a.series if a.series else ""))
        fz = json.load(open(fz_path)); n12 = fz["n12"]
        if subprocess.run(PY + ["bench/_make_manifest.py", "--verify"] + (["--series", a.series] if a.series else []), cwd=ROOT).returncode != 0:
            raise SystemExit("the harness or a build changed after the freeze: refusing to measure")
        hashes = {b: check_build(b) for b in sorted({r["build"] for r in plan["runs"]})}
        if not os.path.exists(os.path.join(ROOT, "state", "seed-%s.json" % n12)):
            raise SystemExit("fixtures for series %s are not seeded: python3 -I -B seed/seed.py --nonce %s --init %s" % (n12, n12, " ".join(fixtures)))
        series_dir = os.path.join(ROOT, "runs", "series-%s" % n12); log = os.path.join(series_dir, "RUNS.jsonl")
        only = {int(x) for x in a.only.split(",")} if a.only else None
        for entry in plan["runs"]:
            lines = read_lines(log)
            mine = [l for l in lines if l.get("run_seq") == entry["run_seq"]]
            if any(l["event"] == "run_finished" for l in mine): continue          # finished (whatever the outcome): never re-run silently
            if only and entry["run_seq"] not in only: continue
            if over_budget(lines, budget):
                append_line(log, {"event": "budget_stop", "at": now(), "spent_usd": spent(lines), "budget_usd": budget, "before_run_seq": entry["run_seq"]})
                print("BUDGET STOP before run %d: spent %.2f > %.2f USD" % (entry["run_seq"], spent(lines), budget)); return 5
            attempt = 1 + sum(1 for l in mine if l["event"] == "run_started")     # an interrupted earlier attempt stays in the log
            rec = run_one(entry, n12, cfg, series_dir, attempt, True, [log, ALL], dict({"manifest_sha256": fz["manifest_sha256"], "build_entry_sha256": hashes[entry["build"]]}, **({"series": a.series} if a.series else {})))
            print("%s run %d/%d %s: status=%s correct=%s cost=%s turns=%s total_spent=%.2f" % (now(), entry["run_seq"], plan["planned_runs"], entry["run_id"], rec["status"], rec["correct"], rec["cost_usd"], rec.get("turns"), spent(read_lines(log))), flush=True)
            klrc = sh(PY + ["runner/kl.py", "run", "--run-id", "%s-a%d" % (entry["run_id"], attempt), "--status", "ok" if rec["status"] == "completed" else "failed",
                            "--result", os.path.join(ROOT, rec["dir"], "run-record.json")] + sum((["--evidence-file", os.path.join(ROOT, rec["dir"], f)] for f in ("metrics.json", "checker.json", "mcp-capture.jsonl") if os.path.exists(os.path.join(ROOT, rec["dir"], f))), []),
                      os.path.join(series_dir, "chain.log"), 120)
            if klrc != 0: append_line(log, {"event": "chain_record_pending", "at": now(), "run_seq": entry["run_seq"], "attempt": attempt})
            if rec.get("fatal"):
                print("FATAL condition in run %d (%s): stopping the series" % (entry["run_seq"], rec["status"])); return 6
            last = [l for l in read_lines(log) if l["event"] == "run_finished"][-3:]
            if len(last) == 3 and all(l.get("cost_usd") is None for l in last):
                print("three runs in a row without a reported cost: stopping (spend unknown)"); return 6
        lines = read_lines(log)
        if over_budget(lines, budget): print("note: total spent %.2f is above the budget %.2f (the last run crossed it)" % (spent(lines), budget))
        print("series %s: %d finished runs, spent %.2f USD" % (n12, sum(1 for l in lines if l["event"] == "run_finished"), spent(lines)))
        return 0
    finally:
        LOCK.release(lock_dir)


if __name__ == "__main__":
    sys.exit(main())
