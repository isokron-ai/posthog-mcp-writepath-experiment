### Tool search

**Always prefer `search` over `tools`** — `tools` returns every tool and wastes tokens. Use `search <query>` to find what you need.

`search` understands two kinds of query:

- **Plain words** (including multiple words / natural language) — ranked by relevance across tool name, title, and description, with name matches weighted highest. `search create dashboard insight` surfaces `dashboard-create` / `insight-create` at the top. Results are capped to the top matches; narrow the query if you see a truncation note.
- **Regex** — a query containing regex metacharacters (`- | ( ) [ ] \ . * + ^ $ ?`) is treated as a single case-insensitive regular expression, matched against name/title/description. Use this for precise, narrow patterns.

Quotes are ignored. A regex that matches no tool falls back to ranking by its words, so a guessed name such as "project-update" still returns the nearest tools.

**Good queries:**

- `search create dashboard insight` — plain words, ranked: dashboard/insight creation tools first
- `search feature-flag` — regex (`-`): tools for feature flags
- `search query-` — regex (`-`): all insight query tools

**Avoid queries that are too broad** (match dozens of tools): `search data`, `search get list create` — they match almost everything.

Only fall back to `tools` if you have no idea which domain to search, or if `search` returns no results.

PostHog tools have lowercase kebab-case naming. Tools are organized by category:

{tool_domains}
Typical action names: list/retrieve/get/create/update/delete/query.
Names do not follow one order, so copy them from `search`. Most are noun-first (experiment-create, insight-update, feature-flag-get-all, actions-get-all), some are verb-first (create-feature-flag, update-feature-flag, delete-feature-flag), and list tools end in -list or -get-all. A guessed ordering or plural of a real name (feature-flag-create, action-get-all) resolves to the real tool.
