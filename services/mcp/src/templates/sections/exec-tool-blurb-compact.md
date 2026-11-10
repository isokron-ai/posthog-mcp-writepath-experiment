### Using the `posthog` tool

Pass CLI-style commands in `command`. Find tools with `search` or `tools`. Run `info <tool_name>` once when its schema is missing, then reuse it. Run `schema <tool_name> <field_path>` for a hinted field if unfamiliar; a failed call returns its schema. Invoke tools with `call <tool_name> <json_input>`; add `--json` for raw JSON.
