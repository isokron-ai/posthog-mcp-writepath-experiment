// IsoKron PostHog benchmark: one task, one agent, the PostHog MCP server as its only tool source.
// Billed to the Anthropic API key only (never the Claude plan). The agent talks to the loopback proxy
// (server/mcp-proxy.mjs), which adds the PostHog key; this process and its transcript never hold that key.
// usage: node bench/bench-agent.mjs --task ID --build baseline|fixed|usability --model M --nonce N12 --run-tag r001
//                                   --out DIR --mcp-url http://127.0.0.1:PORT/mcp [--max-turns N] [--max-usd X]
import { query } from '../runner/node_modules/@anthropic-ai/claude-agent-sdk/sdk.mjs';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { makeRedactor } from '../lib/redact.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const args = Object.fromEntries(process.argv.slice(2).reduce((a, v, i, arr) => (v.startsWith('--') ? [...a, [v.slice(2), arr[i + 1]]] : a), []));
for (const k of ['task', 'build', 'model', 'nonce', 'run-tag', 'out', 'mcp-url']) if (!args[k]) { console.error(`missing --${k}`); process.exit(2); }
if (!['baseline', 'fixed', 'usability'].includes(args.build)) { console.error('build must be baseline, fixed or usability'); process.exit(2); }
if (!/^[0-9a-f]{12}$/.test(args.nonce)) { console.error('nonce must be 12 hex characters'); process.exit(2); }
if (!/^[rd]\d{3}$/.test(args['run-tag'])) { console.error('run-tag must look like r001 or d001'); process.exit(2); }
if (!/^http:\/\/127\.0\.0\.1:\d+\/mcp$/.test(args['mcp-url'])) { console.error('mcp-url must be the loopback proxy'); process.exit(2); }

const env = { ...process.env };
delete env.CLAUDE_CODE_OAUTH_TOKEN;
for (const k of Object.keys(env)) if (/POSTHOG/i.test(k)) delete env[k]; // nothing PostHog-related reaches the agent process
if (!env['ANTHROPIC' + '_API_KEY']) { console.error('API key missing: refusing to run on the plan'); process.exit(2); }
const redact = makeRedactor([env['ANTHROPIC' + '_API_KEY']]);

const OUT = path.resolve(args.out);
fs.mkdirSync(OUT, { recursive: true });
for (const f of ['transcript.redacted.jsonl', 'metrics.json', 'answer.md']) if (fs.existsSync(path.join(OUT, f))) { console.error(`${f} already exists in ${OUT}: capture paths are never reused`); process.exit(2); }
const taskFile = path.join(ROOT, 'bench', 'tasks', `${args.task}.md`);
const m = fs.readFileSync(taskFile, 'utf8').match(/<!-- PROMPT -->([\s\S]*?)<!-- \/PROMPT -->/);
if (!m) { console.error(`${taskFile}: no <!-- PROMPT --> ... <!-- /PROMPT --> block`); process.exit(2); }
const P = `bench-${args.nonce}-`;
const prompt = m[1].trim().replaceAll('{{P}}', P).replaceAll('{{RUN}}', args['run-tag']);
if (/\{\{[A-Z0-9_]+\}\}/.test(prompt)) { console.error('unreplaced placeholder in prompt'); process.exit(2); }
const system = fs.readFileSync(path.join(ROOT, 'bench', 'system.md'), 'utf8');
fs.writeFileSync(path.join(OUT, 'prompt.md'), prompt + '\n');

// Only PostHog MCP tools (plus the client's own ToolSearch, which loads MCP tool schemas on demand).
async function canUseTool(tool, input) {
  if (tool.startsWith('mcp__posthog__') || tool === 'ToolSearch') return { behavior: 'allow', updatedInput: input };
  return { behavior: 'deny', message: 'Only the PostHog MCP tools are available in this benchmark.' };
}
const BUILTINS = ['Bash', 'BashOutput', 'KillShell', 'Read', 'Write', 'Edit', 'MultiEdit', 'Glob', 'Grep', 'WebFetch', 'WebSearch',
  'Task', 'Agent', 'TodoWrite', 'NotebookEdit', 'ExitPlanMode', 'SlashCommand', 'Skill', 'ListMcpResourcesTool', 'ReadMcpResourceTool',
  'AskUserQuestion', 'CronCreate', 'CronDelete', 'CronList', 'DesignSync', 'EnterPlanMode', 'EnterWorktree', 'ExitWorktree', 'ListAgents',
  'PushNotification', 'ReadMcpResourceDirTool', 'ReportFindings', 'ScheduleWakeup', 'SendMessage', 'Workflow'];

const log = fs.createWriteStream(path.join(OUT, 'transcript.redacted.jsonl'), { flags: 'wx' });
const started = Date.now();
const q = query({
  prompt,
  options: {
    model: args.model, cwd: path.join(ROOT, 'bench', 'agent-cwd'), env, maxTurns: Number(args['max-turns'] || 40),
    ...(args['max-usd'] ? { maxBudgetUsd: Number(args['max-usd']) } : {}),
    settingSources: [], permissionMode: 'default', canUseTool, disallowedTools: BUILTINS,
    systemPrompt: { type: 'preset', preset: 'claude_code', append: system },
    mcpServers: { posthog: { type: 'http', url: args['mcp-url'] } },
  },
});

const calls = new Map(); // tool_use id -> record
const order = [];
let result = null, init = null, abort = null, sdkError = null;
// For the single `exec` tool of cli mode, the interesting name is the command inside it: "call insight-update", "info ...".
function execLabel(name, input) {
  if (!name.endsWith('__exec') || typeof input?.command !== 'string') return null;
  const t = input.command.trim().split(/\s+/).filter((x) => !x.startsWith('--'));
  const verb = t[0] || '?';
  return ['call', 'info', 'schema'].includes(verb) ? `${verb} ${t[1] || '?'}` : verb;
}
try { for await (const msg of q) {
  log.write(redact(JSON.stringify(msg)) + '\n');
  if (msg.type === 'system' && msg.subtype === 'init') {
    init = msg;
    if (msg.apiKeySource !== 'ANTHROPIC_API_KEY') { console.error('Not billing to the API key (apiKeySource=' + msg.apiKeySource + '): aborting'); process.exit(3); }
    const srv = (msg.mcp_servers || []).find((s) => s.name === 'posthog');
    if (!srv || srv.status !== 'connected') { abort = `posthog MCP server not connected (status=${srv?.status ?? 'absent'})`; break; }
  }
  if (msg.type === 'assistant') {
    for (const b of msg.message?.content || []) if (b.type === 'tool_use') {
      const a = JSON.stringify(b.input ?? {});
      const r = { id: b.id, name: b.name, exec: execLabel(b.name, b.input), args: a, arg_bytes: Buffer.byteLength(a), t: Date.now() };
      calls.set(b.id, r); order.push(r);
    }
  }
  if (msg.type === 'user') {
    const content = msg.message?.content;
    if (Array.isArray(content)) for (const b of content) if (b.type === 'tool_result' && calls.has(b.tool_use_id)) {
      const r = calls.get(b.tool_use_id);
      const text = typeof b.content === 'string' ? b.content : JSON.stringify(b.content ?? '');
      r.result_bytes = Buffer.byteLength(text); r.is_error = !!b.is_error; r.latency_ms = Date.now() - r.t;
      if (r.is_error) r.error_head = redact(text).slice(0, 300);
    }
  }
  if (msg.type === 'result') result = msg;
} } catch (e) {
  // The SDK throws after an error result (for example an API error). Keep what was recorded and report it as a failed run.
  sdkError = redact(String(e?.message ?? e)).slice(0, 500);
}
if (abort) { try { await q.interrupt?.(); } catch {} }
await new Promise((res) => log.end(res));

const toolCalls = order.map(({ name, exec, arg_bytes, result_bytes = 0, is_error = false, latency_ms = null, error_head }) => ({ name, exec, arg_bytes, result_bytes, is_error, latency_ms, ...(error_head ? { error_head } : {}) }));
const seen = new Set(); let repeated = 0;
for (const r of order) { const k = r.name + r.args; if (seen.has(k)) repeated++; seen.add(k); }
let retryAfterError = 0;
order.forEach((r, i) => { if (r.is_error && order.slice(i + 1).some((x) => x.name === r.name && x.exec === r.exec)) retryAfterError++; });
const answer = redact(result?.result ?? '');
fs.writeFileSync(path.join(OUT, 'answer.md'), answer + '\n');

// friction: the last fenced json block; accept {friction:{...}} or the bare object (tolerant of a "friction" label line).
let friction = null, frictionError = null;
const blocks = [...answer.matchAll(/```(?:json)?[^\n]*\n([\s\S]*?)```/g)];
if (blocks.length) {
  try { const j = JSON.parse(blocks.at(-1)[1].replace(/^\s*friction\s*:?\s*\n/i, '')); friction = j.friction ?? j; } catch (e) { frictionError = String(e.message).slice(0, 200); }
} else frictionError = 'no fenced json block in the final answer';
fs.writeFileSync(path.join(OUT, 'friction.json'), JSON.stringify({ friction, parse_error: frictionError, note: 'the agent\'s own opinion: a lead, never a verdict' }, null, 2) + '\n');

const u = result?.usage || {};
const mcpCalls = toolCalls.filter((c) => c.name.startsWith('mcp__posthog__'));
const metrics = {
  task: args.task, build: args.build, model: args.model, nonce_n12: args.nonce, run_tag: args['run-tag'],
  subtype: abort ? 'mcp_not_connected' : (result?.subtype ?? 'no_result'), abort_reason: abort, is_error: abort ? true : (result?.is_error ?? true),
  sdk_error: sdkError, terminal_reason: result?.terminal_reason ?? null, api_error_status: result?.api_error_status ?? null,
  builtin_tools_offered: (init?.tools || []).filter((t) => !t.startsWith('mcp__')),
  api_key_source: init?.apiKeySource ?? null, sdk_model: init?.model ?? null, claude_code_version: init?.claude_code_version ?? null,
  cost_usd: result?.total_cost_usd ?? null, turns: result?.num_turns ?? null, wall_seconds: Math.round((Date.now() - started) / 1000),
  duration_api_ms: result?.duration_api_ms ?? null,
  tokens: { input: u.input_tokens ?? null, output: u.output_tokens ?? null, cache_creation: u.cache_creation_input_tokens ?? null, cache_read: u.cache_read_input_tokens ?? null },
  model_usage: result?.modelUsage ?? null,
  mcp_tools_listed: (init?.tools || []).filter((t) => t.startsWith('mcp__posthog__')),
  tool_calls: toolCalls,
  counts: {
    tool_calls: toolCalls.length,
    posthog_calls: mcpCalls.length,
    posthog_call_commands: mcpCalls.filter((c) => (c.exec || '').startsWith('call ')).length,
    posthog_discovery_commands: mcpCalls.filter((c) => c.exec && !c.exec.startsWith('call ')).length,
    toolsearch_calls: toolCalls.filter((c) => c.name === 'ToolSearch').length,
    errors: toolCalls.filter((c) => c.is_error).length,
    repeated_identical_calls: repeated,
    retries_after_error: retryAfterError,
    tool_result_bytes: toolCalls.reduce((s, c) => s + c.result_bytes, 0),
  },
};
fs.writeFileSync(path.join(OUT, 'metrics.json'), JSON.stringify(metrics, null, 2) + '\n');
console.log(JSON.stringify({ task: args.task, build: args.build, subtype: metrics.subtype, cost_usd: metrics.cost_usd, turns: metrics.turns, calls: metrics.counts }));
// exit codes: 0 the agent finished (the task may still be wrong); 4 MCP server not connected; 5 the run ended in an error result
process.exit(abort ? 4 : (metrics.is_error || sdkError) ? 5 : 0);
