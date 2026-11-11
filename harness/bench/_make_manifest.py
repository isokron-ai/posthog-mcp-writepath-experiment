"""Builds evidence/MANIFEST.json (+ .sha256): sha256 of every harness file, both build hashes, the plan (with run order and
seed), model id, SDK / CLI / tool versions.   python3 -I -B bench/_make_manifest.py [--verify]
--verify recomputes the file hashes and build hashes and exits 1 if anything differs from the frozen manifest.
--series NAME: the manifest of a named series instead, at series/<NAME>/evidence/MANIFEST.json: the builds of
series/<NAME>/SERIES.json (every one of them, with its catalog), that series' plan and dry-run plan, and its files.
Without --series everything is as it was for the 2026-11-10 two-build series."""
import hashlib, json, os, subprocess, sys
HERE = os.path.dirname(os.path.abspath(__file__)); ROOT = os.path.dirname(HERE)
sys.path.insert(0, os.path.join(ROOT, "lib"))
import ph as P  # noqa: E402  (load_config: config.env + the TARGET overlay, checked)
sha = lambda p: hashlib.sha256(open(p, "rb").read()).hexdigest()
# the patch series live at the top of the repository (experiment-patches/bugfix and experiment-patches/usability)
DIRS = ("bench", "seed", "lib", "server", "probes", "tests", os.path.join("..", "experiment-patches"), "build")
SINGLE = ("config.env", "config.selfhosted.env", "runner/kl.py", "runner/package.json", "runner/package-lock.json")
# the self-hosted PostHog instance definition (compose files, image lock); hashed when TARGET=selfhosted
SELFHOST_FILES = ("docker-compose.yml", "docker-compose.base.yml", "docker-compose.localhost.yml", "IMAGES.lock", "phs", "local/clickhouse-no-crash-reports.xml")
SKIP_DIRS = {"__pycache__", "node_modules", "work", "out", "agent-cwd"}
SERIES = sys.argv[sys.argv.index("--series") + 1] if "--series" in sys.argv else None
SERIES_DIR = os.path.join(ROOT, "series", SERIES) if SERIES else None
SERIES_CFG = json.load(open(os.path.join(SERIES_DIR, "SERIES.json"))) if SERIES else None
BUILDS = tuple(SERIES_CFG["builds"]) if SERIES else ("baseline", "fixed")
PLAN = os.path.join(SERIES_DIR, "BENCH-PLAN.json") if SERIES else os.path.join(HERE, "BENCH-PLAN.json")
DRY_PLAN = os.path.join(SERIES_DIR, "DRY-RUN-PLAN.json") if SERIES else None
EVIDENCE = os.path.join(SERIES_DIR, "evidence") if SERIES else os.path.join(ROOT, "evidence")


def harness_files(cfg):
    files = {}
    for d in DIRS:
        for cur, dirs, fs in os.walk(os.path.join(ROOT, d)):
            dirs[:] = sorted(x for x in dirs if x not in SKIP_DIRS)
            for f in sorted(fs):
                if f == ".DS_Store" or f.endswith(".pyc"): continue
                p = os.path.join(cur, f); files[os.path.relpath(p, ROOT)] = sha(p)
    extra = tuple(os.path.relpath(os.path.join(SERIES_DIR, f), ROOT) for f in ("SERIES.json", "BENCH-PLAN.json", "DRY-RUN-PLAN.json")) if SERIES else ()
    for rel in SINGLE + extra + tuple("%s/%s-%s.json" % (cfg["CATALOG_DIR"], b, cfg.get("MCP_MODE", "cli")) for b in BUILDS):
        if os.path.exists(os.path.join(ROOT, rel)): files[rel] = sha(os.path.join(ROOT, rel))
    return dict(sorted(files.items()))


def selfhost_files(cfg):
    if cfg.get("TARGET") != "selfhosted": return None
    d = cfg.get("SELFHOST_DIR", "")
    return {rel: (sha(os.path.join(d, rel)) if os.path.exists(os.path.join(d, rel)) else None) for rel in SELFHOST_FILES}


def builds():
    out = {}
    for b in BUILDS:
        bj = os.path.join(ROOT, "build", "out", b, "BUILD.json")
        if not os.path.exists(bj):
            out[b] = None; continue
        j = json.load(open(bj)); bundle = os.path.join(ROOT, "build", "out", b, j["entry"])
        out[b] = {"posthog_sha": j["posthog_sha"], "entry_sha256": j["entry_sha256"], "entry_sha256_recomputed": sha(bundle) if os.path.exists(bundle) else None,
                  "source_tree_sha256": j["source_tree_sha256"], "patches": j["patches"], "patches_not_applied": j.get("patches_not_applied", []), "node": j["node"], "pnpm": j["pnpm"]}
    return out


def versions():
    v = lambda *c: (subprocess.run(c, capture_output=True, text=True).stdout.strip().splitlines() or [""])[0]
    pj = lambda rel: json.load(open(os.path.join(ROOT, "runner", "node_modules", rel, "package.json")))
    sdk = pj("@anthropic-ai/claude-agent-sdk")
    return {"claude_agent_sdk": sdk["version"], "claude_code_cli": sdk.get("claudeCodeVersion"), "kronicle_lite": pj("kronicle-lite")["version"],
            "node": v("node", "--version"), "python": sys.version.split()[0], "openssl": v("openssl", "version")}


def build_manifest():
    plan = json.load(open(PLAN))
    cfg = P.load_config()
    m = {"harness": "isokron posthog-audit benchmark", "target": cfg["TARGET"], "harness_files": harness_files(cfg), "selfhost_files": selfhost_files(cfg),
            "selfhost_dir": cfg.get("SELFHOST_DIR") if cfg["TARGET"] == "selfhosted" else None, "builds": builds(),
            "plan": plan, "plan_sha256": sha(PLAN), "order_seed": plan["order_seed"],
            "model": plan["model"], "mcp_mode": cfg.get("MCP_MODE"), "mcp_features": cfg.get("MCP_FEATURES"),
            "posthog_host": cfg.get("POSTHOG_HOST"), "posthog_project_id": cfg.get("POSTHOG_PROJECT_ID"), "posthog_org_id": cfg.get("EXPECTED_ORG_ID"),
            "posthog_key_file": cfg.get("POSTHOG_KEY_FILE"), "versions": versions()}
    if SERIES:
        dry = json.load(open(DRY_PLAN))
        m.update(series=SERIES, series_config=SERIES_CFG, task_sets=json.load(open(os.path.join(HERE, "TASKSETS.json"))),
                 dry_run_plan=dry, dry_run_plan_sha256=sha(DRY_PLAN))
    return m


if __name__ == "__main__":
    ev = EVIDENCE; out = os.path.join(ev, "MANIFEST.json")
    if "--verify" in sys.argv:
        old = json.load(open(out)); now = build_manifest()
        diff = [k for k in set(old["harness_files"]) | set(now["harness_files"]) if old["harness_files"].get(k) != now["harness_files"].get(k)]
        if old["builds"] != now["builds"]: diff.append("builds")
        if old.get("target") != now.get("target"): diff.append("target (%s -> %s)" % (old.get("target"), now.get("target")))
        if old.get("selfhost_files") != now.get("selfhost_files"): diff.append("selfhost_files")
        if old["plan_sha256"] != now["plan_sha256"]: diff.append("plan")
        if old.get("dry_run_plan_sha256") != now.get("dry_run_plan_sha256"): diff.append("dry-run plan")
        recorded = open(out + ".sha256").read().split()[0]
        if sha(out) != recorded: diff.append("MANIFEST.json itself")
        print("manifest %s: %s" % (recorded, "unchanged since freeze" if not diff else "CHANGED: " + ", ".join(sorted(diff))))
        sys.exit(1 if diff else 0)
    if os.path.exists(out):
        sys.exit("%s already exists: a frozen manifest is never overwritten" % os.path.relpath(out, ROOT))
    os.makedirs(ev, exist_ok=True)
    m = build_manifest()
    open(out, "w").write(json.dumps(m, indent=2, sort_keys=True) + "\n")
    open(out + ".sha256", "w").write("%s  MANIFEST.json\n" % sha(out))
    print(open(out + ".sha256").read().strip(), "(%d harness files)" % len(m["harness_files"]))
