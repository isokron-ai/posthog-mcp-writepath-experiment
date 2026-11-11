// Preloaded into the MCP server process for TARGET=selfhosted (node --import ./server/local-runtime.mjs bundle).
//  1. Egress guard: every outgoing TCP connection is checked before it is opened. Loopback (127.0.0.1, ::1, localhost)
//     is allowed; anything else is refused with an error and never dialled. Every attempt, allowed or refused, is
//     written to stderr as one JSON line prefixed "[egress]" (the caller's server.log), and to MCP_EGRESS_LOG if set.
//     DNS lookups of non-loopback names are refused the same way, so no name reaches a resolver either.
//  2. Pinned skills archives: serves server/assets/*.zip on 127.0.0.1:MCP_ASSETS_PORT after checking them against
//     server/assets/SHA256SUMS. The server is pointed at them with POSTHOG_MCP_SKILLS_URL / POSTHOG_MCP_LOCAL_SKILLS_URL.
// Nothing here reads or sees a credential.
import crypto from 'node:crypto';
import dns from 'node:dns';
import fs from 'node:fs';
import http from 'node:http';
import net from 'node:net';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const LOOPBACK = new Set(['127.0.0.1', '::1', 'localhost', '::ffff:127.0.0.1']);
const logFile = process.env.MCP_EGRESS_LOG || '';
const counts = { allowed: 0, refused: 0 };
const record = (o) => {
  const line = JSON.stringify({ t: new Date().toISOString(), ...o });
  process.stderr.write(`[egress] ${line}\n`);
  if (logFile) { try { fs.appendFileSync(logFile, line + '\n'); } catch {} }
};
const isLoopback = (h) => h === undefined || h === null || h === '' ? true : LOOPBACK.has(String(h).replace(/^\[|\]$/g, '').toLowerCase());

// --- 1. egress guard -------------------------------------------------------------------------------------------------
const origConnect = net.Socket.prototype.connect;
net.Socket.prototype.connect = function (...args) {
  let opts = args[0];
  if (Array.isArray(opts)) opts = opts[0];                       // internal normalized form [options, cb]
  let host, port, pathName;
  if (opts && typeof opts === 'object') { host = opts.host ?? opts.hostname; port = opts.port; pathName = opts.path; }
  else if (typeof opts === 'number' || (typeof opts === 'string' && /^\d+$/.test(opts))) { port = opts; host = typeof args[1] === 'string' ? args[1] : 'localhost'; }
  else if (typeof opts === 'string') { pathName = opts; }
  if (pathName) return origConnect.apply(this, args);            // unix socket: local by definition
  if (!isLoopback(host)) {
    counts.refused++;
    record({ event: 'refused', host: String(host), port: Number(port) || null });
    const err = Object.assign(new Error(`egress refused by local-runtime guard: ${host}:${port} is not loopback`), { code: 'EGRESS_REFUSED' });
    process.nextTick(() => this.destroy(err));
    return this;
  }
  counts.allowed++;
  record({ event: 'allowed', host: String(host ?? 'localhost'), port: Number(port) || null });
  return origConnect.apply(this, args);
};
const origLookup = dns.lookup;
dns.lookup = function (hostname, ...rest) {
  if (!isLoopback(hostname)) {
    record({ event: 'refused_dns', host: String(hostname) });
    const cb = rest.find((x) => typeof x === 'function');
    const err = Object.assign(new Error(`dns lookup refused by local-runtime guard: ${hostname}`), { code: 'EGRESS_REFUSED' });
    if (cb) process.nextTick(() => cb(err));
    return {};
  }
  return origLookup.call(this, hostname, ...rest);
};
for (const fn of ['resolve', 'resolve4', 'resolve6', 'resolveAny']) {
  const orig = dns[fn];
  if (typeof orig !== 'function') continue;
  dns[fn] = function (hostname, ...rest) {
    if (!isLoopback(hostname)) {
      record({ event: 'refused_dns', host: String(hostname), via: fn });
      const cb = rest.find((x) => typeof x === 'function');
      if (cb) process.nextTick(() => cb(Object.assign(new Error('dns refused'), { code: 'EGRESS_REFUSED' })));
      return;
    }
    return orig.call(this, hostname, ...rest);
  };
}

// --- 2. pinned skills archives on loopback ---------------------------------------------------------------------------
const assetsPort = Number(process.env.MCP_ASSETS_PORT || 0);
if (assetsPort) {
  const dir = path.join(HERE, 'assets');
  const sums = Object.fromEntries(fs.readFileSync(path.join(dir, 'SHA256SUMS'), 'utf8').trim().split('\n').map((l) => l.split(/\s+/)).map(([h, f]) => [f, h]));
  const files = {};
  for (const [name, want] of Object.entries(sums)) {
    const bytes = fs.readFileSync(path.join(dir, name));
    const got = crypto.createHash('sha256').update(bytes).digest('hex');
    if (got !== want) { process.stderr.write(`local-runtime: ${name} sha256 ${got} != SHA256SUMS ${want}: refusing to start\n`); process.exit(2); }
    files['/' + name] = bytes;
  }
  const srv = http.createServer((req, res) => {
    const b = files[(req.url || '').split('?')[0]];
    record({ event: 'asset', path: req.url, status: b ? 200 : 404 });
    if (!b) { res.writeHead(404); res.end(); return; }
    res.writeHead(200, { 'content-type': 'application/zip', 'content-length': b.length, etag: '"' + sums[req.url.slice(1).split('?')[0]] + '"' });
    res.end(b);
  });
  srv.listen(assetsPort, '127.0.0.1', () => record({ event: 'assets_listening', port: assetsPort, files: Object.keys(files) }));
  srv.unref();
}
process.on('exit', () => record({ event: 'summary', ...counts }));
record({ event: 'guard_installed', allow: [...LOOPBACK] });
