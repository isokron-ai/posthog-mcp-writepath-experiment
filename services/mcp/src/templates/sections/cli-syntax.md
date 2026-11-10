CLI-style command string. Supported commands:

```text
help [command] — list commands or show usage for one command
{extra_commands}tools — list available tool names
search <words or regex_pattern> — find tools by name, title, or description
info [--json] <tool_name> — show tool name, description, and input schema (summarized if too large). Pass `--json` for raw JSON output.
schema <tool_name> [field_path] — drill into a specific field schema (supports dot-notation, e.g. series, breakdownFilter.breakdowns)
call [--json] [--confirm] <tool_name> [json_input] — call a tool with JSON input (--json returns JSON instead of optimized output in supported tools. Informational responses remain tagged and escaped in both MCP and the agent CLI. --confirm is required for tools annotated destructive; without it the call is refused before it runs.)
```

**Batching read-only commands.** Up to 10 read-only commands can share one request, one per line: `help`, `tools`, `search`, `info`, `schema`, and `call` on a tool annotated `readOnlyHint: true`. Each result comes back under its own label. A write (any other `call`) or `learn` goes in its own request: a batch holding one is refused before anything in it runs.

**Namespaced references (`posthog:<tool-name>`):** strip the `posthog:` prefix and route through `exec`. Run `info <name>` to inspect, then `call <name> <json>`. E.g. `posthog:insights-list` → `posthog:exec({ "command": "info insights-list" })` then `posthog:exec({ "command": "call insights-list {}" })`. If the bare name isn't found, fall back to `search <pattern>` — it may have been renamed.
