"""One-time setup of the local test account, through the instance's own signup API on loopback (stdlib only).
  python3 -I -B local/create-account.py
  PH_SESSION_COOKIE=<name=value> python3 -I -B local/create-account.py --resume   (signup already done, key not yet made:
      a session for the account is minted inside the web container with Django's test client force_login, handed over in
      the environment only, so the stored password is never read back)
Creates the organisation "IsoKron Bench" (signup also creates its first project), renames that project, and creates a
project-scoped personal API key with the scopes of PostHog's "MCP Server" key preset at the pinned commit
(local/mcp-server-preset-scopes.json). The password and key are generated here and written only to
.secrets/credentials and .secrets/api-key (mode 600, refusing to overwrite). Prints ids, never a secret.
No real person: the user is a placeholder on the reserved .test domain."""
import http.cookiejar, json, os, secrets, sys, urllib.request

BASE = "http://127.0.0.1:8010"
HERE = os.path.dirname(os.path.abspath(__file__)); TOP = os.path.dirname(HERE)
SEC = os.path.join(TOP, ".secrets")
EMAIL = "bench-owner@isokron-bench.test"
RESUME = "--resume" in sys.argv
for f in (("api-key",) if RESUME else ("credentials", "api-key")):
    if os.path.exists(os.path.join(SEC, f)):
        sys.exit(".secrets/%s already exists: refusing to overwrite" % f)
if RESUME and not os.path.exists(os.path.join(SEC, "credentials")):
    sys.exit("--resume: .secrets/credentials is missing (no signup to resume)")

jar = http.cookiejar.CookieJar()
op = urllib.request.build_opener(urllib.request.HTTPCookieProcessor(jar))


def call(method, path, body=None):
    h = {"Accept": "application/json", "Content-Type": "application/json", "Origin": BASE, "Referer": BASE + "/"}
    tok = next((c.value for c in jar if c.name.endswith("csrftoken")), None)
    if tok: h["X-CSRFToken"] = tok
    req = urllib.request.Request(BASE + path, data=json.dumps(body).encode() if body is not None else None, method=method, headers=h)
    try:
        with op.open(req, timeout=60) as r:
            raw = r.read(); return r.status, (json.loads(raw) if raw and raw[:1] in b"{[" else None)
    except urllib.error.HTTPError as e:
        raw = e.read(); return e.code, raw.decode("utf-8", "replace")[:400]


code, pf = call("GET", "/_preflight/")
print("preflight HTTP %s initiated=%s cloud=%s can_create_org=%s" % (code, pf.get("initiated"), pf.get("cloud"), pf.get("can_create_org")))
os.umask(0o077)
if RESUME:
    name, _, value = os.environ.get("PH_SESSION_COOKIE", "").partition("=")
    if not value: sys.exit("--resume needs PH_SESSION_COOKIE in the environment")
    jar.set_cookie(http.cookiejar.Cookie(0, name, value, None, False, "127.0.0.1", False, False, "/", True, False, None, False, None, None, {}))
else:
    password = secrets.token_urlsafe(24)
    code, r = call("POST", "/api/signup/", {"first_name": "Bench", "last_name": "Owner", "email": EMAIL, "password": password,
                                            "organization_name": "IsoKron Bench", "role_at_organization": "engineering"})
    if code not in (200, 201): sys.exit("signup failed: HTTP %s %s" % (code, r))
    os.makedirs(SEC, mode=0o700, exist_ok=True)
    with open(os.path.join(SEC, "credentials"), "x") as f:  # password first, so it is never lost even if a later step fails
        f.write("# local test account of the IsoKron PostHog instance (http://127.0.0.1:8010). Not a real person.\nemail=%s\npassword=%s\n" % (EMAIL, password))
call("GET", "/")  # sets the CSRF cookie
code, me = call("GET", "/api/users/@me/")
if code != 200: sys.exit("users/@me failed: HTTP %s %s" % (code, me))
org_id = me["organization"]["id"]; team = me["team"]; project_id = team.get("project_id", team["id"])
if me["team"].get("name") != "IsoKron Bench project" or not RESUME:
    code, r = call("PATCH", "/api/projects/%s/" % project_id, {"name": "IsoKron Bench project"})
    print("rename project HTTP %s" % code)
scopes = json.load(open(os.path.join(HERE, "mcp-server-preset-scopes.json")))["scopes"]
code, k = call("POST", "/api/personal_api_keys/", {"label": "isokron-bench-mcp-server-preset", "scopes": scopes,
                                                   "scoped_teams": [team["id"]], "scoped_organizations": []})
if code not in (200, 201) or not isinstance(k, dict) or not k.get("value"): sys.exit("personal API key creation failed: HTTP %s %s" % (code, str(k)[:300]))
with open(os.path.join(SEC, "api-key"), "x") as f:
    f.write(k["value"] + "\n")
with open(os.path.join(SEC, "credentials"), "a") as f:
    f.write("personal_api_key_id=%s\npersonal_api_key=%s\n" % (k["id"], k["value"]))
for f in ("credentials", "api-key"): os.chmod(os.path.join(SEC, f), 0o600)
print(json.dumps({"organization_id": org_id, "organization_name": me["organization"]["name"], "project_id": project_id, "team_id": team["id"],
                  "personal_api_key_id": k["id"], "key_scopes": len(k.get("scopes") or []), "key_scoped_teams": k.get("scoped_teams"),
                  "secrets_written": [".secrets/credentials", ".secrets/api-key"]}))
