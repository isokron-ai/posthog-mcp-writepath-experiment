/**
 * annotations-batch-create and annotations-batch-delete. See batch.ts for the semantics.
 *
 * Each create item is exactly annotation-create's input, validated by the same schema. Two items
 * with the same content, date_marker and scope in one batch are refused unless skip_duplicates is off.
 *
 * Retrying a batch create is safe by default: with `skip_duplicates` (on unless turned off), an item
 * whose content, date_marker and scope match a live annotation is reported `exists` with that
 * annotation's id instead of being created twice. That makes a retry after a timeout or a partial
 * failure idempotent, which a best-effort batch needs.
 *
 * Deletes are soft deletes, as annotation-delete does. An id that does not exist (or is already
 * deleted) is reported `not_found` and does not block the rest: the end state the caller asked for
 * already holds for it.
 */
import { z } from 'zod'

import { canonicalJson } from '@/lib/plain-object'
import type { Context, ToolBase } from '@/tools/types'

import { MAX_BATCH_ITEMS, runBatch, type BatchResult, type ItemResult } from './batch'
import { isNotFound } from './errors'
import { type ApiObject, projectPath } from './resources'
import { getAnnotationCreateSchema } from './validation'

const preview = (content: unknown): string | null => {
    if (typeof content !== 'string') {
        return null
    }
    return content.length > 60 ? `${content.slice(0, 57)}...` : content
}

export const AnnotationsBatchCreateSchema = z.object({
    items: z
        .array(getAnnotationCreateSchema().describe('One annotation, with the same fields as annotation-create.'))
        .min(1)
        .max(MAX_BATCH_ITEMS)
        .describe(`The annotations to create, at most ${MAX_BATCH_ITEMS} per call.`),
    skip_duplicates: z
        .boolean()
        .optional()
        .describe(
            'Default true. Report an item whose content, date_marker and scope match a live annotation as `exists` instead of creating it again, so a retried batch does not duplicate.'
        ),
    dry_run: z.boolean().optional().describe('Validate every item and report what would be created, without writing.'),
    stop_on_error: z
        .boolean()
        .optional()
        .describe('Start no further creates after the first failed one. The rest are reported as skipped.'),
})

const sameInstant = (a: unknown, b: unknown): boolean =>
    typeof a === 'string' && typeof b === 'string' && Date.parse(a) === Date.parse(b)

async function findDuplicate(context: Context, projectId: string, item: ApiObject): Promise<ApiObject | undefined> {
    if (typeof item.content !== 'string' || item.content.length === 0) {
        return undefined
    }
    const page = await context.api.request<{ results?: ApiObject[] }>({
        method: 'GET',
        path: projectPath(projectId, 'annotations/'),
        query: { search: item.content, limit: 100 },
    })
    const scope = item.scope ?? 'project'
    return page.results?.find(
        (row) =>
            row.deleted !== true &&
            row.content === item.content &&
            sameInstant(row.date_marker, item.date_marker) &&
            (row.scope ?? 'project') === scope &&
            (row.dashboard_item ?? null) === (item.dashboard_item ?? null) &&
            (row.dashboard_id ?? null) === (item.dashboard_id ?? null)
    )
}

const createReceipt = (index: number, annotation: ApiObject, status: ItemResult['status']): ItemResult => ({
    index,
    status,
    ...(annotation.id !== undefined ? { id: annotation.id as number } : {}),
    content: preview(annotation.content),
    date_marker: (annotation.date_marker as string | null | undefined) ?? null,
    scope: (annotation.scope as string | undefined) ?? 'project',
})

export async function annotationsBatchCreate(
    context: Context,
    params: z.infer<typeof AnnotationsBatchCreateSchema>
): Promise<BatchResult> {
    const projectId = await context.stateManager.getProjectId()
    const skipDuplicates = params.skip_duplicates ?? true
    const seen = new Map<string, number>()
    return await runBatch<ApiObject, ApiObject>({
        items: params.items,
        dryRun: params.dry_run ?? false,
        stopOnError: params.stop_on_error ?? false,
        prepare: async (raw, index) => {
            const item = Object.fromEntries(Object.entries(raw).filter(([, value]) => value !== undefined))
            if (!item.content || !item.date_marker) {
                return {
                    valid: false,
                    result: { index, status: 'error', error: 'content and date_marker are required' },
                }
            }
            const key = canonicalJson([
                item.content,
                Date.parse(String(item.date_marker)),
                item.scope ?? 'project',
                item.dashboard_item ?? null,
                item.dashboard_id ?? null,
            ])
            const first = seen.get(key)
            if (skipDuplicates && first !== undefined && first !== index) {
                return {
                    valid: false,
                    result: { index, status: 'error', error: `same content, date_marker and scope as item ${first}` },
                }
            }
            seen.set(key, first ?? index)
            const existing = skipDuplicates ? await findDuplicate(context, projectId, item) : undefined
            if (existing) {
                return {
                    valid: true,
                    prepared: item,
                    preview: createReceipt(index, existing, 'exists'),
                    skipWrite: true,
                }
            }
            return { valid: true, prepared: item, preview: createReceipt(index, item, 'would_change') }
        },
        execute: async (item, index) => {
            const created = await context.api.request<ApiObject>({
                method: 'POST',
                path: projectPath(projectId, 'annotations/'),
                body: item,
            })
            return createReceipt(index, created, 'ok')
        },
    })
}

export const AnnotationsBatchDeleteSchema = z.object({
    ids: z
        .array(z.number().int())
        .min(1)
        .max(MAX_BATCH_ITEMS)
        .describe(`Ids of the annotations to soft-delete, at most ${MAX_BATCH_ITEMS} per call.`),
    dry_run: z
        .boolean()
        .optional()
        .describe('Check that every annotation exists and report what would be deleted, without deleting.'),
    stop_on_error: z
        .boolean()
        .optional()
        .describe('Start no further deletes after the first failed one. The rest are reported as skipped.'),
})

export async function annotationsBatchDelete(
    context: Context,
    params: z.infer<typeof AnnotationsBatchDeleteSchema>
): Promise<BatchResult> {
    const projectId = await context.stateManager.getProjectId()
    const dryRun = params.dry_run ?? false
    const ids = [...new Set(params.ids)]
    const path = (id: number): string => projectPath(projectId, `annotations/${encodeURIComponent(String(id))}/`)
    const gone = (index: number, id: number): ItemResult => ({
        index,
        id,
        status: 'not_found',
        error: 'No live annotation with this id (it may already be deleted).',
    })
    return await runBatch<number, number>({
        items: ids,
        dryRun,
        stopOnError: params.stop_on_error ?? false,
        prepare: async (id, index) => {
            // A real delete needs no read first: the PATCH itself answers 404 for a missing id.
            if (!dryRun) {
                return { valid: true, prepared: id, preview: { index, id, status: 'would_change' } }
            }
            try {
                const annotation = await context.api.request<ApiObject>({ method: 'GET', path: path(id) })
                if (annotation.deleted === true) {
                    return { valid: true, prepared: id, preview: gone(index, id), skipWrite: true }
                }
                return {
                    valid: true,
                    prepared: id,
                    preview: { index, id, status: 'would_change', content: preview(annotation.content) },
                }
            } catch (error) {
                if (isNotFound(error)) {
                    return { valid: true, prepared: id, preview: gone(index, id), skipWrite: true }
                }
                throw error
            }
        },
        execute: async (id, index) => {
            try {
                const deleted = await context.api.request<ApiObject>({
                    method: 'PATCH',
                    path: path(id),
                    body: { deleted: true },
                })
                return {
                    index,
                    id,
                    status: 'ok',
                    content: preview(deleted.content),
                    changed: { deleted: [false, true] },
                }
            } catch (error) {
                if (isNotFound(error)) {
                    return gone(index, id)
                }
                throw error
            }
        },
    })
}

export const annotationsBatchCreateTool = (): ToolBase<typeof AnnotationsBatchCreateSchema, BatchResult> => ({
    name: 'annotations-batch-create',
    schema: AnnotationsBatchCreateSchema,
    handler: annotationsBatchCreate,
})

export const annotationsBatchDeleteTool = (): ToolBase<typeof AnnotationsBatchDeleteSchema, BatchResult> => ({
    name: 'annotations-batch-delete',
    schema: AnnotationsBatchDeleteSchema,
    handler: annotationsBatchDelete,
})
