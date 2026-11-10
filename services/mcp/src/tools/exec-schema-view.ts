import { z } from 'zod'

import { resolveSchemaPath, summarizeSchema } from './schema-utils'
import { stripSkillInstructions } from './skill-mentions'
import type { Tool, ZodObjectAny } from './types'

type JsonSchema = Record<string, unknown>

/**
 * Wording the query-wrapper schemas inherit from PostHog AI's planner
 * (`frontend/src/queries/schema/schema-assistant-queries.ts`). Its agent works from a
 * plan; an MCP agent has none, so "use one of the properties … in the plan" points at
 * nothing. Rewritten where this server hands a schema to an agent, so the shared
 * frontend source stays as PostHog AI needs it.
 *
 * Exact sentences first, so each one keeps its meaning; the two generic rules after
 * them catch a sentence the table does not know yet.
 */
const PLANNER_WORDING: ReadonlyArray<readonly [RegExp, string]> = [
    [/Use one of the properties the user has provided in the plan\./g, 'Use a property that exists in the project.'],
    [/Only use property values from the plan\./g, 'Only use property values that exist in the project.'],
    [
        /\s*When exclusion steps appear needed when you're planning the query, make sure to explicitly state this in the plan\./g,
        '',
    ],
    [/exactly as the event appears in the plan/g, 'exactly as the event is named in the project'],
    [/\s+from the plan\b/g, ''],
    [/\s+in the plan\b/g, ''],
]

export function rewritePlannerWording(text: string): string {
    if (!/\bplan\b/.test(text)) {
        return text
    }
    let rewritten = text
    for (const [pattern, replacement] of PLANNER_WORDING) {
        rewritten = rewritten.replace(pattern, replacement)
    }
    return rewritten
}

/**
 * Tool text as a connection should read it: no PostHog-AI planner wording, and, where
 * skills cannot be loaded, no instruction to load one.
 */
export function agentFacingText(text: string, skillsAvailable: boolean): string {
    const reworded = rewritePlannerWording(text)
    return skillsAvailable ? reworded : stripSkillInstructions(reworded)
}

/** A copy of the schema with every `description` passed through `rewrite`. Shared
 *  sub-objects are rewritten once, and the input is never mutated. */
function rewriteSchemaDescriptions(
    node: unknown,
    rewrite: (text: string) => string,
    seen: WeakMap<object, unknown> = new WeakMap()
): unknown {
    if (typeof node !== 'object' || node === null) {
        return node
    }
    const cached = seen.get(node)
    if (cached !== undefined) {
        return cached
    }
    if (Array.isArray(node)) {
        const out: unknown[] = []
        seen.set(node, out)
        for (const child of node) {
            out.push(rewriteSchemaDescriptions(child, rewrite, seen))
        }
        return out
    }
    const out: Record<string, unknown> = {}
    seen.set(node, out)
    for (const [key, value] of Object.entries(node)) {
        out[key] =
            key === 'description' && typeof value === 'string'
                ? rewrite(value)
                : rewriteSchemaDescriptions(value, rewrite, seen)
    }
    return out
}

/**
 * Exec mode owns output encoding through the `--json` call flag, so tools must
 * not also advertise their `output_format` input — an agent passing
 * `output_format: "json"` would make the handler skip the server-side formatter
 * only for exec to TOON-encode the raw result anyway. `call` folds the flag back
 * into the field for tools that have it (see the `call` verb), so hiding it here
 * loses no capability.
 */
export function stripOutputFormatProperty(jsonSchema: JsonSchema): JsonSchema {
    const properties = jsonSchema.properties as Record<string, unknown> | undefined
    if (!properties || !('output_format' in properties)) {
        return jsonSchema
    }
    const { output_format: _omitted, ...rest } = properties
    return { ...jsonSchema, properties: rest }
}

const agentSchemaCache = {
    withSkills: new WeakMap<object, JsonSchema>(),
    withoutSkills: new WeakMap<object, JsonSchema>(),
}

/**
 * The input schema exec shows an agent for a tool: `info`, `schema`, and the schema a
 * failed `call` carries. `io: 'input'` mirrors the advertised `tools/list` schema and the
 * executor's validation, so fields with a Zod `.default()` read as optional. Converted
 * once per tool schema.
 */
export function agentFacingInputSchema(
    tool: Pick<Tool<ZodObjectAny>, 'schema' | 'rawInputSchema'>,
    skillsAvailable = true
): JsonSchema {
    const cache = skillsAvailable ? agentSchemaCache.withSkills : agentSchemaCache.withoutSkills
    const key = (tool.rawInputSchema as object | undefined) ?? tool.schema
    const cached = cache.get(key)
    if (cached) {
        return cached
    }
    const base =
        (tool.rawInputSchema as JsonSchema | undefined) ??
        stripOutputFormatProperty(z.toJSONSchema(tool.schema, { io: 'input' }) as JsonSchema)
    const rewritten = rewriteSchemaDescriptions(base, (text) => agentFacingText(text, skillsAvailable)) as JsonSchema
    cache.set(key, rewritten)
    return rewritten
}

/** Upper bound on the schema text one validation error carries (about 2,000 tokens).
 *  Past it the summary drops to field names and types, so a rejection stays far
 *  cheaper than the `info` plus `schema` round trips it replaces. */
export const MAX_ERROR_SCHEMA_CHARS = 8_000

/** How many distinct failing fields one error describes. */
const MAX_ERROR_SCHEMA_FIELDS = 3

const ISSUE_CODES_ON_A_LEAF = new Set(['invalid_type', 'invalid_value', 'invalid_format'])

/** A length or range rejection already names the bound and the value's size, which is
 *  everything needed to fix it, so it carries no schema. */
const SELF_EXPLAINING_ISSUE_CODES = new Set(['too_big', 'too_small'])

/**
 * The schema path whose summary lets the caller fix one issue.
 *
 * A missing or mistyped scalar is fixed from its parent object: that summary names the
 * field's type, enum and description next to its siblings, which is where a caller who
 * sent the wrong shape (`breakdowns` for `breakdown`) finds the right one. Anything else
 * (a union, an object, an unknown key) is described by the node that failed.
 */
function targetPathFor(issue: z.core.$ZodIssue): string[] {
    const path = issue.path.map(String)
    if (issue.code === 'unrecognized_keys') {
        return path
    }
    if (ISSUE_CODES_ON_A_LEAF.has(issue.code) && path.length > 0) {
        return path.slice(0, -1)
    }
    return path
}

/** Drops a trailing array index, so `series.0` reads as `series` the way `schema` takes it. */
function displayPath(path: readonly string[]): string {
    const trimmed = [...path]
    while (trimmed.length > 0 && /^\d+$/.test(trimmed[trimmed.length - 1]!)) {
        trimmed.pop()
    }
    return trimmed.join('.')
}

/** Field names and types only, for a summary too large to carry whole. */
function namesAndTypes(summary: unknown): unknown {
    if (typeof summary !== 'object' || summary === null) {
        return summary
    }
    const node = summary as Record<string, unknown>
    const out: Record<string, unknown> = { type: node['type'] }
    if (Array.isArray(node['required'])) {
        out['required'] = node['required']
    }
    if (typeof node['properties'] === 'object' && node['properties'] !== null) {
        const properties: Record<string, string> = {}
        for (const [name, prop] of Object.entries(node['properties'] as Record<string, unknown>)) {
            const entry = prop as Record<string, unknown>
            const enumValues = Array.isArray(entry['enum'])
                ? ` (one of: ${(entry['enum'] as unknown[]).join(', ')})`
                : ''
            properties[name] = `${String(entry['type'] ?? 'unknown')}${enumValues}`
        }
        out['properties'] = properties
    }
    if (Array.isArray(node['variants'])) {
        out['variants'] = (node['variants'] as unknown[]).map(namesAndTypes)
    }
    if (node['items'] !== undefined) {
        out['items'] = namesAndTypes(node['items'])
    }
    return out
}

/**
 * The summarized schema of each field a failed `call` got wrong, as `schema <tool>
 * <field>` would print it, so the caller can correct the call from the error itself
 * instead of spending an `info` and one `schema` call per field first.
 *
 * Text comes from the tool's own schema only, never from the rejected input. Two
 * failing fields with the same shape (a retention `targetEntity` and `returningEntity`)
 * are printed once.
 */
export function describeFailingFieldSchemas(
    tool: Pick<Tool<ZodObjectAny>, 'name' | 'schema' | 'rawInputSchema'>,
    issues: readonly z.core.$ZodIssue[],
    skillsAvailable = true
): string {
    let full: JsonSchema
    try {
        full = agentFacingInputSchema(tool, skillsAvailable)
    } catch {
        return ''
    }
    const targets: string[][] = []
    const seenPaths = new Set<string>()
    for (const issue of issues) {
        if (SELF_EXPLAINING_ISSUE_CODES.has(issue.code)) {
            continue
        }
        const target = targetPathFor(issue)
        const key = target.join('.')
        if (seenPaths.has(key)) {
            continue
        }
        seenPaths.add(key)
        targets.push(target)
        if (targets.length === MAX_ERROR_SCHEMA_FIELDS) {
            break
        }
    }

    const blocks: string[] = []
    const printed = new Map<string, string>()
    let budget = MAX_ERROR_SCHEMA_CHARS
    for (const target of targets) {
        // Walk up until the path resolves: an issue under an open record or a catchall
        // names a key the schema never declared.
        let path = [...target]
        let resolved: JsonSchema | null = path.length === 0 ? full : resolveSchemaPath(full, path.join('.'))
        while (!resolved && path.length > 0) {
            path = path.slice(0, -1)
            resolved = path.length === 0 ? full : resolveSchemaPath(full, path.join('.'))
        }
        if (!resolved) {
            continue
        }
        const shown = displayPath(path)
        const summary = summarizeSchema(resolved, tool.name, shown || undefined)
        const fullText = JSON.stringify(summary)
        const label = shown ? `Schema of ${shown}` : `Schema of the ${tool.name} input`
        // Drill-down hints name the field's own path, so compare shapes with the path taken out.
        const shapeKey = shown ? fullText.split(shown).join('\u0000') : fullText
        const duplicateOf = printed.get(shapeKey)
        if (duplicateOf !== undefined) {
            blocks.push(`${label}: same as ${duplicateOf}.`)
            continue
        }
        let text = fullText
        if (text.length > budget) {
            text = JSON.stringify(namesAndTypes(summary))
        }
        if (text.length > budget) {
            blocks.push(`${label}: too large to include. Run "schema ${tool.name}${shown ? ` ${shown}` : ''}".`)
            continue
        }
        budget -= text.length
        printed.set(shapeKey, shown || 'the input')
        blocks.push(`${label}:\n${text}`)
    }
    if (blocks.length === 0) {
        return ''
    }
    return `\n\nFix the call from the schema below; no separate info or schema call is needed.\n${blocks.join('\n')}`
}
