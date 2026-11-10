/**
 * insights-batch-update: change name, description, tags, favorited or soft-delete across many
 * insights in one call, with a result per insight. See batch.ts for the semantics.
 *
 * `tags` replaces an insight's tags. `add_tags` and `remove_tags` edit them in place, which is a
 * read-merge-write, so those items go through the version guard: if the insight changed between
 * the validation read and the write, that item reports `conflict` and is not written.
 */
import { z } from 'zod'

import * as orvalSchemas from '@/generated/product_analytics/api'
import { canonicalJson } from '@/lib/plain-object'
import type { Context, ToolBase } from '@/tools/types'

import { MAX_BATCH_ITEMS, runBatch, type BatchResult, type ItemResult } from './batch'
import { type ApiObject, insightResource, resolveInsightId } from './resources'
import { versionCheckedUpdate, type VersionedResource } from './versionGuard'

const body = orvalSchemas.InsightsPartialUpdateBody().shape

const TagList = z.array(z.string().min(1)).max(50)

export const InsightBatchItemSchema = z
    .object({
        id: z.union([z.number().int(), z.string().min(1)]).describe('Insight id or short_id.'),
        name: body.name.describe('New name.'),
        description: body.description.describe('New description. Null clears it.'),
        tags: TagList.optional().describe("Replace all of the insight's tags with this list."),
        add_tags: TagList.optional().describe('Tags to add, keeping the existing ones.'),
        remove_tags: TagList.optional().describe('Tags to remove, keeping the others.'),
        favorited: z.boolean().optional().describe('Star or unstar the insight.'),
        deleted: z
            .literal(true)
            .optional()
            .describe('Soft-delete the insight, as insight-delete does. Insights have no separate archive state.'),
    })
    .strict()
    .superRefine((item, ctx) => {
        const fields = ['name', 'description', 'tags', 'add_tags', 'remove_tags', 'favorited', 'deleted'] as const
        if (!fields.some((field) => item[field] !== undefined)) {
            ctx.addIssue({ code: 'custom', message: `give at least one of ${fields.join(', ')}` })
        }
        if (item.tags !== undefined && (item.add_tags !== undefined || item.remove_tags !== undefined)) {
            ctx.addIssue({
                code: 'custom',
                message: 'use either `tags` (replace) or `add_tags`/`remove_tags`, not both',
            })
        }
    })
    .describe('One insight and the changes to make to it.')

export type InsightBatchItem = z.infer<typeof InsightBatchItemSchema>

export const InsightsBatchUpdateSchema = z.object({
    items: z
        .array(InsightBatchItemSchema)
        .min(1)
        .max(MAX_BATCH_ITEMS)
        .describe(`The insights to change, at most ${MAX_BATCH_ITEMS} per call.`),
    dry_run: z
        .boolean()
        .optional()
        .describe('Validate every item and report what would change, without writing anything.'),
    stop_on_error: z
        .boolean()
        .optional()
        .describe('Start no further writes after the first failed one. The rest are reported as skipped.'),
})

const uniq = (tags: readonly string[]): string[] => [...new Set(tags)]

/** The PATCH body for `item`, computed from the insight as it is now. Only fields that change are kept. */
export function planInsightChange(item: InsightBatchItem, current: ApiObject): Record<string, unknown> {
    const next: Record<string, unknown> = {}
    const currentTags = Array.isArray(current.tags) ? (current.tags as string[]) : []
    if (item.name !== undefined) {
        next.name = item.name
    }
    if (item.description !== undefined) {
        next.description = item.description
    }
    if (item.favorited !== undefined) {
        next.favorited = item.favorited
    }
    if (item.deleted) {
        next.deleted = true
    }
    if (item.tags !== undefined) {
        next.tags = uniq(item.tags)
    } else if (item.add_tags !== undefined || item.remove_tags !== undefined) {
        const remove = new Set(item.remove_tags ?? [])
        next.tags = uniq([...currentTags, ...(item.add_tags ?? [])]).filter((tag) => !remove.has(tag))
    }
    for (const [field, value] of Object.entries(next)) {
        const same =
            field === 'tags'
                ? canonicalJson([...(value as string[])].sort()) === canonicalJson([...currentTags].sort())
                : canonicalJson(value) === canonicalJson(current[field] ?? (field === 'deleted' ? false : null))
        if (same) {
            delete next[field]
        }
    }
    return next
}

function changedFields(before: ApiObject, after: ApiObject, fields: string[]): Record<string, [unknown, unknown]> {
    const out: Record<string, [unknown, unknown]> = {}
    for (const field of fields) {
        out[field] = [before[field] ?? (field === 'deleted' ? false : null), after[field] ?? null]
    }
    return out
}

type PreparedItem = {
    item: InsightBatchItem
    id: number
    resource: VersionedResource<ApiObject>
    before: ApiObject
    body: Record<string, unknown>
}

const receiptBase = (index: number, id: number, insight: ApiObject): ItemResult => ({
    index,
    status: 'ok',
    id,
    short_id: insight.short_id as string | undefined,
    name: (insight.name as string | null | undefined) ?? null,
})

export async function insightsBatchUpdate(
    context: Context,
    params: z.infer<typeof InsightsBatchUpdateSchema>
): Promise<BatchResult> {
    const projectId = await context.stateManager.getProjectId()
    return await runBatch<InsightBatchItem, PreparedItem>({
        items: params.items,
        dryRun: params.dry_run ?? false,
        stopOnError: params.stop_on_error ?? false,
        prepare: async (item, index) => {
            const id = await resolveInsightId(context, projectId, item.id)
            const resource = insightResource(context, projectId, id)
            const before = await resource.read()
            const planned = planInsightChange(item, before)
            const fields = Object.keys(planned)
            if (fields.length === 0) {
                return {
                    valid: true,
                    prepared: { item, id, resource, before, body: planned },
                    preview: { ...receiptBase(index, id, before), status: 'unchanged' },
                    skipWrite: true,
                }
            }
            return {
                valid: true,
                prepared: { item, id, resource, before, body: planned },
                preview: {
                    ...receiptBase(index, id, before),
                    status: 'would_change',
                    changed: changedFields(before, planned, fields),
                },
            }
        },
        execute: async ({ item, id, resource, before, body: planned }, index) => {
            const merges = item.add_tags !== undefined || item.remove_tags !== undefined
            let after: ApiObject
            let written: Record<string, unknown> = planned
            if (merges) {
                const result = await versionCheckedUpdate(
                    resource,
                    (current) => {
                        const next = planInsightChange(item, current)
                        return Object.keys(next).length > 0 ? { body: next } : { unchanged: true }
                    },
                    { base: before }
                )
                if (result.status !== 'ok' || !result.after) {
                    return { ...receiptBase(index, id, before), status: 'unchanged' }
                }
                after = result.after
                written = result.body ?? planned
            } else {
                after = await resource.write(planned, before)
            }
            return {
                ...receiptBase(index, id, after),
                changed: changedFields(
                    before,
                    { ...after, ...(written.deleted ? { deleted: true } : {}) },
                    Object.keys(written)
                ),
            }
        },
    })
}

export default (): ToolBase<typeof InsightsBatchUpdateSchema, BatchResult> => ({
    name: 'insights-batch-update',
    schema: InsightsBatchUpdateSchema,
    handler: insightsBatchUpdate,
})
