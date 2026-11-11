"""Protocol smoke test through the loopback proxy: initialize + tools/list (by default no tool is called, nothing is written).
usage: python3 -I -B server/smoke.py [--port N] [--out FILE] [--exec "info <tool>"]... [--read-call "<tool> <json>"]...
                                     [--write-roundtrip N12]
  --exec          catalog-only exec commands (help/tools/search/info/schema)
  --read-call     `call <tool> <json>` for READ-ONLY tools only (name must end in -list, -get, -retrieve or start with query-,
                  or be read-data-schema, the read-only taxonomy read used to check that an instance holds no stray events)
  --write-roundtrip N12   one harmless write and its undo: annotation-create with content bench-<N12>-smoke-<random>, then
                  annotation-delete of the id it returned (needs the TARGET=selfhosted proxy; refused otherwise)
Prints the tool count, names and schema sizes, and each call's isError flag and size."""
import argparse, json, os, re, secrets, sys, urllib.request
ap = argparse.ArgumentParser(); ap.add_argument("--port", type=int, default=8792); ap.add_argument("--out")
ap.add_argument("--exec", action="append", default=[], help="catalog-only exec command (help/tools/search/info/schema); `call` is refused")
ap.add_argument("--read-call", action="append", default=[], help="read-only tool call: '<tool> <json>'")
ap.add_argument("--write-roundtrip", metavar="N12", help="create + delete one bench-<N12>-smoke annotation (selfhosted only)")
ap.add_argument("--print-limit", type=int, default=4000)
a = ap.parse_args()
URL = "http://127.0.0.1:%d/mcp" % a.port

def rpc(body, sid=None):
    h = {"content-type": "application/json", "accept": "application/json, text/event-stream"}
    if sid: h["mcp-session-id"] = sid
    req = urllib.request.Request(URL, data=json.dumps(body).encode(), headers=h, method="POST")
    try:
        r = urllib.request.urlopen(req, timeout=60)
    except urllib.error.HTTPError as e:
        return e.code, e.read().decode("utf-8", "replace")[:500], None
    raw = r.read().decode("utf-8", "replace"); sid = r.headers.get("mcp-session-id")
    if "text/event-stream" in (r.headers.get("content-type") or ""):
        datas = [l[5:].strip() for l in raw.splitlines() if l.startswith("data:")]
        raw = datas[-1] if datas else "{}"
    return r.status, (json.loads(raw) if raw.strip() else None), sid

code, init, sid = rpc({"jsonrpc": "2.0", "id": 1, "method": "initialize", "params": {"protocolVersion": "2025-06-18", "capabilities": {}, "clientInfo": {"name": "isokron-smoke", "version": "0"}}})
if code != 200: sys.exit("initialize failed: HTTP %s %s" % (code, init))
res = init.get("result", {})
print("initialize ok: server=%s protocol=%s session=%s instructions_bytes=%d" % (json.dumps(res.get("serverInfo")), res.get("protocolVersion"), "yes" if sid else "none", len(res.get("instructions") or "")))
rpc({"jsonrpc": "2.0", "method": "notifications/initialized"}, sid)
code, tl, _ = rpc({"jsonrpc": "2.0", "id": 2, "method": "tools/list", "params": {}}, sid)
if code != 200 or "result" not in (tl or {}): sys.exit("tools/list failed: HTTP %s %s" % (code, str(tl)[:400]))
tools = tl["result"]["tools"]
total = len(json.dumps(tools))
print("tools/list ok: %d tool(s), %d bytes of definitions (about %d tokens at 4 bytes/token)" % (len(tools), total, total // 4))
for t in tools[:40]:
    print("  %-40s description=%d bytes  inputSchema=%d bytes" % (t["name"], len(t.get("description") or ""), len(json.dumps(t.get("inputSchema") or {}))))
if a.out:
    json.dump({"initialize": res, "tools": tools}, open(a.out, "w"), indent=1)

for i, cmd in enumerate(a.exec):
    if cmd.split()[0] not in ("help", "tools", "search", "info", "schema"):
        sys.exit("refused: only catalog commands (help/tools/search/info/schema) are allowed here, not %r" % cmd.split()[0])
    code, r, _ = rpc({"jsonrpc": "2.0", "id": 10 + i, "method": "tools/call", "params": {"name": "exec", "arguments": {"command": cmd, "context": "harness catalog smoke test"}}}, sid)
    txt = "\n".join(c.get("text", "") for c in ((r or {}).get("result", {}).get("content") or [])) if isinstance(r, dict) else str(r)
    print("=== exec %s -> HTTP %s isError=%s bytes=%d" % (cmd, code, (r or {}).get("result", {}).get("isError") if isinstance(r, dict) else None, len(txt)))
    print(txt)


def call(cmd, i):
    code, r, _ = rpc({"jsonrpc": "2.0", "id": 100 + i, "method": "tools/call", "params": {"name": "exec", "arguments": {"command": cmd, "context": "harness smoke test"}}}, sid)
    txt = "\n".join(c.get("text", "") for c in ((r or {}).get("result", {}).get("content") or [])) if isinstance(r, dict) else str(r)
    err = (r or {}).get("result", {}).get("isError") if isinstance(r, dict) else None
    print("=== exec %s -> HTTP %s isError=%s bytes=%d" % (cmd[:160], code, err, len(txt)))
    print(txt[:a.print_limit])
    return code, err, txt


READ_OK = re.compile(r"^(?:[a-z0-9-]+-(?:list|get|retrieve|get-all)|query-[a-z0-9-]+|read-data-schema)$")
for i, rc in enumerate(a.read_call):
    tool = rc.split()[0]
    if not READ_OK.match(tool) or "delete" in tool or "update" in tool or "create" in tool:
        sys.exit("refused: %r is not a read-only tool name" % tool)
    call("call " + rc, i)

if a.write_roundtrip:
    n12 = a.write_roundtrip
    if not re.match(r"^[0-9a-f]{12}$", n12): sys.exit("--write-roundtrip needs a 12-hex nonce")
    if os.environ.get("TARGET") != "selfhosted": sys.exit("refused: the write round trip runs only with TARGET=selfhosted")
    content = "bench-%s-smoke-%s" % (n12, secrets.token_hex(3))
    body = {"content": content, "date_marker": "2026-11-10T12:00:00Z", "scope": "project"}
    code, err, txt = call("call --json annotation-create " + json.dumps(body), 900)
    m = re.search(r'"id"\s*:\s*(\d+)', txt)
    if err or not m or content not in txt:
        sys.exit("write round trip: create failed or returned no id; nothing to delete (content %s)" % content)
    aid = m.group(1)
    code, err2, txt2 = call("call --json annotation-delete " + json.dumps({"id": int(aid)}), 901)
    print("write round trip: created annotation %s (%s), delete isError=%s" % (aid, content, err2))
    if err2: sys.exit("write round trip: delete failed for annotation %s: remove it with bench/cleanup.py --nonce %s" % (aid, n12))
