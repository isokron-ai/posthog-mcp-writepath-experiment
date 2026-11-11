// Redaction applied at capture time to everything the harness writes (transcripts, MCP captures, logs).
// Masks PostHog key shapes (phx_ personal, phc_ project, pha_/phs_/phr_ and any other ph?_ token), Anthropic keys,
// Authorization header values, and - belt and braces - the literal secret values when they are known to the process.
const PATTERNS = [
  [/\bph[a-z]_[A-Za-z0-9_-]{6,}/g, (m) => m.slice(0, 4) + '[REDACTED]'],
  [/\bsk-ant-[A-Za-z0-9_-]{6,}/g, () => 'sk-ant-[REDACTED]'],
  [/(Bearer\s+)(?!\[REDACTED\])[A-Za-z0-9._~+\/=-]{6,}/gi, (_m, p) => p + '[REDACTED]'],
  [/("?authorization"?\s*[:=]\s*"?)(?!Bearer \[REDACTED\])[^"\n,}]{6,}/gi, (_m, p) => p + '[REDACTED]'],
];
export function makeRedactor(literals = []) {
  const lits = literals.filter((s) => typeof s === 'string' && s.length >= 6);
  return function redact(text) {
    if (typeof text !== 'string') text = String(text);
    for (const s of lits) text = text.split(s).join('[REDACTED]');
    for (const [re, fn] of PATTERNS) text = text.replace(re, fn);
    return text;
  };
}
export const redact = makeRedactor();
