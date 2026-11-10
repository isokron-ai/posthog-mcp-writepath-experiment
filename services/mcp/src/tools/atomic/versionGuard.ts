/**
 * Version-checked read-merge-write.
 *
 * A partial update in the MCP layer has to read the object, change one part, and write the field
 * back whole, because the REST endpoints replace nested arrays (flag conditions, survey questions,
 * an insight's query) as a unit. Done naively, a second writer's change that lands between the read
 * and the write is silently overwritten: the lost-update bug. This module wraps that sequence:
 *
 *   1. Lock the object inside this process (KeyedMutex), so two MCP updates of the same object
 *      through this server run one after the other instead of racing.
 *   2. Read the object, and refuse when the agent's `base_version` no longer matches.
 *   3. Build the change from what was just read (the caller's `plan`), and validate it.
 *   4. Re-read the object immediately before the write and compare its version marker and the
 *      fields being written. If anything changed, write nothing and raise a WriteConflictError.
 *   5. Write, sending the endpoint's own precondition when it has one (a flag's `version`), and map
 *      the API's 409 to the same conflict.
 *   6. Where the endpoint keeps a write counter (a flag's `version`), check that the write moved it
 *      by exactly one. More than one means another write landed in the window; the receipt says so.
 *
 * What remains: between step 4's re-read and step 5's write (one API round trip) a writer outside
 * this process (the UI, another server instance) can still land a change, and an endpoint without
 * a precondition will accept our write on top of it. For flags step 6 detects this after the fact;
 * for insights and surveys nothing in the API can.
 */
import { canonicalJson, isRecord } from '@/lib/plain-object'

import { KeyedMutex, objectLocks } from './concurrency'
import { WriteConflictError, errorStatus } from './errors'

export interface VersionedResource<T extends Record<string, unknown>> {
    /** Human name used in messages, e.g. `insight`. */
    kind: string
    id: string | number
    /** Lock key; include the project so two projects never share a lock. */
    lockKey: string
    read(): Promise<T>
    /** Fields that change on every accepted write (updated_at, last_modified_at, version). Missing ones are skipped. */
    markerFields: readonly string[]
    /** The value an agent sends back as `base_version`: a flag's version, an insight's updated_at. */
    agentVersion(object: T): string | number | null | undefined
    write(body: Record<string, unknown>, base: T): Promise<T>
    /** For an endpoint with a write counter: what the counter must read after exactly one write on `base`. */
    expectedCounterAfterWrite?(base: T): number | undefined
    counter?(object: T): number | undefined
}

/** What the caller wants written, computed from the object as it was just read. */
export type UpdatePlan = { body: Record<string, unknown> } | { unchanged: true }

export interface GuardedUpdateResult<T> {
    status: 'ok' | 'unchanged' | 'dry_run'
    before: T
    /** The object the write returned. Undefined when nothing was written. */
    after?: T
    body?: Record<string, unknown>
    /** True when the write counter shows another write landed in the race window. */
    concurrentWriteDetected?: boolean
    warning?: string
}

export interface GuardedUpdateOptions<T> {
    /** The version the agent last read. When set and the object has moved on, nothing is written. */
    baseVersion?: string | number | null | undefined
    dryRun?: boolean | undefined
    /** A pre-image the caller already read (a batch validates every item first). Skips the first read. */
    base?: T | undefined
    locks?: KeyedMutex
}

function pick(object: Record<string, unknown>, fields: readonly string[]): Record<string, unknown> {
    const out: Record<string, unknown> = {}
    for (const field of fields) {
        if (Object.prototype.hasOwnProperty.call(object, field)) {
            out[field] = object[field]
        }
    }
    return out
}

/** The version marker plus the content of the fields about to be written. */
export function fingerprint(
    object: Record<string, unknown>,
    markerFields: readonly string[],
    writtenFields: readonly string[]
): string {
    return canonicalJson({ markers: pick(object, markerFields), fields: pick(object, writtenFields) })
}

function describeMarkers(object: Record<string, unknown>, markerFields: readonly string[]): string {
    const markers = pick(object, markerFields)
    const parts = Object.entries(markers).map(([key, value]) => `${key} ${JSON.stringify(value)}`)
    return parts.length > 0 ? parts.join(', ') : 'content'
}

export async function versionCheckedUpdate<T extends Record<string, unknown>>(
    resource: VersionedResource<T>,
    plan: (current: T) => UpdatePlan | Promise<UpdatePlan>,
    options: GuardedUpdateOptions<T> = {}
): Promise<GuardedUpdateResult<T>> {
    const locks = options.locks ?? objectLocks
    return await locks.runExclusive(resource.lockKey, async () => {
        const before = options.base ?? (await resource.read())

        if (options.baseVersion !== undefined && options.baseVersion !== null) {
            const current = resource.agentVersion(before)
            if (String(current) !== String(options.baseVersion)) {
                throw new WriteConflictError(
                    `Conflict: ${resource.kind} ${resource.id} has changed since the version you read ` +
                        `(you sent base_version ${JSON.stringify(options.baseVersion)}, it is now ${JSON.stringify(current)}). ` +
                        `Nothing was written. Read it again and redo the change against the new version.`,
                    { kind: resource.kind, id: resource.id, before: options.baseVersion, now: current }
                )
            }
        }

        const planned = await plan(before)
        if ('unchanged' in planned) {
            return { status: 'unchanged', before }
        }
        if (options.dryRun) {
            return { status: 'dry_run', before, body: planned.body }
        }

        // Re-read immediately before writing: the narrowest window the REST API allows.
        const writtenFields = Object.keys(planned.body).filter((field) => field !== 'version')
        const check = await resource.read()
        const expected = fingerprint(before, resource.markerFields, writtenFields)
        if (fingerprint(check, resource.markerFields, writtenFields) !== expected) {
            throw new WriteConflictError(
                `Conflict: ${resource.kind} ${resource.id} was changed by someone else while this update was being ` +
                    `prepared (${describeMarkers(before, resource.markerFields)} → ${describeMarkers(check, resource.markerFields)}). ` +
                    `Nothing was written. Read it again and retry the change.`,
                {
                    kind: resource.kind,
                    id: resource.id,
                    before: pick(before, resource.markerFields),
                    now: pick(check, resource.markerFields),
                }
            )
        }

        let after: T
        try {
            after = await resource.write(planned.body, before)
        } catch (error) {
            if (errorStatus(error) === 409) {
                throw new WriteConflictError(
                    `Conflict: the API refused the write because ${resource.kind} ${resource.id} changed after version ` +
                        `${JSON.stringify(resource.agentVersion(before))}. Nothing was written. Read it again and retry the change.`,
                    { kind: resource.kind, id: resource.id, before: resource.agentVersion(before) }
                )
            }
            throw error
        }

        const result: GuardedUpdateResult<T> = { status: 'ok', before, after, body: planned.body }
        const expectedCounter = resource.expectedCounterAfterWrite?.(before)
        const actualCounter = isRecord(after) ? resource.counter?.(after) : undefined
        if (expectedCounter !== undefined && actualCounter !== undefined && actualCounter > expectedCounter) {
            result.concurrentWriteDetected = true
            result.warning =
                `Another write to ${resource.kind} ${resource.id} landed between the final check and this write ` +
                `(version is ${actualCounter}, expected ${expectedCounter}). This change was applied, but it may have ` +
                `replaced that other change. Read the ${resource.kind} again and check it before going on.`
        }
        return result
    })
}
