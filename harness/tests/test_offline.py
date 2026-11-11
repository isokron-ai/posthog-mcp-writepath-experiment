"""Offline tests (no network, no key, no model): python3 -I -B tests/test_offline.py
Covers: the guard, the path/prefix refusals, paging, seed -> hash -> reset -> hash, cleanup scoping, redaction, and for
each of the twelve checkers a negative control (untouched seed must fail), a correct end state (must pass) and typical
failure states (must fail on the specific criterion); fixture set v2 (surveys, seeded annotations), the three-build plans."""
import copy, io, json, os, subprocess, sys, tempfile
sys.dont_write_bytecode = True
ROOT = os.path.abspath(os.path.join(os.path.dirname(os.path.abspath(__file__)), ".."))
for d in ("lib", "seed", "tests", os.path.join("bench", "checkers"), "bench"):
    sys.path.insert(0, os.path.join(ROOT, d))
import ph as P, spec as S, state as ST, seed as SEED
from fake_posthog import Fake
import check_a, check_b, check_c, check_d, check_e, check_f
import check_g, check_h, check_i, check_j, check_k, check_l

N = "0123456789ab"; PRE = "bench-%s-" % N; R = "r007"
CFG = {"POSTHOG_HOST": "https://fake.invalid", "POSTHOG_PROJECT_ID": "1", "EXPECTED_ORG_ID": "org-test", "MAX_REQUESTS_PER_SECOND": "2"}
passed = failed = 0


def ok(name, cond, detail=""):
    global passed, failed
    if cond: passed += 1
    else: failed += 1; print("FAIL %s %s" % (name, detail))


def refuses(fn):
    try:
        fn(); return False
    except SystemExit:
        return True


def client(fake, cfg=CFG):
    ph = P.PostHog(cfg=dict(cfg), transport=fake); return ph


# ---- guard ---------------------------------------------------------------------------------------------------------
fake = Fake()
ph = client(fake)
ok("write before guard is refused", refuses(lambda: ph.post("insights/", {"name": PRE + "x"})))
ok("guard passes on matching project+org", ph.guard(quiet=True)["project_id"] == 1)
ok("guard refuses wrong org", refuses(lambda: client(Fake(org="someone-else")).guard(quiet=True)))
ok("guard refuses wrong project id in response", refuses(lambda: client(type("F", (Fake,), {"__call__": lambda s, m, p, b=None: (200, {"id": 999, "organization": "org-test"})})()).guard(quiet=True)))
ok("guard refuses placeholder project id", refuses(lambda: P.PostHog(cfg=dict(CFG, POSTHOG_PROJECT_ID="<FILL_ME>"), transport=fake)))
ok("guard refuses unset expected org", refuses(lambda: client(fake, dict(CFG, EXPECTED_ORG_ID="")).guard(quiet=True)))
ok("non-project path refused", refuses(lambda: ph._req("GET", "/api/organizations/@current/")))
ok("other project path refused", refuses(lambda: ph._req("GET", "/api/projects/2/insights/")))
ok("unprefixed name refused", refuses(lambda: ph.require_prefixed("Weekly active users", N)))
ok("bad nonce refused", refuses(lambda: P.prefix("XYZ")))

# ---- target selection (lib/target.py) ------------------------------------------------------------------------------
import target as T
_td = tempfile.mkdtemp(prefix="target-test-")
def _cfgfile(name, text):
    p = os.path.join(_td, name); open(p, "w").write(text); return p
_base = _cfgfile("config.env", "POSTHOG_HOST=https://us.posthog.com\nPOSTHOG_PROJECT_ID=12345\nEXPECTED_ORG_ID=org-cloud\nPOSTHOG_KEY_FILE=~/.isokron/posthog-audit-key\nMCP_MODE=cli\n")
_sh_ok = "POSTHOG_HOST=http://127.0.0.1:8010\nPOSTHOG_PROJECT_ID=2\nEXPECTED_ORG_ID=org-local\nPOSTHOG_KEY_FILE=/tmp/local-test-key\n"
def _load(target, overlay=None, env=None):
    saved = dict(T.OVERLAYS); T.OVERLAYS["selfhosted"] = _cfgfile("ov.env", overlay) if overlay is not None else saved["selfhosted"]
    try:
        return T.load(_base, target=target, environ=env or {})
    finally:
        T.OVERLAYS.clear(); T.OVERLAYS.update(saved)
ok("target: no TARGET is refused (no silent default)", refuses(lambda: _load("")))
ok("target: unknown TARGET is refused", refuses(lambda: _load("staging")))
ok("target: cloud resolves to the Cloud settings", _load("cloud")["POSTHOG_HOST"] == "https://us.posthog.com")
c = _load("selfhosted", _sh_ok)
ok("target: selfhosted overlay replaces host, project, org and key file", (c["POSTHOG_HOST"], c["POSTHOG_PROJECT_ID"], c["EXPECTED_ORG_ID"], c["POSTHOG_KEY_FILE"]) == ("http://127.0.0.1:8010", "2", "org-local", "/tmp/local-test-key"))
ok("target: selfhosted refuses a non-loopback host", refuses(lambda: _load("selfhosted", _sh_ok.replace("http://127.0.0.1:8010", "https://us.posthog.com"))))
ok("target: selfhosted refuses a lookalike host", refuses(lambda: _load("selfhosted", _sh_ok.replace("127.0.0.1:8010", "127.0.0.1.example.com"))))
ok("target: selfhosted refuses the Cloud key file", refuses(lambda: _load("selfhosted", _sh_ok.replace("/tmp/local-test-key", "~/.isokron/posthog-audit-key"))))
ok("target: selfhosted refuses any key file under ~/.isokron", refuses(lambda: _load("selfhosted", _sh_ok.replace("/tmp/local-test-key", "~/.isokron/other-key"))))
ok("target: selfhosted refuses an overlay that inherits the Cloud key file", refuses(lambda: _load("selfhosted", "\n".join(l for l in _sh_ok.splitlines() if not l.startswith("POSTHOG_KEY_FILE")))))
ok("target: selfhosted refuses an overlay that inherits the Cloud host", refuses(lambda: _load("selfhosted", "\n".join(l for l in _sh_ok.splitlines() if not l.startswith("POSTHOG_HOST")))))
ok("target: an environment override back to Cloud is refused", refuses(lambda: _load("selfhosted", _sh_ok, env={"POSTHOG_HOST": "https://us.posthog.com"})))
ok("target: cloud refuses a loopback host", refuses(lambda: _load("cloud", env={"POSTHOG_HOST": "http://127.0.0.1:8010"})))
ok("target: live client refuses selfhosted cfg with the Cloud key", refuses(lambda: P.PostHog(cfg=dict(c, POSTHOG_KEY_FILE="~/.isokron/posthog-audit-key"))))
_p = subprocess.run(["node", os.path.join(ROOT, "server", "mcp-proxy.mjs"), "--listen", "1", "--upstream", "http://127.0.0.1:2", "--key-file", "~/.isokron/posthog-audit-key",
                     "--project-id", "1", "--mode", "cli", "--target", "selfhosted", "--capture", os.path.join(_td, "cap.jsonl")], capture_output=True, text=True, timeout=30)
ok("target: proxy refuses the Cloud key path for selfhosted (without reading it)", _p.returncode == 2 and "REFUSED" in _p.stderr and not os.path.exists(os.path.join(_td, "cap.jsonl")), _p.stderr)

# ---- hourly request budget: wait for the next hour instead of stopping (dry run 2026-11-10, run d017) ----------------
_tp = os.path.join(tempfile.mkdtemp(), "throttle"); _th = P.Throttle(1000, per_hour=3, path=_tp); _slept = []
def _fake_sleep(sec):
    _slept.append(sec)
    if sec > 0.5:  # the hour wait: pretend the clock hour rolled over
        open(_tp, "w").write("0.0 0 0")
_th.sleep = _fake_sleep
import time as _time
open(_tp, "w").write("%.6f %d %d" % (_time.time() - 10, int(_time.time() // 3600), 3))
_th.wait()
_waits = [x for x in _slept if x > 0.5]
ok("throttle: budget used up waits for the next hour once, then proceeds", len(_waits) == 1 and 1 <= _waits[0] <= 3601 and open(_tp).read().split()[2] == "1", str(_slept))
_cfg = {"POSTHOG_HOST": "https://fake.invalid", "POSTHOG_PROJECT_ID": "1"}
ok("throttle: default hourly budget is 2400", P.PostHog(cfg=dict(_cfg), transport=lambda *a: (200, {})).throttle.per_hour == 2400)
ok("throttle: MAX_REQUESTS_PER_HOUR is honoured", P.PostHog(cfg=dict(_cfg, MAX_REQUESTS_PER_HOUR="3000"), transport=lambda *a: (200, {})).throttle.per_hour == 3000)
ok("throttle: MAX_REQUESTS_PER_HOUR is capped at 3600", P.PostHog(cfg=dict(_cfg, MAX_REQUESTS_PER_HOUR="9000"), transport=lambda *a: (200, {})).throttle.per_hour == 3600)


# ---- seed, paging, hash, reset ---------------------------------------------------------------------------------------
fake.db["insights"].append({"id": 1, "name": "Someone else's insight", "deleted": False, "tags": [], "query": {"kind": "TrendsQuery"}})
fake.db["feature_flags"].append({"id": 2, "key": "production-flag", "active": True, "deleted": False, "filters": {}})
w = SEED.ensure(ph, N, out=io.StringIO())
sp = S.spec(N)
ok("seed writes = fixtures", w == len(sp["insights"]) + len(sp["dashboards"]) + len(sp["flags"]), str(w))
snap = ST.snapshot(ph, N); norm = ST.normalize(snap); h0 = ST.sha(norm)
ok("paging returned all 120 flags (cap 100/page)", len(snap["flags"]) == 120, str(len(snap["flags"])))
ok("snapshot excludes foreign objects", all(r["name"].startswith(PRE) for r in snap["insights"]) and len(snap["insights"]) == 9)
ok("weekly insight is on the release board", norm["insights"][PRE + "weekly-signups"][0]["dashboards"] == [PRE + "release-board"])
ok("board tile lists the insight", norm["dashboards"][PRE + "release-board"][0]["tiles"] == [PRE + "weekly-signups"])
ok("second ensure is a no-op", SEED.ensure(ph, N, norm, out=io.StringIO()) == 0)
base = {"n12": N, "expected_sha256": h0, "normalized": norm, "ids": ST.ids(snap)}
BASE_DB = copy.deepcopy(fake.db)


def db(kind, field, value):
    return next(r for r in fake.db[kind] if r.get(field) == value and not r.get("deleted"))


def fresh():
    fake.db = copy.deepcopy(BASE_DB)


def live():
    return ST.snapshot(ph, N)


def verdict(mod, answer=""):
    c, info = mod.evaluate(live(), base, {"n12": N, "run_tag": R, "P": PRE, "answer": answer})
    return c, all(v is True for v in c.values())


# an agent run leaves a mess; reset must restore the exact seeded state
db("insights", "name", PRE + "weekly-signups").update(name=PRE + "renamed", query={"kind": "InsightVizNode", "source": {"kind": "TrendsQuery", "series": []}})
db("feature_flags", "key", PRE + "flag-010")["active"] = False
db("feature_flags", "key", PRE + "flag-011")["deleted"] = True
ph.post("feature_flags/", {"key": PRE + R + "-new-checkout", "active": True, "filters": {"groups": []}})
ph.post("annotations/", {"content": PRE + R + " Deploy", "scope": "project"})
ph.post("dashboards/", {"name": PRE + R + "-growth-overview"})
ok("state differs after the mess", ST.sha(ST.normalize(live())) != h0)
SEED.ensure(ph, N, norm, out=io.StringIO())
ok("reset restores the seeded state hash", ST.sha(ST.normalize(live())) == h0)
ok("reset left foreign objects alone", any(r["name"] == "Someone else's insight" and not r["deleted"] for r in fake.db["insights"]) and any(f["key"] == "production-flag" and not f["deleted"] for f in fake.db["feature_flags"]))
BASE_DB = copy.deepcopy(fake.db); base["ids"] = ST.ids(live())

# ---- checkers ------------------------------------------------------------------------------------------------------
for mod in (check_a, check_b, check_c, check_d, check_e, check_f):
    fresh(); c, good = verdict(mod)
    ok("%s negative control: untouched seed is not correct" % mod.__name__, not good)
    ok("%s negative control: collateral clean" % mod.__name__, c.get("nothing_else_changed", c.get("nothing_changed")) is True, str(c))

# a
def do_a(period="Week", attach=(True, True, True), date_from="-30d"):
    fresh()
    code, d = ph.post("dashboards/", {"name": PRE + R + "-growth-overview", "description": "Signup flow health"})
    qs = [("signups-trend", {"kind": "InsightVizNode", "source": {"kind": "TrendsQuery", "series": [{"kind": "EventsNode", "event": "signup_completed", "math": "total"}], "interval": "day", "dateRange": {"date_from": date_from}}}),
          ("signup-funnel", {"kind": "InsightVizNode", "source": {"kind": "FunnelsQuery", "series": [{"kind": "EventsNode", "event": "signup_started"}, {"kind": "EventsNode", "event": "signup_completed"}]}}),
          ("signup-retention", {"kind": "InsightVizNode", "source": {"kind": "RetentionQuery", "retentionFilter": {"period": period, "targetEntity": {"id": "signup_completed", "type": "events"}, "returningEntity": {"id": "app_opened", "type": "events"}}}})]
    for (nm, q), att in zip(qs, attach):
        ph.post("insights/", {"name": PRE + R + "-" + nm, "query": q, "dashboards": [d["id"]] if att else []})
do_a(); c, good = verdict(check_a); ok("a correct state passes", good, str(c))
do_a(attach=(True, True, False)); c, good = verdict(check_a); ok("a unattached insight fails", not good and c["dashboard_has_exactly_the_three_insights"] is False and c["trend_query"] is True)
do_a(period="Day"); c, good = verdict(check_a); ok("a wrong retention period fails", not good and c["retention_query"] is False)
do_a(date_from="-7d"); c, good = verdict(check_a); ok("a wrong date range fails", not good and c["trend_query"] is False)
do_a(); db("feature_flags", "key", PRE + "flag-001")["active"] = False; c, good = verdict(check_a); ok("a collateral change fails", not good and c["nothing_else_changed"] is False)

# b
def do_b(**over):
    fresh(); r = db("insights", "name", PRE + "weekly-signups")
    r.update(name=PRE + "weekly-signups-by-browser", description=check_b.NEW_DESC); r.update(over)
do_b(); c, good = verdict(check_b); ok("b correct state passes", good, str(c))
q2 = copy.deepcopy(db("insights", "name", PRE + "weekly-signups-by-browser")["query"]); q2["source"]["trendsFilter"]["display"] = "ActionsLineGraph"
do_b(query=q2); c, good = verdict(check_b); ok("b changed query fails", not good and c["query_byte_identical"] is False)
do_b(tags=[]); c, good = verdict(check_b); ok("b dropped tags fails", not good and c["tags_identical"] is False)
do_b(_dash=[]); c, good = verdict(check_b); ok("b detached from dashboard fails", not good and c["dashboards_identical"] is False)
fresh(); old = db("insights", "name", PRE + "weekly-signups"); body = {k: v for k, v in old.items() if k not in ("id", "short_id", "_dash")}; body.update(name=PRE + "weekly-signups-by-browser", description=check_b.NEW_DESC, dashboards=old["_dash"]); old["deleted"] = True; ph.post("insights/", body)
c, good = verdict(check_b); ok("b delete-and-recreate fails", not good and c["same_object_not_recreated"] is False)

# c
def do_c(pct=60, props=None, groups=None):
    fresh()
    props = props if props is not None else [{"key": "email", "operator": "icontains", "value": "@example.com", "type": "person"}, {"key": "plan", "operator": "exact", "value": ["pro"], "type": "person"}]
    ph.post("feature_flags/", {"key": PRE + R + "-new-checkout", "name": "New checkout flow", "active": True,
                               "filters": {"groups": groups if groups is not None else [{"properties": props, "rollout_percentage": pct}]}})
do_c(); c, good = verdict(check_c); ok("c correct state passes", good, str(c))
do_c(pct=20); c, good = verdict(check_c); ok("c rollout not raised fails", not good and c["rollout_is_60"] is False)
do_c(props=[]); c, good = verdict(check_c); ok("c filters wiped by the update fails", not good and c["email_filter_survived"] is False and c["plan_filter_survived"] is False)
do_c(groups=[{"properties": [], "rollout_percentage": 60}, {"properties": [], "rollout_percentage": 20}]); c, good = verdict(check_c); ok("c extra release condition fails", not good and c["one_release_condition"] is False)

# d
dis = ", ".join(sp["disabled_flags"])
fresh(); c, good = verdict(check_d, "FLAG_COUNT: 120\nDISABLED: %s\n\n```json\n{\"extra_calls\": []}\n```" % dis); ok("d correct answer passes", good, str(c))
fresh(); c, good = verdict(check_d, "FLAG_COUNT: 100\nDISABLED: %s" % dis); ok("d first-page-only count fails", not good and c["count_matches_api"] is False)
fresh(); c, good = verdict(check_d, "FLAG_COUNT: 120\nDISABLED: %s" % ", ".join(sp["disabled_flags"][:7])); ok("d missing disabled flags fails", not good and c["disabled_set_matches_api"] is False)
fresh(); c, good = verdict(check_d, "There are **120** flags."); ok("d missing format fails", not good and c["count_line_present_once"] is False)
fresh(); c, good = verdict(check_d, "`FLAG_COUNT: 120`\n`DISABLED: %s`" % dis); ok("d backticked lines accepted", good, str(c))

# e
def do_e(content=None, when="2026-10-14T09:30:00Z", scope="dashboard", n=1):
    fresh()
    for _ in range(n):
        ph.post("annotations/", {"content": content or PRE + R + " Deploy v4.2.1 checkout rewrite", "date_marker": when, "scope": scope,
                                 "dashboard_id": base["ids"]["dashboards"][PRE + "release-board"] if scope == "dashboard" else None})
do_e(); c, good = verdict(check_e); ok("e correct state passes", good, str(c))
do_e(when="2026-10-14T11:30:00+02:00"); c, good = verdict(check_e); ok("e same instant in another offset passes", good, str(c))
do_e(content=PRE + R + " Deploy v4.2.0 checkout rewrite"); c, good = verdict(check_e); ok("e uncorrected text fails", not good and c["text_is_corrected"] is False)
do_e(n=2); c, good = verdict(check_e); ok("e duplicate annotation fails", not good and c["annotation_exactly_one"] is False)
do_e(scope="project"); c, good = verdict(check_e); ok("e project scope fails", not good and c["scope_is_dashboard"] is False)
do_e(when="2026-10-14T09:30:00+02:00"); c, good = verdict(check_e); ok("e wrong instant fails", not good and c["timestamp_exact"] is False)

# f
def do_f(which=(1, 3, 5), replace=False):
    fresh()
    for i in which:
        r = db("insights", "name", PRE + "triage-%02d" % i); r["tags"] = [PRE + "triaged"] if replace else r["tags"] + [PRE + "triaged"]
rep = "\n".join("CHANGED: %striage-%02d" % (PRE, i) for i in (1, 3, 5))
do_f(); c, good = verdict(check_f, rep); ok("f correct state passes", good, str(c))
do_f(replace=True); c, good = verdict(check_f, rep); ok("f tags replaced (existing lost) fails", not good and c["targets_kept_existing_tags"] is False)
do_f(which=(1, 3, 4, 5)); c, good = verdict(check_f, rep); ok("f decoy tagged fails", not good and c["non_targets_tags_unchanged"] is False)
do_f(which=(1, 3)); c, good = verdict(check_f, rep); ok("f missed target fails", not good and c["targets_have_new_tag"] is False)
do_f(); c, good = verdict(check_f, "CHANGED: %striage-01" % PRE); ok("f wrong report fails", not good and c["report_matches_targets"] is False)

# ---- cleanup scoping -------------------------------------------------------------------------------------------------
fresh(); do_e(); OTHER = "ffffffffffff"
ph.post("insights/", {"name": "bench-%s-other-series" % OTHER, "query": {}})
snap = live()
for rel, field, rows in (("annotations/", "content", snap["annotations"]), ("insights/", "name", snap["insights"]), ("dashboards/", "name", snap["dashboards"]), ("feature_flags/", "key", snap["flags"])):
    for r in rows:
        ph.require_prefixed(r[field], N); SEED.soft_delete(ph, rel, r["id"])
left = live()
ok("cleanup removed every object of this nonce", sum(len(left[k]) for k in ("insights", "dashboards", "flags", "annotations")) == 0)
alive = lambda kind: [r for r in fake.db[kind] if not r.get("deleted")]
ok("cleanup left other nonces and foreign objects", {r["name"] for r in alive("insights")} == {"Someone else's insight", "bench-%s-other-series" % OTHER} and {f["key"] for f in alive("feature_flags")} == {"production-flag"})
ok("no DELETE or write outside the project", all(p.startswith("/api/projects/1/") for _, p in fake.calls))

# ---- redaction (python and the node capture path) ------------------------------------------------------------------------
SECRET = "phx_TEST" + "a1B2c3D4e5F6g7H8i9J0" * 2
txt = P.redact('{"Authorization": "Bearer %s", "note": "key %s and phc_TESTabcdef123456 and sk-ant-api03-TESTTESTTEST"}' % (SECRET, SECRET))
ok("python redaction masks phx_/phc_/Bearer/sk-ant", "TESTa1B2" not in txt and "TESTabcdef" not in txt and "TESTTESTTEST" not in txt and "phx_[REDACTED]" in txt, txt)
js = "import {makeRedactor} from '%s/lib/redact.mjs'; const r = makeRedactor([process.argv[1]]); process.stdout.write(r(JSON.stringify({headers:{authorization:'Bearer '+process.argv[1]}, body:'token '+process.argv[1]+' phc_TESTabcdef123456'})));" % ROOT
out = subprocess.run(["node", "--input-type=module", "-e", js, SECRET], capture_output=True, text=True).stdout
ok("node redaction masks the key everywhere", out and "TESTa1B2" not in out and "TESTabcdef" not in out and "[REDACTED]" in out, out)

# ---- checker command line on a saved snapshot (no network) -----------------------------------------------------------
fresh(); do_c()
tmp = tempfile.mkdtemp(prefix="pa-test-")
state_file = os.path.join(ROOT, "state", "seed-%s.json" % N)
try:
    os.makedirs(os.path.dirname(state_file), exist_ok=True)
    json.dump(base, open(state_file, "w"))
    json.dump(live(), open(os.path.join(tmp, "final-state.json"), "w"))
    open(os.path.join(tmp, "answer.md"), "w").write("done")
    p = subprocess.run([sys.executable, "-I", "-B", os.path.join(ROOT, "bench", "checkers", "check_c.py"), "--nonce", N, "--run-tag", R, "--run-dir", tmp,
                        "--from-snapshot", os.path.join(tmp, "final-state.json")], capture_output=True, text=True)
    cj = json.load(open(os.path.join(tmp, "checker.json"))) if os.path.exists(os.path.join(tmp, "checker.json")) else {}
    ok("checker CLI writes checker.json with the verdict", p.returncode == 0 and cj.get("correct") is True and cj.get("task") == "c-flag-rollout-change", p.stdout + p.stderr)
finally:
    if os.path.exists(state_file): os.remove(state_file)

# ---- driver: run directory, append-only log, statuses, budget arithmetic (agent, server and seed are stubbed) ---------------
import run_bench as RB
series = os.path.join(tmp, "series"); log1, log2 = os.path.join(series, "RUNS.jsonl"), os.path.join(tmp, "ALL.jsonl")
scenario = {"agent_rc": 0, "cost": 0.42, "correct": True, "seed_rc": 0}


def fake_sh(cmd, logpath, timeout, env=None):
    joined = " ".join(cmd)
    if "seed/seed.py" in joined: return scenario["seed_rc"]
    out = cmd[cmd.index("--out") + 1] if "--out" in cmd else cmd[cmd.index("--run-dir") + 1]
    if "bench-agent.mjs" in joined:
        if scenario["agent_rc"] in (0, 5):
            json.dump({"cost_usd": scenario["cost"], "turns": 7, "wall_seconds": 30, "subtype": "success", "tokens": {}, "counts": {"tool_calls": 6}, "api_key_source": "ANTHROPIC_API_KEY"}, open(os.path.join(out, "metrics.json"), "w"))
        return scenario["agent_rc"]
    if "check_" in joined:
        json.dump({"correct": scenario["correct"], "criteria": {"x": scenario["correct"]}}, open(os.path.join(out, "checker.json"), "w")); return 0
    return 0


class FakeProc:
    def __init__(self, *a, **k): pass
    def poll(self): return 0


RB.sh, RB.wait_http, RB.subprocess.Popen, RB.subprocess.run = fake_sh, (lambda url, s: True), FakeProc, (lambda *a, **k: None)
entry = {"run_seq": 3, "run_id": "P-b-baseline-r1", "task": "b-insight-rename", "build": "baseline", "repetition": 1, "run_tag": "r003", "model": "m", "max_turns": 40}
cfgd = {"MCP_SERVER_PORT": "1", "MCP_PROXY_PORT": "2", "POSTHOG_KEY_FILE": "x", "POSTHOG_PROJECT_ID": "1", "MCP_MODE": "cli"}
rec = RB.run_one(entry, N, cfgd, series, 1, True, [log1, log2], {})
ok("driver: completed run recorded", rec["status"] == "completed" and rec["correct"] is True and rec["cost_usd"] == 0.42, str(rec))
ok("driver: start and finish lines in both logs", [l["event"] for l in RB.read_lines(log1)] == ["run_started", "run_finished"] and len(RB.read_lines(log2)) == 2)
try:
    RB.run_one(entry, N, cfgd, series, 1, True, [log1, log2], {}); reused = True
except FileExistsError:
    reused = False
ok("driver: an existing run directory is never reused", not reused)
scenario.update(agent_rc=3); rec = RB.run_one(entry, N, cfgd, series, 2, True, [log1, log2], {})
ok("driver: billing-guard abort is fatal and logged", rec["status"] == "billing_guard_abort" and rec.get("fatal") is True and rec["cost_usd"] is None)
scenario.update(agent_rc=5, correct=False); rec = RB.run_one(entry, N, cfgd, series, 3, True, [log1, log2], {})
ok("driver: failed agent run is kept as agent_error", rec["status"] == "agent_error" and rec["correct"] is False)
scenario.update(agent_rc=0, seed_rc=1); rec = RB.run_one(entry, N, cfgd, series, 4, True, [log1, log2], {})
ok("driver: reset failure stops before any agent spend", rec["status"] == "reset_before_failed" and rec["cost_usd"] is None)
lines = RB.read_lines(log1)
ok("driver: log only grew (4 attempts, 8 lines, failures kept)", len(lines) == 8 and [l.get("attempt") for l in lines if l["event"] == "run_finished"] == [1, 2, 3, 4])
ok("driver: spent sums reported cost of finished runs", RB.spent(lines) == 0.84 and RB.over_budget(lines, 0.5) and not RB.over_budget(lines, 40))
ok("driver: every run directory has its own run-record.json", all(os.path.exists(os.path.join(series, d, "run-record.json")) for d in os.listdir(series) if d.startswith("run-")))

# ---- plan --------------------------------------------------------------------------------------------------------------
import _make_plan as MP
pl = MP.make(12345); rr = pl["runs"]
ok("plan: 36 runs, 18 per build, 3 per task and build", len(rr) == 36 and all(sum(1 for r in rr if r["build"] == b) == 18 for b in MP.BUILDS) and all(sum(1 for r in rr if r["task"] == t[1] and r["build"] == b) == 3 for t in MP.TASKS for b in MP.BUILDS))
ok("plan: builds alternate inside every pair, same task", all(rr[i]["task"] == rr[i + 1]["task"] and rr[i]["build"] != rr[i + 1]["build"] for i in range(0, 36, 2)))
ok("plan: baseline goes first in exactly half of the pairs", sum(1 for i in range(0, 36, 2) if rr[i]["build"] == "baseline") == 9)
ok("plan: same seed gives the same order, another seed a different one", MP.make(12345) == pl and MP.make(54321)["runs"] != rr)
ok("plan: run tags are unique", len({r["run_tag"] for r in rr}) == 36)

# ---- fixture set v2 (friction-derived tasks g-l) -----------------------------------------------------------------------
ok("v1 fixtures: spec(n) is spec(n, 'v1') and holds no surveys or annotations", S.spec(N) == S.spec(N, "v1") and not S.spec(N)["surveys"] and not S.spec(N)["annotations"])
sp1, sp2 = S.spec(N, "v1"), S.spec(N, "v2")
ok("v2 fixtures contain every v1 object unchanged", all(x in sp2[k] for k in ("insights", "dashboards", "flags") for x in sp1[k]))
ok("v2 fixtures keep task d's flag set (only fixture flags start with flag-)", [f["key"] for f in sp2["flags"] if f["key"].startswith(PRE + "flag-")] == [f["key"] for f in sp1["flags"]])
ok("v2 fixtures keep task f's triage set", [i["name"] for i in sp2["insights"] if i["name"].startswith(PRE + "triage-")] == [i["name"] for i in sp1["insights"] if i["name"].startswith(PRE + "triage-")])
ok("v1 normalisation unchanged by the survey support (no surveys key without surveys)", "surveys" not in norm)
fake2 = Fake(); ph2 = client(fake2); ph2.guard(quiet=True)
fake2.db["surveys"].append({"id": 3, "name": "Customer NPS", "questions": [], "archived": False})
SEED.ensure(ph2, N, out=io.StringIO(), fixtures="v2")
snap2 = ST.snapshot(ph2, N); norm2 = ST.normalize(snap2); h2 = ST.sha(norm2)
ok("v2 seed: counts", {k: sum(len(v) for v in norm2.get(k, {}).values()) for k in ("insights", "dashboards", "flags", "surveys")} == {k: len(sp2[k]) for k in ("insights", "dashboards", "flags", "surveys")} and len(norm2["annotations"]) == 5, str({k: len(norm2.get(k, {})) for k in norm2}))
ok("v2 seed: survey question ids are not in the normalised state", all("id" not in q for q in norm2["surveys"][PRE + "onboarding-survey"][0]["questions"]))
ok("v2 seed: tmp insights 1-3 are on the tmp board", norm2["dashboards"][PRE + "tmp-board"][0]["tiles"] == [PRE + "tmp-01", PRE + "tmp-02", PRE + "tmp-03"])
ok("v2 second ensure is a no-op", SEED.ensure(ph2, N, norm2, out=io.StringIO(), fixtures="v2") == 0)
base2 = {"n12": N, "expected_sha256": h2, "normalized": norm2, "ids": ST.ids(snap2), "fixtures": "v2"}
db2 = lambda kind, field, value: next(r for r in fake2.db[kind] if r.get(field) == value and not r.get("deleted"))
# a v2 mess: the survey archived and a question changed, a seeded annotation deleted and one moved, the flag's variants
# changed, a tmp insight deleted, the board deleted, a run survey created
sv = db2("surveys", "name", PRE + "onboarding-survey"); sv["archived"] = True; sv["questions"][1]["question"] = "changed"
db2("annotations", "content", sp2["annotations"][0]["content"])["deleted"] = True
db2("annotations", "content", sp2["annotations"][1]["content"])["date_marker"] = "2020-01-01T00:00:00Z"
db2("feature_flags", "key", PRE + "checkout-banner")["filters"]["multivariate"]["variants"].append({"key": "x", "rollout_percentage": 0})
db2("insights", "name", PRE + "tmp-04")["deleted"] = True; db2("dashboards", "name", PRE + "tmp-board")["deleted"] = True
ph2.post("surveys/", {"name": PRE + R + "-extra", "questions": []})
ok("v2 state differs after the mess", ST.sha(ST.normalize(ST.snapshot(ph2, N))) != h2)
SEED.ensure(ph2, N, norm2, out=io.StringIO(), fixtures="v2")
after = ST.snapshot(ph2, N)
ok("v2 reset restores the seeded state hash", ST.sha(ST.normalize(after)) == h2)
ok("v2 reset restores the moved annotation's time", next(a for a in after["annotations"] if a["content"] == sp2["annotations"][1]["content"])["date_marker"] == sp2["annotations"][1]["date_marker"])
ok("v2 reset deleted the run's survey and left the foreign one", [r["name"] for r in fake2.db["surveys"]] == ["Customer NPS", PRE + "onboarding-survey"])
base2["ids"] = ST.ids(after); BASE2 = copy.deepcopy(fake2.db)
def fresh2(): fake2.db = copy.deepcopy(BASE2)
def verdict2(mod, answer=""):
    c_, _ = mod.evaluate(ST.snapshot(ph2, N), base2, {"n12": N, "run_tag": R, "P": PRE, "answer": answer})
    return c_, all(v is True for v in c_.values())
for mod in (check_a, check_b, check_c, check_d, check_e, check_f, check_g, check_h, check_i, check_j, check_k, check_l):
    fresh2(); c, good = verdict2(mod)
    ok("%s on v2 fixtures, negative control: untouched seed is not correct" % mod.__name__, not good)
    ok("%s on v2 fixtures, negative control: collateral clean (seeded annotations and the survey are not extras)" % mod.__name__, c.get("nothing_else_changed", c.get("nothing_changed")) is True, str(c))
# g
def do_g(funnel=("$pageview", "signup_started", "signup_completed"), sql=check_g.SQL, attach=5, math="dau", sql_filters=None):
    fresh2(); code, d = ph2.post("dashboards/", {"name": PRE + R + "-product-overview", "description": "Signups, conversion and retention"})
    ev = lambda e: {"kind": "EventsNode", "event": e}
    qs = [("daily-signups", {"kind": "InsightVizNode", "source": {"kind": "TrendsQuery", "series": [dict(ev("signup_completed"), math="total")], "interval": "day", "dateRange": {"date_from": "-30d"}}}),
          ("signup-funnel", {"kind": "InsightVizNode", "source": {"kind": "FunnelsQuery", "series": [ev(e) for e in funnel]}}),
          ("signup-retention", {"kind": "InsightVizNode", "source": {"kind": "RetentionQuery", "retentionFilter": {"period": "Week", "targetEntity": {"id": "signup_completed", "type": "events"}, "returningEntity": {"id": "app_opened", "type": "events"}}}}),
          ("top-events", {"kind": "DataVisualizationNode", "source": dict({"kind": "HogQLQuery", "query": sql}, **({"filters": sql_filters} if sql_filters else {}))}),
          ("weekly-visitors", {"kind": "InsightVizNode", "source": {"kind": "TrendsQuery", "series": [dict(ev("$pageview"), math=math)], "interval": "week", "dateRange": {"date_from": "-90d"}}})]
    for i, (nm, q) in enumerate(qs):
        ph2.post("insights/", {"name": PRE + R + "-" + nm, "query": q, "dashboards": [d["id"]] if i < attach else []})
do_g(); c, good = verdict2(check_g); ok("g correct state passes", good, str(c))
do_g(sql=check_g.SQL.lower().replace(" from ", "\n  FROM ") + ";"); c, good = verdict2(check_g); ok("g same SQL typed differently passes", good, str(c))
do_g(funnel=("signup_started", "signup_completed")); c, good = verdict2(check_g); ok("g two-step funnel fails", not good and c["funnel_query"] is False)
do_g(sql=check_g.SQL_PLACEHOLDER, sql_filters={"dateRange": {"date_from": "-7d", "explicitDate": False}}); c, good = verdict2(check_g); ok("g {filters} placeholder with a 7-day dateRange passes (PostHog's own instruction)", good, str(c))
do_g(sql=check_g.SQL_PLACEHOLDER); c, good = verdict2(check_g); ok("g {filters} placeholder without a dateRange fails", not good and c["sql_query"] is False)
do_g(sql=check_g.SQL_PLACEHOLDER, sql_filters={"dateRange": {"date_from": "-30d"}}); c, good = verdict2(check_g); ok("g {filters} placeholder with a 30-day window fails", not good and c["sql_query"] is False)
do_g(sql=check_g.SQL_PLACEHOLDER, sql_filters={"dateRange": {"date_from": "-7d", "date_to": "-1d"}}); c, good = verdict2(check_g); ok("g {filters} placeholder with an end date fails", not good and c["sql_query"] is False)
do_g(attach=4); c, good = verdict2(check_g); ok("g a tile missing fails", not good and c["dashboard_has_exactly_the_five_insights"] is False)
do_g(sql="SELECT event FROM events"); c, good = verdict2(check_g); ok("g other SQL fails", not good and c["sql_query"] is False)
do_g(math="total"); c, good = verdict2(check_g); ok("g total instead of unique users fails", not good and c["weekly_visitors_query"] is False)
# h
def do_h(which=range(1, 11), replace=False, notes=check_h.NOTES, scope="project", dup=False):
    fresh2(); tag = "%s%s-retired" % (PRE, R)
    for i in which:
        r_ = db2("insights", "name", PRE + "legacy-%02d" % i); r_["tags"] = [tag] if replace else r_["tags"] + [tag]
    for when, text in list(notes) + ([notes[0]] if dup else []):
        ph2.post("annotations/", {"content": "%s%s %s" % (PRE, R, text), "date_marker": when, "scope": scope})
do_h(); c, good = verdict2(check_h); ok("h correct state passes", good, str(c))
do_h(replace=True); c, good = verdict2(check_h); ok("h existing tags lost fails", not good and c["legacy_tags_exact"] is False)
do_h(which=range(1, 10)); c, good = verdict2(check_h); ok("h one insight missed fails", not good and c["legacy_have_new_tag"] is False)
do_h(dup=True); c, good = verdict2(check_h); ok("h duplicate annotation fails", not good and c["eight_annotations_one_each"] is False)
do_h(notes=[(("2026-10-01T10:00:00Z" if t.startswith("2026-10-01") else t), x) for t, x in check_h.NOTES]); c, good = verdict2(check_h); ok("h wrong time fails", not good and c["annotation_times_exact"] is False)
do_h(scope="organization"); c, good = verdict2(check_h); ok("h not project-wide fails", not good and c["annotations_project_wide"] is False)
do_h(); db2("insights", "name", PRE + "triage-02")["tags"] = []; c, good = verdict2(check_h); ok("h neighbour changed fails", not good and c["nothing_else_changed"] is False)
# i
def do_i(variants=(("control", 34), ("test", 33), ("test-b", 33)), groups=None, active=True):
    fresh2(); f = db2("feature_flags", "key", PRE + "checkout-banner"); names = {"control": "Control", "test": "Test"}
    f["filters"]["multivariate"]["variants"] = [dict({"key": k, "rollout_percentage": p_}, **({"name": names[k]} if k in names else {})) for k, p_ in variants]
    if groups is not None: f["filters"]["groups"] = groups
    f["active"] = active
do_i(); c, good = verdict2(check_i); ok("i correct state passes", good, str(c))
do_i(variants=(("control", 50), ("test", 50), ("test-b", 0))); c, good = verdict2(check_i); ok("i split not changed fails", not good and c["variants_exact"] is False)
do_i(groups=[{"properties": [], "rollout_percentage": 100}]); c, good = verdict2(check_i); ok("i conditions lost fails", not good and c["release_conditions_unchanged"] is False)
do_i(active=False); c, good = verdict2(check_i); ok("i flag disabled fails", not good and c["flag_still_enabled"] is False)
# dry run 2026-11-10 run d019: an MCP tool schema filled in early_exit=false (PostHog's default) on the update
do_i(); db2("feature_flags", "key", PRE + "checkout-banner")["filters"]["early_exit"] = False; c, good = verdict2(check_i); ok("i default early_exit=false counts as unchanged", good, str(c))
do_i(); db2("feature_flags", "key", PRE + "checkout-banner")["filters"]["early_exit"] = True; c, good = verdict2(check_i); ok("i early_exit=true fails", not good and c["other_filter_fields_unchanged"] is False)
for ee in (False, True):
    fresh2(); fl_ = db2("feature_flags", "key", PRE + "checkout-banner"); fl_["filters"]["early_exit"] = ee; fl_["filters"]["multivariate"]["variants"].append({"key": "y", "rollout_percentage": 0})
    SEED.ensure(ph2, N, norm2, out=io.StringIO(), fixtures="v2")
    ok("reset restores the seeded hash after early_exit=%s was stored" % ee, ST.sha(ST.normalize(ST.snapshot(ph2, N))) == h2)
    ok("reset leaves early_exit false after early_exit=%s" % ee, db2("feature_flags", "key", PRE + "checkout-banner")["filters"].get("early_exit") is False)
# j
def do_j(texts=(None, check_j.NEW_TEXT, None), archived=False, drop_choice=False):
    fresh2(); sv_ = db2("surveys", "name", PRE + "onboarding-survey")
    for q_, t_ in zip(sv_["questions"], texts):
        if t_: q_["question"] = t_
    if drop_choice: sv_["questions"][1]["choices"] = sv_["questions"][1]["choices"][:3]
    sv_["archived"] = archived
do_j(); c, good = verdict2(check_j); ok("j correct state passes", good, str(c))
do_j(texts=(None, None, None)); c, good = verdict2(check_j); ok("j text not changed fails", not good and c["second_question_text"] is False)
do_j(texts=("x", check_j.NEW_TEXT, None)); c, good = verdict2(check_j); ok("j another question changed fails", not good and c["first_and_third_unchanged"] is False)
do_j(drop_choice=True); c, good = verdict2(check_j); ok("j a choice lost fails", not good and c["second_question_otherwise_unchanged"] is False)
do_j(archived=True); c, good = verdict2(check_j); ok("j archived survey fails", not good and c["not_archived"] is False)
fresh2(); old_sv = db2("surveys", "name", PRE + "onboarding-survey"); fake2.db["surveys"].remove(old_sv); body_ = copy.deepcopy(old_sv); body_.pop("id"); body_["questions"][1]["question"] = check_j.NEW_TEXT; ph2.post("surveys/", body_)
c, good = verdict2(check_j); ok("j delete-and-recreate fails", not good and c["same_object_not_recreated"] is False)
# k
def do_k(first="$pageview", date_from="-30d", keep_breakdown=True, drop_names=False, funnels_extra=None):
    fresh2(); r_ = db2("insights", "name", PRE + "signup-funnel"); q_ = copy.deepcopy(r_["query"]); src_ = q_["source"]
    steps = [{"kind": "EventsNode", "event": first}] + ([{k: v for k, v in s_.items() if k != "name"} for s_ in src_["series"]] if drop_names else src_["series"])
    src_["series"] = steps; src_["dateRange"] = {"date_from": date_from}
    if not keep_breakdown: src_.pop("breakdownFilter")
    if funnels_extra: src_["funnelsFilter"] = dict(src_.get("funnelsFilter") or {}, **funnels_extra)
    r_.update(name=PRE + "signup-funnel-3-step", query=q_)
do_k(); c, good = verdict2(check_k); ok("k correct state passes", good, str(c))
do_k(drop_names=True); c, good = verdict2(check_k); ok("k step display names dropped still passes", good, str(c))
do_k(first="signup_started"); c, good = verdict2(check_k); ok("k wrong first step fails", not good and c["three_steps_in_order"] is False)
do_k(date_from="-7d"); c, good = verdict2(check_k); ok("k date range not changed fails", not good and c["date_range_last_30_days"] is False)
do_k(keep_breakdown=False); c, good = verdict2(check_k); ok("k breakdown lost fails", not good and c["breakdown_window_and_filters_unchanged"] is False)
# dry run 2026-11-10 runs d004-d006: PostHog filled in FunnelsFilter's documented defaults on save, on every build
DEFAULTS_SEEN = {"breakdownAttributionType": "first_touch", "exclusions": [], "funnelOrderType": "ordered", "funnelStepReference": "total", "layout": "vertical",
                 "legendPosition": "bottom", "showAnnotations": True, "showLegend": False, "showValuesOnSeries": False, "hideIncompleteConversionWindowPeriods": False}
do_k(funnels_extra=DEFAULTS_SEEN); c, good = verdict2(check_k); ok("k FunnelsFilter defaults filled in on save still pass", good, str(c))
do_k(funnels_extra={"funnelWindowInterval": 7}); c, good = verdict2(check_k); ok("k conversion window changed fails", not good and c["breakdown_window_and_filters_unchanged"] is False)
do_k(funnels_extra={"funnelOrderType": "strict"}); c, good = verdict2(check_k); ok("k step order type changed fails", not good and c["breakdown_window_and_filters_unchanged"] is False)
# l
def do_l(skip_annotations=0, template=False, board=True):
    fresh2()
    for n in sp2["tmp_objects"]["insights"]: db2("insights", "name", n)["deleted"] = True
    if board: db2("dashboards", "name", PRE + "tmp-board")["deleted"] = True
    for a_ in sp2["tmp_objects"]["annotations"][skip_annotations:]: db2("annotations", "content", a_)["deleted"] = True
    if template: db2("insights", "name", PRE + "tmpl-weekly")["deleted"] = True
do_l(); c, good = verdict2(check_l, "DELETED: 12\n\n```json\n{\"extra_calls\": []}\n```"); ok("l correct state passes", good, str(c))
do_l(skip_annotations=2); c, good = verdict2(check_l, "DELETED: 10"); ok("l annotations left fails", not good and c["tmp_annotations_gone"] is False)
do_l(template=True); c, good = verdict2(check_l, "DELETED: 13"); ok("l near-miss template deleted fails", not good and c["template_kept"] is False and c["nothing_else_changed"] is False)
do_l(board=False); c, good = verdict2(check_l, "DELETED: 11"); ok("l board left fails", not good and c["tmp_dashboard_gone"] is False)
do_l(); c, good = verdict2(check_l, "I deleted twelve objects."); ok("l missing DELETED line fails", not good and c["deleted_line_present_once"] is False)
# cleanup reaches surveys (hard delete) and seeded annotations
fresh2(); snap_ = ST.snapshot(ph2, N)
for v_ in snap_["surveys"]: ph2.delete("surveys/%s/" % v_["id"])
ok("cleanup: a survey is removed by DELETE and the foreign one stays", [r["name"] for r in fake2.db["surveys"]] == ["Customer NPS"])

# ---- three-build series plans ------------------------------------------------------------------------------------------
scfg = {"series": "test-series", "builds": ["baseline", "fixed", "usability"], "task_sets": ["pre-registered", "friction-derived"], "repetitions": 3, "model": "m"}
import _make_plan as MP
sp_ = MP.make_series(scfg, 777); rr3 = sp_["runs"]; tasks12 = [t["id"] for s_ in MP.task_sets()["sets"].values() for t in s_["tasks"]]
ok("series plan: 108 runs, 36 per build, 3 per task and build", len(rr3) == 108 and all(sum(1 for r in rr3 if r["build"] == b) == 36 for b in scfg["builds"]) and all(sum(1 for r in rr3 if r["task"] == t and r["build"] == b) == 3 for t in tasks12 for b in scfg["builds"]))
ok("series plan: each task's three builds run back to back", all(len({rr3[i + j]["task"] for j in range(3)}) == 1 and {rr3[i + j]["build"] for j in range(3)} == set(scfg["builds"]) for i in range(0, 108, 3)))
ok("series plan: every build order used 6 times, every build first 12 times", sp_["first_build_counts"] == {"baseline": 12, "fixed": 12, "usability": 12}
   and len(set(tuple(rr3[i + j]["build"] for j in range(3)) for i in range(0, 108, 3))) == 6
   and all(sum(1 for i in range(0, 108, 3) if tuple(rr3[i + j]["build"] for j in range(3)) == o) == 6 for o in set(tuple(rr3[i + j]["build"] for j in range(3)) for i in range(0, 108, 3))))
ok("series plan: every run is marked with its task set", all(r["task_set"] == ("pre-registered" if r["task"][0] in "abcdef" else "friction-derived") for r in rr3))
ok("series plan: max turns from the registry (60 for a, f, g, h, l; 40 otherwise)", all(r["max_turns"] == (60 if r["task"][0] in "afghl" else 40) for r in rr3))
ok("series plan: deterministic per seed, unique run tags", MP.make_series(scfg, 777) == sp_ and MP.make_series(scfg, 778)["runs"] != rr3 and len({r["run_tag"] for r in rr3}) == 108)
dp = MP.make_series(scfg, 99, dry=True)["runs"]
ok("dry-run plan: one repetition, every task once on every build, d-tags, not a measured repetition", len(dp) == 36 and all(r["repetition"] == 0 and r["run_tag"].startswith("d") for r in dp) and {(r["task"], r["build"]) for r in dp} == {(t, b) for t in tasks12 for b in scfg["builds"]})
ok("legacy two-build plan unchanged (same seed, same plan as before)", MP.make(12345)["runs"][0]["run_id"] == pl["runs"][0]["run_id"] and MP.make(12345)["planned_runs"] == 36)

print("%d passed, %d failed" % (passed, failed))
sys.exit(1 if failed else 0)
