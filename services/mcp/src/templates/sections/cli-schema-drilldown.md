**SCHEMA DRILL-DOWN RULE**

The `info` command may return the full schema (for simple tools) or a top-level summary with drill-down hints (for complex tools). Look for `hint` fields in the response.

Look up the schema if a call fails or the shape is unfamiliar. When a `call` fails validation, the error names the failing field and carries its summarized schema (and its siblings'), so you can usually fix the call from the error alone instead of running `info` or `schema` first.

To inspect a field before building it, run `schema <tool_name> <field_name>`; if that also returns a summary (because the field is too large), drill deeper using dot-notation: `schema <tool> <field>.<subfield>`.

For query tools, the fields people most often need are:

- `schema <tool> series` — EventsNode/ActionsNode structure
- `schema <tool> series.properties` — property filter structure of series
