/** Token-aware schema summarization and drill-down utilities for the exec tool. */

import { z } from 'zod'

// 12k tokens × 4 chars/token
export const TOKEN_CHAR_LIMIT = 4 * 12_000

type JSONSchema = Record<string, unknown>

/**
 * Scalar constraints copied through from the JSON Schema as-is. Without them an
 * agent in exec mode learns a string cap only from the rejection after it sent
 * too much.
 */
interface ScalarConstraints {
    minLength?: number
    maxLength?: number
    minimum?: number
    maximum?: number
    exclusiveMinimum?: number
    exclusiveMaximum?: number
    pattern?: string
    format?: string
}

interface SummarizedProperty extends ScalarConstraints {
    type?: string
    description?: string
    enum?: unknown[]
    default?: unknown
    const?: unknown
    required?: boolean
    fields?: string[]
    items?: string
    hint?: string
}

/**
 * A summarized schema node. `properties` is always present (empty for non-object
 * nodes) so callers can read it unconditionally; `items` (arrays) and `variants`
 * (unions) carry the recursive shape that the old object-only summarizer dropped.
 */
interface NodeSummary extends ScalarConstraints {
    type: string
    title?: string
    required?: string[]
    requiredWhenSet?: Record<string, string[]>
    properties: Record<string, SummarizedProperty>
    items?: NodeSummary
    variants?: NodeSummary[]
    description?: string
    enum?: unknown[]
    const?: unknown
    default?: unknown
}

const NUMERIC_CONSTRAINT_KEYS = [
    'minLength',
    'maxLength',
    'minimum',
    'maximum',
    'exclusiveMinimum',
    'exclusiveMaximum',
] as const satisfies readonly (keyof ScalarConstraints)[]
const STRING_CONSTRAINT_KEYS = ['pattern', 'format'] as const satisfies readonly (keyof ScalarConstraints)[]

/**
 * A `pattern` longer than this is a generated regex (zod's ISO date-time pattern is
 * 310 characters) that an agent cannot act on; its `format` says the same in a word.
 * Copying every one would grow the catalogue's summaries by about 6%.
 */
const MAX_PATTERN_CHARS = 80

function copyConstraints(from: JSONSchema, to: ScalarConstraints): void {
    for (const key of NUMERIC_CONSTRAINT_KEYS) {
        const value = from[key]
        if (typeof value === 'number') {
            to[key] = value
        }
    }
    for (const key of STRING_CONSTRAINT_KEYS) {
        const value = from[key]
        if (typeof value !== 'string') {
            continue
        }
        if (key === 'pattern' && (typeof from.format === 'string' || value.length > MAX_PATTERN_CHARS)) {
            continue
        }
        to[key] = value
    }
}

/**
 * zod renders `.nullable()` as `anyOf: [variant, {type: 'null'}]` and puts the
 * field's `description` and `default` on that wrapper, not on the variant. Whoever
 * collapses the wrapper to its variant has to carry those two across or the summary
 * loses them.
 */
function carryWrapperMetadata(wrapper: JSONSchema, variant: JSONSchema): JSONSchema {
    return {
        ...variant,
        ...(wrapper.description !== undefined ? { description: wrapper.description } : {}),
        ...(wrapper.default !== undefined ? { default: wrapper.default } : {}),
    }
}

/**
 * A nullable field (`anyOf: [{type: 'string', maxLength: 3000}, {type: 'null'}]`) is
 * its one non-null variant for the caller's purposes. Returns that variant, with the
 * wrapper's description and default, so its type, enum, constraints, fields and
 * drill-down hint are summarized instead of the union wrapper, which carried none of
 * them. Anything else comes back unchanged.
 */
function unwrapNullable(schema: JSONSchema): JSONSchema {
    const variants = (schema.anyOf || schema.oneOf) as JSONSchema[] | undefined
    if (!variants) {
        return schema
    }
    const nonNull = variants.filter((v) => v.type !== 'null')
    if (nonNull.length !== 1) {
        return schema
    }
    return carryWrapperMetadata(schema, nonNull[0]!)
}

/**
 * Properties that conventionally discriminate a union variant. Zod discriminated
 * unions (e.g. the trends `series` EventsNode/ActionsNode/GroupNode split) carry the
 * variant identity in one of these as a `const`/single-value `enum`, not in `title`.
 */
const DISCRIMINATOR_KEYS = ['kind', 'type', 'nodeKind'] as const

/** Best-effort human label for a union variant: `title`, a root `const`, or a discriminator property's `const`/single-value `enum`. */
function variantName(variant: JSONSchema): string | undefined {
    if (typeof variant.title === 'string') {
        return variant.title
    }
    if (typeof variant.const === 'string') {
        return variant.const
    }
    const props = variant.properties as Record<string, JSONSchema> | undefined
    if (!props) {
        return undefined
    }
    for (const key of DISCRIMINATOR_KEYS) {
        const disc = props[key]
        if (!disc) {
            continue
        }
        if (typeof disc.const === 'string') {
            return disc.const
        }
        if (Array.isArray(disc.enum) && disc.enum.length === 1 && typeof disc.enum[0] === 'string') {
            return disc.enum[0]
        }
    }
    return undefined
}

/**
 * Describe the type of a union (anyOf/oneOf) concisely.
 * Names variants via `variantName` (title, root const, or discriminator const).
 */
function describeUnion(variants: JSONSchema[]): string {
    const names = variants.map(variantName).filter((n): n is string => typeof n === 'string')
    if (names.length > 0 && names.length <= 6) {
        return `union of ${variants.length} types (${names.join(', ')})`
    }
    return `union of ${variants.length} types`
}

/** Get the effective type string for a schema node. */
function getTypeString(schema: JSONSchema): string {
    if (typeof schema.type === 'string') {
        return schema.type
    }
    if (Array.isArray(schema.type)) {
        return (schema.type as string[]).filter((t) => t !== 'null').join(' | ')
    }
    if (schema.anyOf || schema.oneOf) {
        const variants = (schema.anyOf || schema.oneOf) as JSONSchema[]
        // Filter out null types for optional unions
        const nonNull = variants.filter((v) => v.type !== 'null')
        if (nonNull.length === 0) {
            return 'null'
        }
        return describeUnion(nonNull)
    }
    if (schema.const !== undefined) {
        return 'const'
    }
    return 'unknown'
}

/** Check if a property has complex nested structure that needs drill-down. */
function isComplex(schema: JSONSchema): boolean {
    if (schema.type === 'object' && schema.properties) {
        return true
    }
    if (schema.type === 'array' && schema.items) {
        const items = schema.items as JSONSchema
        if (items.type === 'object' && items.properties) {
            return true
        }
        if (items.anyOf || items.oneOf) {
            return true
        }
    }
    if (schema.anyOf || schema.oneOf) {
        const variants = (schema.anyOf || schema.oneOf) as JSONSchema[]
        const nonNull = variants.filter((v) => v.type !== 'null')
        // Simple nullable scalar is not complex
        if (nonNull.length <= 1 && nonNull.every((v) => typeof v.type === 'string' && v.type !== 'object')) {
            return false
        }
        return nonNull.length > 1 || nonNull.some((v) => v.type === 'object' || v.type === 'array')
    }
    return false
}

/** Describe array items concisely. */
function describeItems(items: JSONSchema): string {
    if (items.anyOf || items.oneOf) {
        const variants = (items.anyOf || items.oneOf) as JSONSchema[]
        return describeUnion(variants.filter((v) => v.type !== 'null'))
    }
    if (items.type === 'object') {
        const propNames = items.properties ? Object.keys(items.properties as Record<string, unknown>) : []
        if (propNames.length > 0) {
            return `object with ${propNames.length} fields`
        }
        return 'object'
    }
    return getTypeString(items)
}

// Defensive recursion bound for `summarizeNode`. Zod's `toJSONSchema` inlines, so
// schemas are finite trees, but array/union unwrapping recurses — cap it anyway.
const MAX_SUMMARY_DEPTH = 6

/** A tool-level control the executor strips before dispatch, so it doesn't count
 *  as one of the tool's own parameters when deciding whether a field is the sole
 *  wrapper. */
const TOOL_CONTROL_PROPERTIES = new Set(['output_format'])

/**
 * Whether a field is the wrapper a tool's whole payload sits under — the single
 * required top-level object on `query-logs`, `query-apm-spans`, `read-data-schema`
 * and their siblings.
 *
 * Callers flatten these: they send `{dateRange, limit}` where `{query: {dateRange,
 * limit}}` was wanted, because the fields they know about are the nested ones and
 * the drill-down hint alone never says the wrapper is mandatory. Naming it on the
 * field keeps the nesting in the summarized schema, which is all a caller sees once
 * the full schema overflows the token budget.
 *
 * Being the tool's ONLY parameter is what makes "everything goes inside it" true.
 * A required object sitting beside other top-level fields — `query-retention`'s
 * `retentionFilter`, `view-create`'s `query` next to `name` — is a component of the
 * payload, not the envelope, and saying otherwise would flatten calls that were
 * already correct.
 */
function isPayloadWrapper(
    name: string,
    prop: JSONSchema,
    schema: JSONSchema,
    requiredFields: readonly string[],
    fieldPath: string | undefined
): boolean {
    // Nested paths describe a field the caller already reached through the wrapper.
    if (fieldPath !== undefined || !requiredFields.includes(name)) {
        return false
    }
    const siblings = Object.keys((schema.properties || {}) as Record<string, unknown>).filter(
        (field) => field !== name && !TOOL_CONTROL_PROPERTIES.has(field)
    )
    if (siblings.length > 0) {
        return false
    }
    if (prop.type === 'object' && prop.properties) {
        return true
    }
    // A wrapper keyed by a discriminator (`read-data-schema`'s `query`) arrives as a
    // union of object variants, and gets flattened just as often.
    const variants = (prop.anyOf || prop.oneOf) as JSONSchema[] | undefined
    const nonNull = variants?.filter((variant) => variant.type !== 'null') ?? []
    return nonNull.length > 0 && nonNull.every((variant) => variant.type === 'object' && !!variant.properties)
}

/**
 * Summarize an object's top-level properties: field names, types, descriptions,
 * and drill-down hints for complex fields. Intentionally does NOT recurse into a
 * nested object/array/union field — each complex field instead carries a `hint`
 * pointing at the next `schema <tool> <path>` call.
 */
function summarizeObject(schema: JSONSchema, toolName: string, fieldPath?: string): NodeSummary {
    const properties = (schema.properties || {}) as Record<string, JSONSchema>
    const requiredFields = (schema.required || []) as string[]
    const result: Record<string, SummarizedProperty> = {}
    const pathPrefix = fieldPath ? `${fieldPath}.` : ''

    for (const [name, rawProp] of Object.entries(properties)) {
        const prop = unwrapNullable(rawProp)
        const entry: SummarizedProperty = {}
        entry.type = getTypeString(prop)

        if (typeof prop.description === 'string') {
            entry.description = prop.description
        }
        if (prop.enum) {
            entry.enum = prop.enum as unknown[]
        }
        if (prop.default !== undefined) {
            entry.default = prop.default
        }
        if (prop.const !== undefined) {
            entry.const = prop.const
        }
        copyConstraints(prop, entry)
        if (requiredFields.includes(name)) {
            entry.required = true
        }

        // For objects, list subfield names
        if (prop.type === 'object' && prop.properties) {
            entry.fields = Object.keys(prop.properties as Record<string, unknown>)
        }

        // For arrays, describe items
        if (prop.type === 'array' && prop.items) {
            entry.items = describeItems(prop.items as JSONSchema)
        }

        // Add drill-down hint for complex fields. Phrased as an imperative, not a
        // description — models observably treat declarative notes as advisory, so
        // the directive lives on the field the model is about to populate.
        if (isComplex(prop)) {
            entry.hint = `DO NOT GUESS — you MUST run \`schema ${toolName} ${pathPrefix}${name}\` before populating this field`
            if (isPayloadWrapper(name, prop, schema, requiredFields, fieldPath)) {
                entry.hint += `. Every parameter goes inside it — send {"${name}": {...}}, not the fields at the top level`
            }
        }

        result[name] = entry
    }

    const summary: NodeSummary = {
        type: (schema.type as string) || 'object',
        ...(requiredFields.length > 0 ? { required: requiredFields } : {}),
        // Before `properties`, so a caller whose output gets cut off still sees the conditional rule.
        ...(schema['x-required-when-set']
            ? { requiredWhenSet: schema['x-required-when-set'] as Record<string, string[]> }
            : {}),
        properties: result,
    }
    if (typeof schema.title === 'string') {
        summary.title = schema.title
    }
    return summary
}

/** Summarize a scalar/leaf node — its descriptive metadata only, no children. */
function summarizeLeaf(schema: JSONSchema): NodeSummary {
    const summary: NodeSummary = { type: getTypeString(schema), properties: {} }
    if (typeof schema.title === 'string') {
        summary.title = schema.title
    }
    if (typeof schema.description === 'string') {
        summary.description = schema.description
    }
    if (schema.enum) {
        summary.enum = schema.enum as unknown[]
    }
    if (schema.const !== undefined) {
        summary.const = schema.const
    }
    if (schema.default !== undefined) {
        summary.default = schema.default
    }
    copyConstraints(schema, summary)
    return summary
}

/**
 * Summarize any schema node, dispatching on its kind.
 *
 * Array and union WRAPPERS recurse, unlike the per-field summary inside an object
 * (which stops at one level and emits a `hint`). The reason: `items` and union
 * variants don't consume a path segment — `resolveSchemaPath` walks through them
 * transparently (`series.event` reaches into `series`'s array-of-union items) — so
 * a faithful summary has to unwrap them until it reaches the object/scalar beneath.
 * Without this, summarizing an array- or union-typed field that overflows the inline
 * budget (e.g. `query-trends series`) collapsed to an empty `{ type, properties: {} }`
 * and the variant shapes were invisible.
 */
function summarizeNode(
    schema: JSONSchema,
    toolName: string,
    fieldPath: string | undefined,
    depth: number
): NodeSummary {
    // Union: summarize each non-null variant. A lone non-null variant (a nullable
    // wrapper) collapses to that variant so we don't emit a pointless 1-way union.
    const unionVariants = (schema.anyOf || schema.oneOf) as JSONSchema[] | undefined
    if (unionVariants) {
        const nonNull = unionVariants.filter((v) => v.type !== 'null')
        if (nonNull.length === 0) {
            return { type: 'null', properties: {} }
        }
        if (depth >= MAX_SUMMARY_DEPTH) {
            return { type: getTypeString(schema), properties: {} }
        }
        if (nonNull.length === 1) {
            // Unwrap a nullable wrapper, keeping its description and default. Count it
            // against `depth` so a pathological chain of nested nullable unions still
            // terminates at MAX_SUMMARY_DEPTH.
            return summarizeNode(carryWrapperMetadata(schema, nonNull[0]!), toolName, fieldPath, depth + 1)
        }
        return {
            type: getTypeString(schema),
            properties: {},
            variants: nonNull.map((v) => summarizeNode(v, toolName, fieldPath, depth + 1)),
        }
    }

    // Array: summarize the item schema (which itself may be an object or a union).
    if (schema.type === 'array' && schema.items && !Array.isArray(schema.items)) {
        const items = schema.items as JSONSchema
        if (depth >= MAX_SUMMARY_DEPTH) {
            return { type: 'array', properties: {}, items: { type: describeItems(items), properties: {} } }
        }
        return { type: 'array', properties: {}, items: summarizeNode(items, toolName, fieldPath, depth + 1) }
    }

    // Object with properties: list field names + drill-down hints (one level deep).
    if (schema.properties) {
        return summarizeObject(schema, toolName, fieldPath)
    }

    // A property-less object keeps the historical empty shape; anything else is a leaf.
    if (schema.type === 'object') {
        return { type: 'object', properties: {} }
    }
    return summarizeLeaf(schema)
}

/**
 * Summarize a JSON Schema for the `info` / `schema` exec commands.
 *
 * Objects list their top-level properties with drill-down hints; arrays and unions
 * recurse through the wrapper into the underlying item/variant shapes, so the result
 * is never an empty `{ type, properties: {} }`.
 */
export function summarizeSchema(schema: JSONSchema, toolName: string, fieldPath?: string): NodeSummary {
    // A summarized field keeps its `enum`, so a DRF choice list in its description only repeats it.
    return mapSchema(summarizeNode(schema, toolName, fieldPath, 0), stripChoiceLines) as NodeSummary
}

/**
 * JSON Schema composition keywords that fan out into more sub-schemas.
 * A named child may live under any of these; resolution walks them transparently.
 */
const COMPOSITION_KEYS = ['allOf', 'anyOf', 'oneOf'] as const

function getVariants(node: JSONSchema, key: (typeof COMPOSITION_KEYS)[number]): JSONSchema[] | undefined {
    const value = node[key]
    return Array.isArray(value) ? (value as JSONSchema[]) : undefined
}

/**
 * Find a named child of a schema node, regardless of how the schema composes it.
 *
 * Walks `properties`, every composition keyword (`allOf`/`anyOf`/`oneOf`), and `items`
 * recursively — so `series.event` works whether `event` lives on `items.properties`,
 * `items.anyOf[i].properties`, `items.allOf[i].properties`, or any nested combination.
 *
 * First match wins. `seen` blocks pathological cycles if schemas ever carry self-refs
 * (Zod's `toJSONSchema` inlines, so this is defensive).
 */
function findNamedChild(node: JSONSchema, name: string, seen: WeakSet<JSONSchema> = new WeakSet()): JSONSchema | null {
    if (seen.has(node)) {
        return null
    }
    seen.add(node)

    if (node.properties) {
        const direct = (node.properties as Record<string, JSONSchema>)[name]
        if (direct) {
            return direct
        }
    }

    for (const key of COMPOSITION_KEYS) {
        const variants = getVariants(node, key)
        if (!variants) {
            continue
        }
        for (const variant of variants) {
            const hit = findNamedChild(variant, name, seen)
            if (hit) {
                return hit
            }
        }
    }

    // Array children are whatever `items` exposes — recurse transparently.
    // Tuple form (`items: [...]`) is ignored; Zod doesn't produce it and it would need
    // index-specific handling anyway.
    if (node.items && !Array.isArray(node.items)) {
        const hit = findNamedChild(node.items as JSONSchema, name, seen)
        if (hit) {
            return hit
        }
    }

    return null
}

/**
 * Resolve a numeric index: descend into array items or pick a union variant by position.
 * Arrays take precedence (all items share the same schema, so index 0/N returns the
 * same items wrapper); for unions, `0` picks the first variant, `1` the second, etc.
 */
function findIndexedChild(node: JSONSchema, idx: number): JSONSchema | null {
    if (node.items && !Array.isArray(node.items)) {
        return node.items as JSONSchema
    }
    for (const key of COMPOSITION_KEYS) {
        const variants = getVariants(node, key)
        if (variants && variants[idx]) {
            return variants[idx] as JSONSchema
        }
    }
    return null
}

/**
 * Collect every named child reachable from a node by walking composition keywords.
 * Dedupes across variants.
 */
function collectNamedChildren(
    node: JSONSchema,
    into: Set<string> = new Set(),
    seen: WeakSet<JSONSchema> = new WeakSet()
): Set<string> {
    if (seen.has(node)) {
        return into
    }
    seen.add(node)

    if (node.properties) {
        for (const k of Object.keys(node.properties as Record<string, unknown>)) {
            into.add(k)
        }
    }
    for (const key of COMPOSITION_KEYS) {
        const variants = getVariants(node, key)
        if (!variants) {
            continue
        }
        for (const variant of variants) {
            collectNamedChildren(variant, into, seen)
        }
    }
    return into
}

/**
 * Resolve a dot-separated path within a JSON Schema.
 * Returns the sub-schema at that path, or null if invalid.
 */
export function resolveSchemaPath(schema: JSONSchema, dotPath: string): JSONSchema | null {
    let current: JSONSchema = schema
    for (const segment of dotPath.split('.')) {
        const isNumeric = /^\d+$/.test(segment)
        const next = isNumeric
            ? (findIndexedChild(current, parseInt(segment, 10)) ?? findNamedChild(current, segment))
            : findNamedChild(current, segment)
        if (!next) {
            return null
        }
        current = next
    }
    return current
}

/**
 * List available child paths from a schema node.
 * Emits:
 *   - every named child reachable through any composition keyword (direct or nested)
 *   - `[items].<name>` for array-of-object/array-of-union items (via composition walk)
 *   - numeric variant labels when the node itself is a union
 */
export function listAvailablePaths(schema: JSONSchema): string[] {
    const paths: string[] = []

    // Named children at this level (covers properties + allOf/anyOf/oneOf at any nesting).
    for (const k of collectNamedChildren(schema)) {
        paths.push(k)
    }

    // Array item children, surfaced under `[items].<name>` so callers know they're
    // indexing through an array.
    if (schema.type === 'array' && schema.items && !Array.isArray(schema.items)) {
        const itemChildren = collectNamedChildren(schema.items as JSONSchema)
        for (const k of itemChildren) {
            paths.push(`[items].${k}`)
        }
    }

    // If the node is itself a union, expose variant indices so callers can pick by position.
    for (const key of COMPOSITION_KEYS) {
        const variants = getVariants(schema, key)
        if (!variants || key === 'allOf') {
            continue
        }
        for (let i = 0; i < variants.length; i++) {
            const v = variants[i]!
            const label = typeof v.title === 'string' ? `${i} (${v.title})` : `${i}`
            paths.push(label)
        }
    }

    return paths
}

// ------------------------------------------------------------------
// Schema de-duplication for `info` and `schema <tool> <path>` output
// ------------------------------------------------------------------

/** A DRF choice line, `* \`value\` - Label`, which serializers append to an enum field's description. */
const CHOICE_LINE = /^\s*\* `([^`]*)` - (.*)$/

const normalizeChoiceLabel = (text: string): string =>
    text
        .replace(/[\s_-]+/g, ' ')
        .trim()
        .toLowerCase()

function enumValuesOf(node: JSONSchema): Set<string> | undefined {
    const values = new Set<string>()
    const collect = (candidate: unknown): void => {
        if (candidate && typeof candidate === 'object' && Array.isArray((candidate as JSONSchema).enum)) {
            for (const value of (candidate as JSONSchema).enum as unknown[]) {
                values.add(String(value))
            }
        }
    }
    collect(node)
    collect(node.items)
    for (const key of ['anyOf', 'oneOf'] as const) {
        for (const variant of getVariants(node, key) ?? []) {
            collect(variant)
            collect(variant.items)
        }
    }
    return values.size > 0 ? values : undefined
}

/**
 * Removes DRF choice lines that only repeat an enum on the same node: a line goes when its value is
 * one of the node's enum values and its label is that value again. A line whose label says more
 * (`distinct_id` - "User ID (default)") stays. On the friction session these lists were 6,059 tokens
 * of info and schema output, and 625 of 628 lines repeated the value.
 */
function stripChoiceLines(node: JSONSchema): JSONSchema {
    if (typeof node.description !== 'string' || !node.description.includes('* `')) {
        return node
    }
    const values = enumValuesOf(node)
    if (!values) {
        return node
    }
    const kept = node.description.split('\n').filter((line) => {
        const match = CHOICE_LINE.exec(line)
        return !(match && values.has(match[1]!) && normalizeChoiceLabel(match[1]!) === normalizeChoiceLabel(match[2]!))
    })
    const description = kept.join('\n').trim()
    const { description: _dropped, ...rest } = node
    return description ? { ...rest, description } : rest
}

function mapSchema(node: unknown, visit: (node: JSONSchema) => JSONSchema): unknown {
    if (Array.isArray(node)) {
        return node.map((item) => mapSchema(item, visit))
    }
    if (node === null || typeof node !== 'object') {
        return node
    }
    const mapped: JSONSchema = {}
    for (const [key, value] of Object.entries(node as JSONSchema)) {
        mapped[key] = mapSchema(value, visit)
    }
    return visit(mapped)
}

/** Stable JSON for structural comparison: object keys sorted, so key order never splits two equal schemas. */
function canonicalJson(value: unknown): string {
    if (Array.isArray(value)) {
        return `[${value.map(canonicalJson).join(',')}]`
    }
    if (value === null || typeof value !== 'object') {
        return JSON.stringify(value) ?? 'null'
    }
    const entries = Object.keys(value as JSONSchema)
        .sort()
        .map((key) => `${JSON.stringify(key)}:${canonicalJson((value as JSONSchema)[key])}`)
    return `{${entries.join(',')}}`
}

/** Keys whose values are maps of name → schema, so a child's key there names it. */
const SCHEMA_MAP_KEYS = new Set(['properties', '$defs', 'definitions', 'patternProperties'])
/** Keys whose values hold sub-schemas, directly or as an array. */
const SUBSCHEMA_KEYS = new Set(['items', 'additionalProperties', 'anyOf', 'oneOf', 'allOf', 'not', 'prefixItems'])

/** A repeated sub-schema must be at least this big (serialized) for a `$ref` to save anything. */
const MIN_DEF_CHARS = 160

interface DefCandidate {
    key: string
    node: JSONSchema
    name: string
    count: number
    size: number
}

function withoutDescription(node: JSONSchema): JSONSchema {
    const { description: _description, ...rest } = node
    return rest
}

function suggestDefName(node: JSONSchema, hint: string | undefined): string {
    const fromTitle = typeof node.title === 'string' ? node.title : undefined
    const fromKind = variantName(node)
    const raw = fromTitle ?? fromKind ?? hint ?? 'Schema'
    const cleaned = raw.replace(/[^A-Za-z0-9_]+/g, '_').replace(/^_+|_+$/g, '')
    return cleaned || 'Schema'
}

/** Walk every sub-schema below the root, with the property or definition name it sits under. */
function forEachSubschema(
    node: unknown,
    visit: (node: JSONSchema, hint: string | undefined) => void,
    hint?: string,
    isRoot = true
): void {
    if (node === null || typeof node !== 'object' || Array.isArray(node)) {
        return
    }
    const record = node as JSONSchema
    if (!isRoot) {
        visit(record, hint)
    }
    for (const [key, value] of Object.entries(record)) {
        if (SCHEMA_MAP_KEYS.has(key) && value && typeof value === 'object' && !Array.isArray(value)) {
            for (const [childName, child] of Object.entries(value as JSONSchema)) {
                forEachSubschema(child, visit, childName, false)
            }
        } else if (SUBSCHEMA_KEYS.has(key)) {
            const children = Array.isArray(value) ? value : [value]
            for (const child of children) {
                forEachSubschema(child, visit, hint, false)
            }
        }
    }
}

function findBestCandidate(root: JSONSchema): DefCandidate | undefined {
    const seen = new Map<string, DefCandidate>()
    forEachSubschema(root, (node, hint) => {
        if (typeof node.$ref === 'string') {
            return
        }
        const key = canonicalJson(withoutDescription(node))
        if (key.length < MIN_DEF_CHARS) {
            return
        }
        const existing = seen.get(key)
        if (existing) {
            existing.count += 1
        } else {
            seen.set(key, { key, node, name: suggestDefName(node, hint), count: 1, size: key.length })
        }
    })
    let best: DefCandidate | undefined
    for (const candidate of seen.values()) {
        if (candidate.count < 2) {
            continue
        }
        const saving = (candidate.count - 1) * candidate.size
        if (!best || saving > (best.count - 1) * best.size) {
            best = candidate
        }
    }
    return best
}

function replaceMatches(node: unknown, key: string, ref: string, descriptions: (string | undefined)[]): unknown {
    if (Array.isArray(node)) {
        return node.map((item) => replaceMatches(item, key, ref, descriptions))
    }
    if (node === null || typeof node !== 'object') {
        return node
    }
    const record = node as JSONSchema
    const result: JSONSchema = {}
    for (const [childKey, value] of Object.entries(record)) {
        if (SCHEMA_MAP_KEYS.has(childKey) && value && typeof value === 'object' && !Array.isArray(value)) {
            const mapped: JSONSchema = {}
            for (const [name, child] of Object.entries(value as JSONSchema)) {
                mapped[name] = replaceNode(child, key, ref, descriptions)
            }
            result[childKey] = mapped
        } else if (SUBSCHEMA_KEYS.has(childKey)) {
            result[childKey] = Array.isArray(value)
                ? value.map((child) => replaceNode(child, key, ref, descriptions))
                : replaceNode(value, key, ref, descriptions)
        } else {
            result[childKey] = value
        }
    }
    return result
}

function replaceNode(node: unknown, key: string, ref: string, descriptions: (string | undefined)[]): unknown {
    if (node === null || typeof node !== 'object' || Array.isArray(node)) {
        return node
    }
    const record = node as JSONSchema
    if (typeof record.$ref !== 'string' && canonicalJson(withoutDescription(record)) === key) {
        const description = typeof record.description === 'string' ? record.description : undefined
        descriptions.push(description)
        return description === undefined ? { $ref: ref } : { $ref: ref, description }
    }
    return replaceMatches(record, key, ref, descriptions)
}

/**
 * Moves every sub-schema that appears more than once in one response into `$defs` and points each
 * copy at it with `$ref`. Copies can differ in `description` only; a description every copy shares
 * moves into the definition. Largest saving first, so a repeated property filter inside a repeated
 * series item becomes one definition referenced from another.
 */
export function extractRepeatedDefinitions(schema: JSONSchema): JSONSchema {
    let root: JSONSchema = { ...schema }
    const defs: JSONSchema = { ...(root.$defs as JSONSchema | undefined) }
    const usedNames = new Set(Object.keys(defs))
    for (let round = 0; round < 200; round++) {
        const best = findBestCandidate({ ...root, $defs: defs })
        if (!best) {
            break
        }
        let name = best.name
        for (let suffix = 2; usedNames.has(name); suffix++) {
            name = `${best.name}_${suffix}`
        }
        usedNames.add(name)
        const ref = `#/$defs/${name}`
        const descriptions: (string | undefined)[] = []
        const replaced = replaceMatches({ ...root, $defs: defs }, best.key, ref, descriptions) as JSONSchema
        const { $defs: replacedDefs, ...rest } = replaced
        root = rest
        Object.assign(defs, replacedDefs as JSONSchema)
        const shared = descriptions.every((description) => description === descriptions[0])
            ? descriptions[0]
            : undefined
        defs[name] =
            shared === undefined
                ? withoutDescription(best.node)
                : { ...withoutDescription(best.node), description: shared }
        if (shared !== undefined) {
            root = mapSchema(root, (node) =>
                node.$ref === ref && node.description === shared ? { $ref: ref } : node
            ) as JSONSchema
            for (const [defName, def] of Object.entries(defs)) {
                if (defName !== name) {
                    defs[defName] = mapSchema(def, (node) =>
                        node.$ref === ref && node.description === shared ? { $ref: ref } : node
                    )
                }
            }
        }
    }
    return Object.keys(defs).length > 0 ? { ...root, $defs: defs } : root
}

/** Choice-list stripping plus `$defs` extraction: what `info` and `schema <tool> <path>` print. */
export function compactSchema(schema: JSONSchema): JSONSchema {
    return extractRepeatedDefinitions(mapSchema(schema, stripChoiceLines) as JSONSchema)
}

/** The tool names whose input an update tool most likely repeats, most specific first. */
export function createToolCandidates(toolName: string): string[] {
    const candidates: string[] = []
    const add = (name: string): void => {
        if (name !== toolName && !candidates.includes(name)) {
            candidates.push(name)
        }
    }
    // `annotations-partial-update` pairs with `annotation-create`.
    const singularFirst = (name: string): string => name.replace(/^([a-z]+?)s(?=-|$)/, '$1')
    const base = /-partial-update$/.test(toolName)
        ? toolName.replace(/-partial-update$/, '')
        : /-update$/.test(toolName)
          ? toolName.replace(/-update$/, '')
          : undefined
    if (base !== undefined) {
        add(`${base}-create`)
        add(`${singularFirst(base)}-create`)
    }
    if (/^update-/.test(toolName)) {
        add(toolName.replace(/^update-/, 'create-'))
    }
    return candidates
}

function isPlainSchema(value: unknown): value is JSONSchema {
    return value !== null && typeof value === 'object' && !Array.isArray(value)
}

/** Session key `info` records once it has printed a tool's whole input schema. */
export const infoShownKey = (toolName: string): string => `info:${toolName}`

interface InfoSchemaContext {
    stateManager?: {
        wasShown?: (key: string) => Promise<boolean>
        markShownOnce?: (key: string) => Promise<boolean>
    }
}

interface SiblingTool {
    name: string
    schema: unknown
    rawInputSchema?: Record<string, unknown> | undefined
}

/** A tool's input schema as `info` prints it: the advertised JSON Schema without `output_format`. */
function infoJsonSchema(tool: SiblingTool): JSONSchema | undefined {
    if (tool.rawInputSchema) {
        return tool.rawInputSchema
    }
    try {
        const converted = z.toJSONSchema(tool.schema as z.ZodType, { io: 'input' }) as JSONSchema
        const { output_format: _omitted, ...properties } = (converted.properties ?? {}) as JSONSchema
        return { ...converted, properties }
    } catch {
        return undefined
    }
}

/** Records that `info` printed this tool's whole input schema, so a later update tool can point at it. */
export async function recordInfoShown(context: InfoSchemaContext | undefined, toolName: string): Promise<void> {
    await context?.stateManager?.markShownOnce?.(infoShownKey(toolName))
}

/**
 * The schema `info <tool>` prints: `compactSchema`, plus, for an update tool whose create tool's
 * `info` was already printed in full in this session, a pointer in place of each top-level property
 * that is identical in both (`insight-update`'s `query` is `insight-create`'s). Without that earlier
 * `info`, or without a session, every property is printed.
 */
export async function compactInfoSchema(
    schema: JSONSchema,
    toolName: string,
    options: {
        context?: InfoSchemaContext | undefined
        tools?: () => Promise<readonly SiblingTool[]>
    } = {}
): Promise<JSONSchema> {
    let result = schema
    const stateManager = options.context?.stateManager
    const candidates = createToolCandidates(toolName)
    if (stateManager?.wasShown && options.tools && candidates.length > 0) {
        const tools = await options.tools()
        for (const candidate of candidates) {
            const sibling = tools.find((tool) => tool.name === candidate)
            if (!sibling) {
                continue
            }
            if (!(await stateManager.wasShown(infoShownKey(candidate)))) {
                break
            }
            const siblingProperties = (infoJsonSchema(sibling)?.properties ?? {}) as Record<string, unknown>
            const properties = { ...((schema.properties ?? {}) as Record<string, unknown>) }
            let pointed = false
            for (const [name, property] of Object.entries(properties)) {
                const other = siblingProperties[name]
                if (!isPlainSchema(property) || !isPlainSchema(other)) {
                    continue
                }
                // The update tool's own wording for the field survives; only the schema is shared.
                const ownDescription = typeof property.description === 'string' ? property.description : undefined
                const sameDescription = ownDescription === other.description
                const where = `schema as \`${name}\` on ${candidate}, whose info was shown earlier in this session. Run \`schema ${candidate} ${name}\` to see it again.`
                const pointer = {
                    $ref: `${candidate}#/properties/${name}`,
                    description:
                        sameDescription || ownDescription === undefined
                            ? `Same ${where}`
                            : `${ownDescription} Otherwise the same ${where}`,
                }
                const key = canonicalJson(withoutDescription(property))
                // Point only where the pointer is clearly smaller than the property it replaces.
                if (
                    key === canonicalJson(withoutDescription(other)) &&
                    canonicalJson(property).length > 2 * JSON.stringify(pointer).length
                ) {
                    properties[name] = pointer
                    pointed = true
                }
            }
            if (pointed) {
                result = { ...schema, properties }
            }
            break
        }
    }
    return compactSchema(result)
}
