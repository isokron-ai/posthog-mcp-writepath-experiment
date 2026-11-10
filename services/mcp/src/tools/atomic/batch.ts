import { mapWithConcurrency } from './concurrency'
/**
 * Batch engine: validate every item, then write best-effort with a result per item.
 *
 * A batch over separate REST calls cannot be all-or-nothing: item 7's write can fail after items
 * 1 to 6 are saved, and nothing rolls those back. So the engine makes two promises instead:
 *
 *   1. Validation before writes. Every item is checked first (input, the object exists, what would
 *      change). If any item fails that check, nothing is written and every item says why it was
 *      or was not attempted. A typo in item 7 never leaves items 1 to 6 half-applied.
 *   2. Per-item results. Writes then run best-effort, a few at a time. Each item reports `ok` with
 *      what changed, `unchanged`, or `error`/`conflict` with the reason, and the summary counts
 *      them. With `stop_on_error`, no new writes start after the first failure; the rest are
 *      reported `skipped`.
 *
 * `dry_run` runs step 1 only and reports what each item would do.
 */
import { WriteConflictError, errorMessage } from './errors'

/** Most items one call may carry. Bigger jobs are split by the agent into several calls. */
export const MAX_BATCH_ITEMS = 50

/** Requests in flight at once. Rate limiting (429 + Retry-After) stays with ApiClient. */
export const BATCH_CONCURRENCY = 4

export const BATCH_SEMANTICS =
    'Best-effort, not all-or-nothing: every item was validated before any write; writes that fail are reported per item and the others are kept.'

export type ItemStatus =
    | 'ok'
    | 'unchanged'
    | 'would_change'
    | 'error'
    | 'conflict'
    | 'skipped'
    | 'not_attempted'
    | 'exists'
    | 'not_found'

export interface ItemResult {
    index: number
    status: ItemStatus
    id?: string | number
    /** Field-level receipt: `{field: [before, after]}`. */
    changed?: Record<string, [unknown, unknown]>
    error?: string
    warning?: string
    [extra: string]: unknown
}

export interface BatchSummary {
    requested: number
    ok: number
    unchanged: number
    failed: number
    skipped: number
    written: number
    dry_run: boolean
    atomic: false
    semantics: string
    aborted?: string
}

/**
 * What the agent receives per item. `changed` is one short line, `field: old → new; ...`, so that a
 * batch of uniform items prints as one table row each instead of a nested block per item.
 */
export type ItemReceipt = Omit<ItemResult, 'changed'> & { changed?: string }

export interface BatchResult {
    summary: BatchSummary
    items: ItemReceipt[]
}

export type Prepared<P> =
    | { valid: true; prepared: P; preview: ItemResult; skipWrite?: boolean }
    | { valid: false; result: ItemResult }

export interface BatchSpec<I, P> {
    items: readonly I[]
    dryRun: boolean
    stopOnError: boolean
    /** Validation phase: reads only. Returns the prepared write and a preview of the result. */
    prepare: (item: I, index: number) => Promise<Prepared<P>>
    /** Write phase. Throw to report the item as failed; the batch goes on. */
    execute: (prepared: P, index: number) => Promise<ItemResult>
}

const FAILED: ItemStatus[] = ['error', 'conflict']

export function summarize(items: ItemResult[], dryRun: boolean, written: number, aborted?: string): BatchSummary {
    const count = (statuses: ItemStatus[]): number => items.filter((item) => statuses.includes(item.status)).length
    return {
        requested: items.length,
        ok: count(['ok', 'would_change']),
        unchanged: count(['unchanged', 'exists', 'not_found']),
        failed: count(FAILED),
        skipped: count(['skipped', 'not_attempted']),
        written,
        dry_run: dryRun,
        atomic: false,
        semantics: BATCH_SEMANTICS,
        ...(aborted ? { aborted } : {}),
    }
}

export async function runBatch<I, P>(spec: BatchSpec<I, P>): Promise<BatchResult> {
    const prepared = (await mapWithConcurrency(spec.items, BATCH_CONCURRENCY, async (item, index) => {
        try {
            return await spec.prepare(item, index)
        } catch (error) {
            return { valid: false, result: { index, status: 'error', error: errorMessage(error) } } as Prepared<P>
        }
    })) as Prepared<P>[]

    const invalid = prepared.filter((entry) => !entry.valid)
    if (invalid.length > 0) {
        const items = prepared.map((entry, index): ItemResult => {
            if (!entry.valid) {
                return entry.result
            }
            return { ...entry.preview, index, status: 'not_attempted' }
        })
        return {
            summary: summarize(
                items,
                spec.dryRun,
                0,
                `${invalid.length} item(s) failed validation, so nothing was written. Fix them and send the batch again.`
            ),
            items: items.map(toReceipt),
        }
    }

    if (spec.dryRun) {
        const items = prepared.map((entry) => (entry.valid ? entry.preview : entry.result))
        return { summary: summarize(items, true, 0), items: items.map(toReceipt) }
    }

    let failed = false
    let written = 0
    const outcomes = await mapWithConcurrency(
        prepared,
        BATCH_CONCURRENCY,
        async (entry, index): Promise<ItemResult> => {
            if (!entry.valid) {
                return entry.result
            }
            if (entry.skipWrite) {
                return entry.preview
            }
            try {
                const result = await spec.execute(entry.prepared, index)
                if (result.status === 'ok') {
                    written++
                }
                return result
            } catch (error) {
                failed = true
                return {
                    ...entry.preview,
                    index,
                    status: error instanceof WriteConflictError ? 'conflict' : 'error',
                    changed: undefined,
                    error: errorMessage(error),
                }
            }
        },
        () => spec.stopOnError && failed
    )
    const items = outcomes.map((outcome, index): ItemResult => {
        if (outcome) {
            return outcome
        }
        const entry = prepared[index]!
        const preview = entry.valid ? entry.preview : entry.result
        return {
            ...preview,
            index,
            status: 'skipped',
            changed: undefined,
            error: 'Not started: an earlier write failed and stop_on_error is set.',
        }
    })
    return { summary: summarize(items, false, written), items: items.map(toReceipt) }
}

function short(value: unknown): string {
    const text = JSON.stringify(value ?? null)
    return text.length > 80 ? `${text.slice(0, 77)}...` : text
}

/** `tags: [] → ["legacy"]; deleted: false → true` */
export function describeChanges(changed: Record<string, [unknown, unknown]>): string {
    return Object.entries(changed)
        .map(([field, [before, after]]) => `${field}: ${short(before)} → ${short(after)}`)
        .join('; ')
}

function toReceipt(item: ItemResult): ItemReceipt {
    const { changed, ...rest } = item
    const receipt = Object.fromEntries(Object.entries(rest).filter(([, value]) => value !== undefined)) as ItemReceipt
    if (changed && Object.keys(changed).length > 0) {
        receipt.changed = describeChanges(changed)
    }
    return receipt
}
