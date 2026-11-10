/**
 * JSON Patch (RFC 6902) and JSON Merge Patch (RFC 7396) over plain JSON values.
 *
 * Both functions are pure: they clone the input and return a new document, so a patch that fails
 * half-way leaves the caller's copy untouched. A JSON Patch is applied all-or-nothing: if any
 * operation fails (a missing path, a failed `test`), the whole patch is rejected with the index of
 * the failing operation, and nothing is returned.
 *
 * Pointer segments `__proto__`, `constructor` and `prototype` are refused, so a patch read from a
 * tool call cannot reach an object's prototype.
 */
import { z } from 'zod'

import { canonicalJson, isRecord } from '@/lib/plain-object'

export const JsonPatchOperationSchema = z
    .object({
        op: z
            .enum(['add', 'remove', 'replace', 'move', 'copy', 'test'])
            .describe(
                'RFC 6902 operation. `test` checks that the value at `path` equals `value` and rejects the whole patch if not.'
            ),
        path: z
            .string()
            .describe(
                'JSON Pointer (RFC 6901) into the target, e.g. `/source/series/1/event`. `-` appends to an array.'
            ),
        value: z.unknown().optional().describe('The value for `add`, `replace` and `test`.'),
        from: z.string().optional().describe('Source JSON Pointer for `move` and `copy`.'),
    })
    .describe('One JSON Patch operation.')

export type JsonPatchOperation = z.infer<typeof JsonPatchOperationSchema>

export class JsonPatchError extends Error {
    constructor(
        message: string,
        public readonly operationIndex: number
    ) {
        super(message)
        this.name = 'JsonPatchError'
    }
}

const FORBIDDEN_SEGMENTS = new Set(['__proto__', 'constructor', 'prototype'])

export function cloneJson<T>(value: T): T {
    return value === undefined ? value : (JSON.parse(JSON.stringify(value)) as T)
}

export function parsePointer(pointer: string): string[] {
    if (pointer === '') {
        return []
    }
    if (!pointer.startsWith('/')) {
        throw new Error(`JSON Pointer "${pointer}" must be empty or start with "/"`)
    }
    return pointer
        .slice(1)
        .split('/')
        .map((segment) => {
            const decoded = segment.replace(/~1/g, '/').replace(/~0/g, '~')
            if (FORBIDDEN_SEGMENTS.has(decoded)) {
                throw new Error(`JSON Pointer segment "${decoded}" is not allowed`)
            }
            return decoded
        })
}

function arrayIndex(segment: string, length: number, allowEnd: boolean): number {
    if (allowEnd && segment === '-') {
        return length
    }
    if (!/^(0|[1-9][0-9]*)$/.test(segment)) {
        throw new Error(`"${segment}" is not an array index`)
    }
    const index = Number(segment)
    const max = allowEnd ? length : length - 1
    if (index > max) {
        throw new Error(`array index ${index} is out of range (length ${length})`)
    }
    return index
}

/** Returns the value at `pointer`, or throws when the path does not exist. */
export function getAtPointer(doc: unknown, pointer: string): unknown {
    let current: unknown = doc
    for (const segment of parsePointer(pointer)) {
        if (Array.isArray(current)) {
            current = current[arrayIndex(segment, current.length, false)]
        } else if (isRecord(current) && Object.prototype.hasOwnProperty.call(current, segment)) {
            current = current[segment]
        } else {
            throw new Error(`path "${pointer}" does not exist`)
        }
    }
    return current
}

/** True when `pointer` resolves in `doc`. */
export function hasPointer(doc: unknown, pointer: string): boolean {
    try {
        getAtPointer(doc, pointer)
        return true
    } catch {
        return false
    }
}

type Parent = { container: unknown[] | Record<string, unknown>; key: string }

function resolveParent(doc: unknown, pointer: string): Parent {
    const segments = parsePointer(pointer)
    if (segments.length === 0) {
        throw new Error('the root cannot be the target of this operation')
    }
    const key = segments[segments.length - 1]!
    const parentPointer = segments
        .slice(0, -1)
        .map((s) => '/' + s.replace(/~/g, '~0').replace(/\//g, '~1'))
        .join('')
    const container = getAtPointer(doc, parentPointer)
    if (!Array.isArray(container) && !isRecord(container)) {
        throw new Error(`the parent of "${pointer}" is not an object or array`)
    }
    return { container, key }
}

function addValue(doc: unknown, pointer: string, value: unknown): unknown {
    if (pointer === '') {
        return value
    }
    const { container, key } = resolveParent(doc, pointer)
    if (Array.isArray(container)) {
        container.splice(arrayIndex(key, container.length, true), 0, value)
    } else {
        container[key] = value
    }
    return doc
}

function removeValue(doc: unknown, pointer: string): unknown {
    const { container, key } = resolveParent(doc, pointer)
    if (Array.isArray(container)) {
        container.splice(arrayIndex(key, container.length, false), 1)
    } else {
        if (!Object.prototype.hasOwnProperty.call(container, key)) {
            throw new Error(`path "${pointer}" does not exist`)
        }
        delete container[key]
    }
    return doc
}

/** Applies an RFC 6902 patch to a clone of `doc`. All operations apply, or none do. */
export function applyJsonPatch(doc: unknown, operations: readonly JsonPatchOperation[]): unknown {
    let working = cloneJson(doc)
    operations.forEach((operation, index) => {
        try {
            switch (operation.op) {
                case 'add':
                    working = addValue(working, operation.path, cloneJson(operation.value))
                    break
                case 'remove':
                    working = removeValue(working, operation.path)
                    break
                case 'replace':
                    if (operation.path === '') {
                        working = cloneJson(operation.value)
                        break
                    }
                    getAtPointer(working, operation.path)
                    working = removeValue(working, operation.path)
                    working = addValue(working, operation.path, cloneJson(operation.value))
                    break
                case 'move': {
                    if (operation.from === undefined) {
                        throw new Error('`move` needs `from`')
                    }
                    if (operation.path.startsWith(operation.from + '/')) {
                        throw new Error('cannot move a value into one of its own children')
                    }
                    const moved = getAtPointer(working, operation.from)
                    working = removeValue(working, operation.from)
                    working = addValue(working, operation.path, moved)
                    break
                }
                case 'copy': {
                    if (operation.from === undefined) {
                        throw new Error('`copy` needs `from`')
                    }
                    working = addValue(working, operation.path, cloneJson(getAtPointer(working, operation.from)))
                    break
                }
                case 'test': {
                    const actual = getAtPointer(working, operation.path)
                    if (canonicalJson(actual) !== canonicalJson(operation.value)) {
                        throw new Error(`test failed: the value at "${operation.path}" is ${canonicalJson(actual)}`)
                    }
                    break
                }
            }
        } catch (error) {
            const reason = error instanceof Error ? error.message : String(error)
            throw new JsonPatchError(`operation ${index} (${operation.op} ${operation.path}): ${reason}`, index)
        }
    })
    return working
}

/** Applies an RFC 7396 merge patch: objects merge key by key, `null` deletes a key, anything else replaces. */
export function applyMergePatch(target: unknown, patch: unknown): unknown {
    if (!isRecord(patch)) {
        return cloneJson(patch)
    }
    const result: Record<string, unknown> = isRecord(target) ? cloneJson(target) : {}
    for (const [key, value] of Object.entries(patch)) {
        if (FORBIDDEN_SEGMENTS.has(key)) {
            throw new Error(`merge patch key "${key}" is not allowed`)
        }
        if (value === null) {
            delete result[key]
        } else {
            result[key] = applyMergePatch(result[key], value)
        }
    }
    return result
}

/**
 * Leaf-level differences between two JSON values, as `{pointer: [before, after]}`.
 * Stops after `limit` entries so a large rewrite cannot flood a receipt; `truncated` says so.
 */
export function diffJson(
    before: unknown,
    after: unknown,
    limit = 20
): { changes: Record<string, [unknown, unknown]>; truncated: boolean } {
    const changes: Record<string, [unknown, unknown]> = {}
    let count = 0
    let truncated = false
    const escape = (s: string): string => s.replace(/~/g, '~0').replace(/\//g, '~1')
    const walk = (a: unknown, b: unknown, pointer: string): void => {
        if (truncated || canonicalJson(a) === canonicalJson(b)) {
            return
        }
        const bothArrays = Array.isArray(a) && Array.isArray(b)
        const bothObjects = isRecord(a) && isRecord(b)
        if (bothArrays) {
            const length = Math.max(a.length, b.length)
            for (let i = 0; i < length; i++) {
                walk(a[i], b[i], `${pointer}/${i}`)
            }
            return
        }
        if (bothObjects) {
            const keys = new Set([...Object.keys(a), ...Object.keys(b)])
            for (const key of [...keys].sort()) {
                walk(a[key], b[key], `${pointer}/${escape(key)}`)
            }
            return
        }
        if (count >= limit) {
            truncated = true
            return
        }
        changes[pointer || '/'] = [a ?? null, b ?? null]
        count++
    }
    walk(before, after, '')
    return { changes, truncated }
}
