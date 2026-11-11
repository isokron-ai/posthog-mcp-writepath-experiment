"""Freeze the harness before the first measured run.
  python3 -I -B bench/freeze.py [--seed N]

Steps (nothing here calls PostHog or a model):
  1. refuse unless both builds exist and the working tree is committed (git status clean);
  2. write the run plan with a recorded random seed (bench/BENCH-PLAN.json) and commit it;
  3. write evidence/MANIFEST.json: sha256 of every harness file, both build hashes, plan + seed, model id, SDK/CLI versions;
  4. record a harness_frozen event on the kronicle-lite chain (fingerprint = sha256 of the manifest), sign a checkpoint;
     if KRONICLE_ANCHOR_KEY is in the environment: `checkpoint --push` and `audit stamp` (anchor receipt + RFC 3161 tokens
     over the receipt, exactly as kronicle-lite 0.10.2 documents). Without the key that part is recorded as PENDING;
  5. independently of 4: RFC 3161 timestamps over the manifest itself from two authorities (Sectigo, DigiCert), each token
     checked to be `Granted` and to carry the manifest's sha256;
  6. derive the series nonce from the manifest hash and the two tokens (so fixture names prove they were made after the
     stamps) and write state/freeze.json. Measured runs refuse to start without it, and refuse if any harness file
     changed afterwards.
If a TSA cannot be reached the freeze still completes, marked "stamps pending" - nothing is faked.

  python3 -I -B bench/freeze.py --series NAME [--seed N]
A named series (series/<NAME>/SERIES.json) is frozen the same way but entirely inside series/<NAME>/: its plan and dry-run
plan, evidence/MANIFEST.json (+ stamps), state/freeze.json and its own kronicle-lite record (own audit id, state directory
and event keys). Every build the series names must exist, have its catalog and differ from every other build. The earlier
two-build freeze (state/freeze.json, evidence/, .kl-state/) is not read, moved or changed, and a named series supersedes
nothing unless its SERIES.json says so."""
import argparse, hashlib, json, os, re, subprocess, sys, time
sys.dont_write_bytecode = True
HERE = os.path.dirname(os.path.abspath(__file__)); ROOT = os.path.dirname(HERE)
TSAS = (("sectigo", "http://timestamp.sectigo.com"), ("digicert", "http://timestamp.digicert.com"))
sha_b = lambda b: hashlib.sha256(b).hexdigest()
run = lambda cmd, **kw: subprocess.run(cmd, capture_output=True, text=True, cwd=ROOT, **kw)


def stamp(manifest, outdir):
    """RFC 3161 tokens over the manifest file. Returns a list of {tsa, file, sha256, gen_time, status} (status ok|failed)."""
    os.makedirs(outdir, exist_ok=True)
    want = sha_b(open(manifest, "rb").read())
    tsq = os.path.join(outdir, "manifest.tsq")
    q = run(["openssl", "ts", "-query", "-data", manifest, "-sha256", "-cert", "-out", tsq])
    out = []
    for name, url in TSAS:
        tsr = os.path.join(outdir, "manifest.%s.tsr" % name)
        rec = {"tsa": name, "url": url, "file": os.path.relpath(tsr, ROOT), "status": "failed"}
        if q.returncode == 0 and not os.path.exists(tsr):
            c = run(["curl", "-sS", "-m", "40", "-H", "Content-Type: application/timestamp-query", "--data-binary", "@" + tsq, url, "-o", tsr])
            if c.returncode == 0 and os.path.exists(tsr):
                t = run(["openssl", "ts", "-reply", "-in", tsr, "-text"]).stdout
                imprint = "".join(re.findall(r"^\s+[0-9a-f]{4} - ((?:[0-9a-f]{2}[ -])+)", t, re.M)).replace(" ", "").replace("-", "")
                gt = re.search(r"Time stamp: (.+)", t)
                if "Status: Granted" in t and imprint == want:
                    rec.update(status="ok", gen_time=gt.group(1).strip() if gt else None, sha256=sha_b(open(tsr, "rb").read()), message_imprint=imprint)
                else:
                    rec["detail"] = "token not granted or imprint mismatch"
            else:
                rec["detail"] = (c.stderr or "").strip()[:200]
        out.append(rec)
    return out


def main_series(a):
    name = a.series; sd = os.path.join(ROOT, "series", name); rel = lambda p: os.path.relpath(p, ROOT)
    cfgp = os.path.join(sd, "SERIES.json")
    if not os.path.exists(cfgp): sys.exit("series/%s/SERIES.json not found" % name)
    if a.supersedes: sys.exit("--supersedes is for the two-build series; a named series records what it supersedes in its SERIES.json")
    scfg = json.load(open(cfgp)); builds = scfg["builds"]
    fz = os.path.join(sd, "state", "freeze.json")
    if os.path.exists(fz): sys.exit("series %s is already frozen (%s exists)" % (name, rel(fz)))
    eh = {}
    for b in builds:
        bj = os.path.join(ROOT, "build", "out", b, "BUILD.json")
        if not os.path.exists(bj): sys.exit("build %s is missing (build/build.sh %s): series %s needs %s" % (b, b, name, ", ".join(builds)))
        eh[b] = json.load(open(bj))["entry_sha256"]
    same = [(x, y) for i, x in enumerate(builds) for y in builds[i + 1:] if eh[x] == eh[y]]
    if same: sys.exit("byte-identical bundles: %s (nothing to compare)" % ", ".join("%s = %s" % p for p in same))
    sys.path.insert(0, os.path.join(ROOT, "lib")); import ph as P  # noqa: E402
    cfg = P.load_config()
    if scfg.get("target") and cfg["TARGET"] != scfg["target"]: sys.exit("series %s is for TARGET=%s (TARGET is %s)" % (name, scfg["target"], cfg["TARGET"]))
    if not cfg.get("POSTHOG_PROJECT_ID", "").isdigit(): sys.exit("POSTHOG_PROJECT_ID is not filled in for TARGET=%s" % cfg["TARGET"])
    for b in builds:
        if not os.path.exists(os.path.join(ROOT, cfg["CATALOG_DIR"], "%s-%s.json" % (b, cfg["MCP_MODE"]))):
            sys.exit("%s/%s-%s.json is missing: record what the agent sees first (TARGET=%s server/catalog.sh %s)" % (cfg["CATALOG_DIR"], b, cfg["MCP_MODE"], cfg["TARGET"], b))
    if run(PY + ["tests/test_offline.py"]).returncode != 0: sys.exit("offline tests fail: not freezing")
    p = run(PY + ["bench/_make_plan.py", "--series", name] + (["--seed", str(a.seed)] if a.seed is not None else [])); print(p.stdout.strip())
    if p.returncode != 0: sys.exit(p.stderr or p.stdout)
    run(["git", "add", rel(os.path.join(sd, "BENCH-PLAN.json")), rel(os.path.join(sd, "DRY-RUN-PLAN.json"))])
    run(["git", "commit", "-q", "-m", "Run plan and dry-run plan for series %s (order seeds recorded in the files)\n\nCo-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>" % name])
    dirty = run(["git", "status", "--porcelain"]).stdout.strip()
    if dirty and not a.allow_dirty: sys.exit("uncommitted changes: commit first so the frozen files are in git\n" + dirty)
    m = run(PY + ["bench/_make_manifest.py", "--series", name])
    if m.returncode != 0: sys.exit(m.stderr or m.stdout)
    manifest = os.path.join(sd, "evidence", "MANIFEST.json"); msha = sha_b(open(manifest, "rb").read()); print("manifest sha256 %s" % msha)
    stamps = stamp(manifest, os.path.join(sd, "evidence", "stamps"))
    ok = [s_ for s_ in stamps if s_["status"] == "ok"]
    nonce = sha_b((msha + "".join(s_["sha256"] for s_ in ok)).encode()) if ok else sha_b((msha + "unstamped").encode())
    plan = json.load(open(os.path.join(sd, "BENCH-PLAN.json"))); dry = json.load(open(os.path.join(sd, "DRY-RUN-PLAN.json")))
    kl = {"harness_frozen": "pending", "checkpoint": "pending", "anchor": "pending", "receipt_stamps": "pending"}
    klenv = {"PA_KL_AUDIT_ID": scfg["audit_id"], "PA_KL_STATE": os.path.join(sd, "kl-state"), "PA_KL_EVIDENCE": os.path.join(sd, "evidence", "chain-runs")}
    env = {**os.environ, "KRONICLE_LITE_DATA_DIR": os.path.join(ROOT, ".kl")}
    r = run(PY + ["runner/kl.py", "freeze", "--manifest", manifest, "--planned-runs", str(plan["planned_runs"]), "--nonce", nonce,
                  "--event-key", "freeze-%s" % name, "--title", scfg.get("title", name)], env={**os.environ, **klenv})
    if r.returncode == 0:
        kl["harness_frozen"] = json.loads(r.stdout.strip().splitlines()[-1])
        KL = os.path.join(ROOT, "runner", "node_modules", ".bin", "kronicle-lite")
        if os.environ.get("KRONICLE_ANCHOR_KEY"):
            c = run([KL, "checkpoint", "--push"], env=env); kl["anchor"] = "ok" if c.returncode == 0 else "failed: " + (c.stderr or c.stdout).strip()[:200]
            kl["checkpoint"] = "ok" if c.returncode == 0 else "pending"
            if c.returncode == 0:
                s_ = run([KL, "audit", "stamp", "--out", os.path.join(sd, "evidence", "stamps-kl")], env=env)
                kl["receipt_stamps"] = "ok" if s_.returncode == 0 and os.path.isdir(os.path.join(sd, "evidence", "stamps-kl")) else "failed: " + (s_.stderr or s_.stdout).strip()[:200]
        else:
            env.pop("KRONICLE_ANCHOR_KEY", None)
            c = run([KL, "checkpoint"], env=env); kl["checkpoint"] = "ok (local, signed; not anchored)" if c.returncode == 0 else "failed"
            kl["anchor"] = "PENDING: KRONICLE_ANCHOR_KEY not in the environment"
    else:
        kl["harness_frozen"] = "failed: " + (r.stderr or r.stdout).strip()[:300]
    state = {"series": name, "frozen_at": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()), "target": cfg["TARGET"], "posthog_host": cfg["POSTHOG_HOST"],
             "posthog_project_id": cfg["POSTHOG_PROJECT_ID"], "posthog_org_id": cfg.get("EXPECTED_ORG_ID"), "manifest": rel(manifest), "manifest_sha256": msha,
             "nonce": nonce, "n12": nonce[:12], "git_commit": run(["git", "rev-parse", "HEAD"]).stdout.strip(), "builds": {b: eh[b] for b in builds},
             "task_sets": scfg["task_sets"], "repetitions": scfg["repetitions"], "model": scfg["model"], "budget_usd": scfg["budget_usd"], "fixtures": scfg["fixtures"],
             "planned_runs": plan["planned_runs"], "order_seed": plan["order_seed"], "dry_run_planned_runs": dry["planned_runs"], "dry_run_order_seed": dry["order_seed"],
             "manifest_stamps": stamps,
             "manifest_stamps_status": "ok (%d of %d authorities)" % (len(ok), len(TSAS)) if len(ok) == len(TSAS) else "STAMPS PENDING (%d of %d authorities answered)" % (len(ok), len(TSAS)),
             "kronicle_lite": kl, "kronicle_lite_audit_id": scfg["audit_id"], "supersedes": scfg.get("supersedes"), "relation_to_earlier_series": scfg.get("relation_to_earlier_series")}
    os.makedirs(os.path.dirname(fz), exist_ok=True)
    with open(fz, "x") as f:
        json.dump(state, f, indent=2, sort_keys=True); f.write("\n")
    with open(os.path.join(ROOT, "LEDGER.md"), "a") as f:
        f.write("\n## %s — FREEZE of series `%s` (written by bench/freeze.py --series)\n- target %s (%s, project %s, org %s); builds %s; task sets %s; %d repetitions; model `%s`; budget %s USD; fixtures %s.\n- manifest `%s` sha256 `%s`; git commit `%s`; plan %d runs (seed %s); dry-run plan %d runs, one repetition (seed %s).\n- RFC 3161 over the manifest: %s.\n- kronicle-lite (audit `%s`): harness_frozen %s; checkpoint %s; anchor %s; receipt stamps %s.\n- series nonce `%s` (fixtures and created objects carry `bench-%s-`). No harness file may change from here on; `bench/_make_manifest.py --series %s --verify` is run before every measured session.\n- SUPERSEDES: %s. %s\n" % (
            state["frozen_at"], name, cfg["TARGET"], cfg["POSTHOG_HOST"], cfg["POSTHOG_PROJECT_ID"], cfg.get("EXPECTED_ORG_ID"),
            ", ".join("%s `%s…`" % (b, eh[b][:12]) for b in builds), " and ".join(scfg["task_sets"]), scfg["repetitions"], scfg["model"], scfg["budget_usd"], scfg["fixtures"],
            rel(manifest), msha, state["git_commit"], plan["planned_runs"], plan["order_seed"], dry["planned_runs"], dry["order_seed"],
            "; ".join("%s %s%s" % (s_["tsa"], s_["status"], " at " + s_["gen_time"] if s_.get("gen_time") else "") for s_ in stamps) + " -> " + state["manifest_stamps_status"],
            scfg["audit_id"], "recorded" if isinstance(kl["harness_frozen"], dict) else kl["harness_frozen"], kl["checkpoint"], kl["anchor"], kl["receipt_stamps"],
            nonce, nonce[:12], name, scfg.get("supersedes") or "nothing (a new series)", scfg.get("relation_to_earlier_series") or ""))
    print(json.dumps({k: state[k] for k in ("series", "manifest_sha256", "n12", "planned_runs", "dry_run_planned_runs", "manifest_stamps_status")}))
    print("next: python3 -I -B seed/seed.py --nonce %s --init --fixtures %s   then   bench/run-bench.sh --series %s" % (nonce[:12], scfg["fixtures"], name))


def main():
    ap = argparse.ArgumentParser(); ap.add_argument("--seed", type=int); ap.add_argument("--allow-dirty", action="store_true", help=argparse.SUPPRESS)
    ap.add_argument("--supersedes", metavar="DIR", help="directory holding the previous freeze (its state/freeze.json, evidence/, .kl-state/), moved there unchanged; recorded in the new freeze")
    ap.add_argument("--series", metavar="NAME", help="freeze the named series in series/NAME/ (see the module docstring)")
    a = ap.parse_args()
    if a.series:
        return main_series(a)
    fz = os.path.join(ROOT, "state", "freeze.json")
    prev = None
    if a.supersedes:
        pf = os.path.join(ROOT, a.supersedes, "state", "freeze.json")
        if not os.path.exists(pf): sys.exit("--supersedes %s: no state/freeze.json there" % a.supersedes)
        pj = json.load(open(pf))
        prev = {"dir": a.supersedes, "manifest_sha256": pj["manifest_sha256"], "frozen_at": pj["frozen_at"], "n12": pj["n12"], "git_commit": pj.get("git_commit")}
    if os.path.exists(fz): sys.exit("already frozen (state/freeze.json exists). A new series needs a new freeze: move state/freeze.json, evidence/ and .kl-state/ aside deliberately and record why in LEDGER.md.")
    for b in ("baseline", "fixed"):
        if not os.path.exists(os.path.join(ROOT, "build", "out", b, "BUILD.json")): sys.exit("build %s is missing (build/build.sh %s): a before/after series needs both" % (b, b))
    eh = {b: json.load(open(os.path.join(ROOT, "build", "out", b, "BUILD.json")))["entry_sha256"] for b in ("baseline", "fixed")}
    if eh["baseline"] == eh["fixed"]: sys.exit("the fixed bundle is byte-identical to the baseline bundle (the patches change nothing that is bundled): nothing to compare")
    sys.path.insert(0, os.path.join(ROOT, "lib")); import ph as P  # noqa: E402
    cfg = P.load_config()  # TARGET=cloud|selfhosted required; the selfhosted checks (loopback host, not the Cloud key) apply
    if not cfg.get("POSTHOG_PROJECT_ID", "").isdigit(): sys.exit("POSTHOG_PROJECT_ID is not filled in for TARGET=%s" % cfg["TARGET"])
    for b in ("baseline", "fixed"):
        if not os.path.exists(os.path.join(ROOT, cfg["CATALOG_DIR"], "%s-%s.json" % (b, cfg["MCP_MODE"]))):
            sys.exit("%s/%s-%s.json is missing: record what the agent sees first (TARGET=%s server/catalog.sh %s)" % (cfg["CATALOG_DIR"], b, cfg["MCP_MODE"], cfg["TARGET"], b))
    if run(PY + ["tests/test_offline.py"]).returncode != 0: sys.exit("offline tests fail: not freezing")
    p = run(PY + ["bench/_make_plan.py"] + (["--seed", str(a.seed)] if a.seed is not None else [])); print(p.stdout.strip().splitlines()[0])
    run(["git", "add", "bench/BENCH-PLAN.json"]); run(["git", "commit", "-q", "-m", "Run plan for the measured series (order seed recorded in the file)\n\nCo-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"])
    dirty = run(["git", "status", "--porcelain"]).stdout.strip()
    if dirty and not a.allow_dirty: sys.exit("uncommitted changes: commit first so the frozen files are in git\n" + dirty)
    m = run(PY + ["bench/_make_manifest.py"])
    if m.returncode != 0: sys.exit(m.stderr or m.stdout)
    manifest = os.path.join(ROOT, "evidence", "MANIFEST.json"); msha = sha_b(open(manifest, "rb").read()); print("manifest sha256 %s" % msha)
    stamps = stamp(manifest, os.path.join(ROOT, "evidence", "stamps"))
    ok = [s for s in stamps if s["status"] == "ok"]
    nonce = sha_b((msha + "".join(s["sha256"] for s in ok)).encode()) if ok else sha_b((msha + "unstamped").encode())
    # kronicle-lite chain (local, signed); anchoring only when the owner supplies the key in the environment
    kl = {"harness_frozen": "pending", "checkpoint": "pending", "anchor": "pending", "receipt_stamps": "pending"}
    env = {**os.environ, "KRONICLE_LITE_DATA_DIR": os.path.join(ROOT, ".kl")}
    r = run(PY + ["runner/kl.py", "freeze", "--manifest", manifest, "--planned-runs", "36", "--nonce", nonce])
    if r.returncode == 0:
        kl["harness_frozen"] = json.loads(r.stdout.strip().splitlines()[-1])
        KL = os.path.join(ROOT, "runner", "node_modules", ".bin", "kronicle-lite")
        if os.environ.get("KRONICLE_ANCHOR_KEY"):
            c = run([KL, "checkpoint", "--push"], env=env); kl["anchor"] = "ok" if c.returncode == 0 else "failed: " + (c.stderr or c.stdout).strip()[:200]
            kl["checkpoint"] = "ok" if c.returncode == 0 else "pending"
            if c.returncode == 0:
                s = run([KL, "audit", "stamp", "--out", os.path.join(ROOT, "evidence", "stamps-kl")], env=env)
                kl["receipt_stamps"] = "ok" if s.returncode == 0 and os.path.isdir(os.path.join(ROOT, "evidence", "stamps-kl")) else "failed: " + (s.stderr or s.stdout).strip()[:200]
        else:
            env.pop("KRONICLE_ANCHOR_KEY", None)
            c = run([KL, "checkpoint"], env=env); kl["checkpoint"] = "ok (local, signed; not anchored)" if c.returncode == 0 else "failed"
            kl["anchor"] = "PENDING: KRONICLE_ANCHOR_KEY not in the environment"
    else:
        kl["harness_frozen"] = "failed: " + (r.stderr or r.stdout).strip()[:300]
    state = {"frozen_at": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()), "target": cfg["TARGET"], "posthog_host": cfg["POSTHOG_HOST"], "posthog_project_id": cfg["POSTHOG_PROJECT_ID"], "manifest_sha256": msha, "nonce": nonce, "n12": nonce[:12],
             "git_commit": run(["git", "rev-parse", "HEAD"]).stdout.strip(), "manifest_stamps": stamps,
             "manifest_stamps_status": "ok (%d of %d authorities)" % (len(ok), len(TSAS)) if len(ok) == len(TSAS) else "STAMPS PENDING (%d of %d authorities answered)" % (len(ok), len(TSAS)),
             "kronicle_lite": kl, "supersedes": prev}
    os.makedirs(os.path.dirname(fz), exist_ok=True)
    with open(fz, "x") as f:
        json.dump(state, f, indent=2, sort_keys=True); f.write("\n")
    with open(os.path.join(ROOT, "LEDGER.md"), "a") as f:
        f.write("\n## %s — FREEZE (written by bench/freeze.py)\n- target %s (%s, project %s); manifest sha256 `%s`; git commit `%s`; plan seed %s.\n- RFC 3161 over the manifest: %s.\n- kronicle-lite: harness_frozen %s; checkpoint %s; anchor %s; receipt stamps %s.\n- series nonce `%s` (fixtures and created objects carry `bench-%s-`). No harness file may change from here on; `bench/_make_manifest.py --verify` is run before every measured session.\n%s" % (
            state["frozen_at"], cfg["TARGET"], cfg["POSTHOG_HOST"], cfg["POSTHOG_PROJECT_ID"], msha, state["git_commit"], json.load(open(os.path.join(HERE, "BENCH-PLAN.json")))["order_seed"],
            "; ".join("%s %s%s" % (s["tsa"], s["status"], " at " + s["gen_time"] if s.get("gen_time") else "") for s in stamps) + " -> " + state["manifest_stamps_status"],
            "recorded" if isinstance(kl["harness_frozen"], dict) else kl["harness_frozen"], kl["checkpoint"], kl["anchor"], kl["receipt_stamps"], nonce, nonce[:12],
            ("- SUPERSEDES the freeze of %s (manifest `%s`, nonce `%s`), kept unchanged in `%s/`.\n" % (prev["frozen_at"], prev["manifest_sha256"], prev["n12"], prev["dir"])) if prev else ""))
    print(json.dumps({k: state[k] for k in ("manifest_sha256", "n12", "manifest_stamps_status")}))
    print("next: python3 -I -B seed/seed.py --nonce %s --init   then   bench/run-bench.sh" % nonce[:12])


PY = [sys.executable, "-I", "-B"]
if __name__ == "__main__":
    main()
