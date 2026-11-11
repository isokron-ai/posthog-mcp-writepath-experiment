// Loopback proxy between the agent and the locally built PostHog MCP server.
//  - adds the PostHog personal API key (read from a file by path) so the agent process and its transcript never hold it
//  - pins the mode (x-posthog-mcp-mode) and the project (x-posthog-project-id), optional feature filter
//  - writes a redacted JSON-lines capture of every MCP request/response to a file that must not exist yet
// usage: node server/mcp-proxy.mjs --listen PORT --upstream http://127.0.0.1:PORT --key-file PATH --project-id N
//                                  --mode cli|tools [--features a,b] [--target selfhosted] --capture FILE
// Refuses a non-loopback upstream, whatever --target says; the only accepted target is selfhosted.
import http from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import { makeRedactor } from '../lib/redact.mjs';

const args = Object.fromEntries(process.argv.slice(2).reduce((a, v, i, arr) => (v.startsWith('--') ? [...a, [v.slice(2), arr[i + 1]]] : a), []));
for (const k of ['listen', 'upstream', 'key-file', 'project-id', 'mode', 'capture']) if (!args[k]) { console.error(`missing --${k}`); process.exit(2); }
if (!['cli', 'tools'].includes(args.mode)) { console.error('mode must be cli or tools'); process.exit(2); }
if (!/^\d+$/.test(args['project-id'])) { console.error('project-id must be a number'); process.exit(2); }
if (fs.existsSync(args.capture)) { console.error(`capture file ${args.capture} already exists: capture paths are never reused`); process.exit(2); }
const keyPath = args['key-file'].replace(/^~(?=\/)/, os.homedir());
if (args.target && args.target !== 'selfhosted') { console.error('target must be selfhosted'); process.exit(2); }
if (!['127.0.0.1', 'localhost', '[::1]'].includes(new URL(args.upstream).hostname)) { console.error('REFUSED: non-loopback upstream'); process.exit(2); }
let key;
try { key = fs.readFileSync(keyPath, 'utf8').split('\n')[0].trim(); } catch { console.error(`cannot read key file ${args['key-file']}`); process.exit(2); }
if (!key) { console.error('key file is empty'); process.exit(2); }
const redact = makeRedactor([key]);
const cap = fs.createWriteStream(args.capture, { flags: 'wx' });
const upstream = new URL(args.upstream);
const qs = new URLSearchParams({ mode: args.mode }); if (args.features) qs.set('features', args.features);
const PASS = ['content-type', 'accept', 'mcp-session-id', 'mcp-protocol-version', 'mcp-conversation-id', 'last-event-id', 'user-agent'];
let seq = 0;

const server = http.createServer((req, res) => {
  if (req.url === '/healthz') { res.writeHead(200, { 'content-type': 'application/json' }); res.end('{"status":"ok"}'); return; }
  if (!req.url.startsWith('/mcp')) { res.writeHead(404); res.end('not found'); return; }
  const n = ++seq, t0 = Date.now(), chunks = [];
  req.on('data', (c) => chunks.push(c));
  req.on('end', () => {
    const body = Buffer.concat(chunks);
    const headers = { authorization: `Bearer ${key}`, 'x-posthog-mcp-mode': args.mode, 'x-posthog-project-id': args['project-id'] };
    for (const h of PASS) if (req.headers[h]) headers[h] = req.headers[h];
    if (body.length) headers['content-length'] = String(body.length);
    const up = http.request({ host: upstream.hostname, port: upstream.port, path: `/mcp?${qs}`, method: req.method, headers }, (ur) => {
      const out = [];
      const h = { ...ur.headers }; delete h['www-authenticate'];
      res.writeHead(ur.statusCode, h);
      ur.on('data', (c) => { out.push(c); res.write(c); });
      ur.on('end', () => {
        res.end();
        const respText = Buffer.concat(out).toString('utf8');
        let method = null, id = null, tool = null;
        try { const j = JSON.parse(body.toString('utf8')); method = j.method ?? null; id = j.id ?? null; tool = j.params?.name ?? null; } catch {}
        cap.write(JSON.stringify({ seq: n, t: new Date(t0).toISOString(), ms: Date.now() - t0, target: args.target ?? null, upstream: `${upstream.hostname}:${upstream.port}`, http_method: req.method, rpc_method: method, rpc_id: id, tool,
          status: ur.statusCode, req_bytes: body.length, resp_bytes: Buffer.byteLength(respText),
          request: redact(body.toString('utf8')), response: redact(respText) }) + '\n');
      });
    });
    up.on('error', (e) => {
      cap.write(JSON.stringify({ seq: n, t: new Date(t0).toISOString(), ms: Date.now() - t0, proxy_error: redact(String(e.message)) }) + '\n');
      if (!res.headersSent) res.writeHead(502); res.end('upstream error');
    });
    up.end(body);
  });
});
server.listen(Number(args.listen), '127.0.0.1', () => console.log(`mcp-proxy listening on 127.0.0.1:${args.listen} -> ${upstream.host} target=${args.target ?? 'unset'} mode=${args.mode} project=${args['project-id']}${args.features ? ' features=' + args.features : ''}`));
for (const s of ['SIGTERM', 'SIGINT']) process.on(s, () => { server.close(); cap.end(() => process.exit(0)); setTimeout(() => process.exit(0), 500); });
