import { describe, expect, it } from 'vitest'

import { PostHogApiError } from '@/lib/errors'
import {
    annotationsBatchCreate,
    annotationsBatchDelete,
    AnnotationsBatchCreateSchema,
} from '@/tools/atomic/annotationsBatch'
import { MAX_BATCH_ITEMS } from '@/tools/atomic/batch'
import { insightsBatchUpdate, InsightsBatchUpdateSchema, planInsightChange } from '@/tools/atomic/insightsBatchUpdate'

import { FakePostHog, jitter } from '../fixtures/fake-posthog-backend'

function withInsights(count: number, options: ConstructorParameters<typeof FakePostHog>[0] = {}): FakePostHog {
    const fake = new FakePostHog(options)
    for (let i = 0; i < count; i++) {
        fake.seed('insights', {
            id: 80 + i,
            short_id: `short${String(i).padStart(3, '0')}`,
            name: `old ${i}`,
            description: null,
            query: { kind: 'InsightVizNode', source: { kind: 'TrendsQuery', series: [] } },
            tags: i % 2 === 0 ? ['keep'] : [],
            favorited: false,
        })
    }
    return fake
}

const parse = <T>(schema: { parse: (value: unknown) => T }, value: unknown): T => schema.parse(value)

describe('insights-batch-update', () => {
    it('tags ten insights in one call with a result per insight and a summary', async () => {
        const fake = withInsights(10, { latency: jitter(0, 2) })
        const result = await insightsBatchUpdate(
            fake.context(),
            parse(InsightsBatchUpdateSchema, {
                items: Array.from({ length: 10 }, (_, i) => ({ id: 80 + i, add_tags: ['legacy'] })),
            })
        )
        expect(result.summary).toMatchObject({
            requested: 10,
            ok: 10,
            failed: 0,
            written: 10,
            atomic: false,
            dry_run: false,
        })
        expect(result.items[0]).toMatchObject({
            index: 0,
            id: 80,
            status: 'ok',
            changed: 'tags: ["keep"] → ["keep","legacy"]',
        })
        expect(result.items[1]).toMatchObject({ id: 81, changed: 'tags: [] → ["legacy"]' })
        expect(fake.get('insights', 80)!.tags).toEqual(['keep', 'legacy'])
        // add_tags kept the existing tag: the merge is computed from the stored insight.
        expect(fake.get('insights', 81)!.tags).toEqual(['legacy'])
    })

    it('validates every item before writing: one bad id means nothing is written', async () => {
        const fake = withInsights(3)
        const result = await insightsBatchUpdate(
            fake.context(),
            parse(InsightsBatchUpdateSchema, {
                items: [
                    { id: 80, name: 'new 0' },
                    { id: 999, name: 'missing' },
                    { id: 'short002', deleted: true },
                ],
            })
        )
        expect(fake.writes()).toHaveLength(0)
        expect(result.summary).toMatchObject({ written: 0, failed: 1, skipped: 2 })
        expect(result.summary.aborted).toMatch(/nothing was written/)
        expect(result.items.map((item) => item.status)).toEqual(['not_attempted', 'error', 'not_attempted'])
        expect(result.items[1]!.error).toMatch(/404|Not Found/)
    })

    it('dry_run reports what would change and writes nothing', async () => {
        const fake = withInsights(2)
        const result = await insightsBatchUpdate(
            fake.context(),
            parse(InsightsBatchUpdateSchema, {
                dry_run: true,
                items: [
                    { id: 80, name: 'renamed', tags: ['keep'] },
                    { id: 81, favorited: false },
                ],
            })
        )
        expect(fake.writes()).toHaveLength(0)
        expect(result.summary).toMatchObject({ dry_run: true, written: 0, ok: 1, unchanged: 1 })
        // tags: ['keep'] is already the value, so only the name would change.
        expect(result.items[0]).toMatchObject({ status: 'would_change', changed: 'name: "old 0" → "renamed"' })
        expect(result.items[0]!.changed).not.toContain('tags')
        expect(result.items[1]).toMatchObject({ status: 'unchanged' })
    })

    it('is best-effort after validation: a failed write is reported on its item and the others are kept', async () => {
        const fake = withInsights(4)
        fake.failWhen = (request) =>
            request.method === 'PATCH' && request.path.endsWith('/insights/82/')
                ? new PostHogApiError({
                      status: 500,
                      statusText: 'Server Error',
                      body: '',
                      url: request.path,
                      method: 'PATCH',
                  })
                : undefined
        const result = await insightsBatchUpdate(
            fake.context(),
            parse(InsightsBatchUpdateSchema, { items: [80, 81, 82, 83].map((id) => ({ id, deleted: true })) })
        )
        expect(result.summary).toMatchObject({ ok: 3, failed: 1, written: 3 })
        expect(result.items[2]).toMatchObject({ id: 82, status: 'error' })
        expect(result.items[0]).toMatchObject({ status: 'ok', changed: 'deleted: false → true' })
        expect(fake.get('insights', 83)!.deleted).toBe(true)
    })

    it('stop_on_error starts no further writes after the first failure', async () => {
        const fake = withInsights(5)
        fake.failWhen = (request) =>
            request.method === 'PATCH' && request.path.endsWith('/insights/80/')
                ? new PostHogApiError({
                      status: 500,
                      statusText: 'Server Error',
                      body: '',
                      url: request.path,
                      method: 'PATCH',
                  })
                : undefined
        const result = await insightsBatchUpdate(
            fake.context(),
            parse(InsightsBatchUpdateSchema, {
                stop_on_error: true,
                items: [80, 81, 82, 83, 84].map((id) => ({ id, name: 'x' })),
            })
        )
        // Four writes start at once (the fan-out width), so at most those four run; the fifth never starts.
        expect(result.items[4]).toMatchObject({ status: 'skipped' })
        expect(result.summary.failed).toBe(1)
    })

    it('reports a conflict, without writing, when an add_tags insight changed after validation', async () => {
        const fake = withInsights(2)
        let first = true
        fake.beforeWrite = undefined
        const original = fake.request
        // Change insight 80 from outside right after the validation read.
        fake.request = (async (opts: { method: string; path: string }) => {
            const response = await original(opts as never)
            if (first && opts.method === 'GET' && opts.path.endsWith('/insights/80/')) {
                first = false
                fake.externalPatch('insights', 80, { tags: ['set-in-ui'] })
            }
            return response
        }) as typeof fake.request
        const result = await insightsBatchUpdate(
            fake.context(),
            parse(InsightsBatchUpdateSchema, {
                items: [
                    { id: 80, add_tags: ['legacy'] },
                    { id: 81, add_tags: ['legacy'] },
                ],
            })
        )
        expect(result.items[0]).toMatchObject({ status: 'conflict' })
        expect(result.items[0]!.error).toMatch(/Nothing was written/)
        expect(fake.get('insights', 80)!.tags).toEqual(['set-in-ui'])
        expect(result.items[1]).toMatchObject({ status: 'ok' })
    })

    it('rejects bad items at the schema: unknown keys, no change, tags with add_tags, too many items', () => {
        expect(InsightsBatchUpdateSchema.safeParse({ items: [{ id: 1, title: 'x' }] }).success).toBe(false)
        expect(InsightsBatchUpdateSchema.safeParse({ items: [{ id: 1 }] }).success).toBe(false)
        expect(InsightsBatchUpdateSchema.safeParse({ items: [{ id: 1, tags: [], add_tags: ['a'] }] }).success).toBe(
            false
        )
        expect(
            InsightsBatchUpdateSchema.safeParse({
                items: Array.from({ length: MAX_BATCH_ITEMS + 1 }, (_, i) => ({ id: i, name: 'x' })),
            }).success
        ).toBe(false)
    })

    it('plans only the fields that change', () => {
        expect(planInsightChange({ id: 1, add_tags: ['a'], remove_tags: ['b'] }, { tags: ['b', 'c'] })).toEqual({
            tags: ['c', 'a'],
        })
        expect(planInsightChange({ id: 1, tags: ['c', 'a'] }, { tags: ['a', 'c'] })).toEqual({})
        expect(planInsightChange({ id: 1, deleted: true }, { deleted: false })).toEqual({ deleted: true })
    })
})

describe('annotations-batch-create', () => {
    const items = Array.from({ length: 8 }, (_, i) => ({
        content: `release note ${i}`,
        date_marker: `2026-11-0${i + 1}T09:00:00Z`,
        scope: 'project',
    }))

    it('creates eight annotations in one call with trimmed per-item receipts', async () => {
        const fake = new FakePostHog({ latency: jitter(0, 2) })
        const result = await annotationsBatchCreate(fake.context(), parse(AnnotationsBatchCreateSchema, { items }))
        expect(result.summary).toMatchObject({ requested: 8, ok: 8, written: 8 })
        expect(result.items[3]).toMatchObject({ index: 3, status: 'ok', content: 'release note 3', scope: 'project' })
        expect(typeof result.items[3]!.id).toBe('number')
        expect(fake.collection('annotations').size).toBe(8)
    })

    it('is retry-safe: a second run reports the existing annotations instead of duplicating them', async () => {
        const fake = new FakePostHog()
        await annotationsBatchCreate(fake.context(), parse(AnnotationsBatchCreateSchema, { items: items.slice(0, 5) }))
        const retry = await annotationsBatchCreate(fake.context(), parse(AnnotationsBatchCreateSchema, { items }))
        expect(retry.summary).toMatchObject({ written: 3, unchanged: 5 })
        expect(retry.items.slice(0, 5).every((item) => item.status === 'exists')).toBe(true)
        expect(fake.collection('annotations').size).toBe(8)
    })

    it('refuses two identical items in one batch, and the schema rejects a bad date', async () => {
        const fake = new FakePostHog()
        const result = await annotationsBatchCreate(
            fake.context(),
            parse(AnnotationsBatchCreateSchema, { items: [items[0], items[0]] })
        )
        expect(result.summary.written).toBe(0)
        expect(result.items[1]!.error).toMatch(/same content/)
        expect(
            AnnotationsBatchCreateSchema.safeParse({ items: [{ content: 'x', date_marker: 'tuesday' }] }).success
        ).toBe(false)
    })

    it('dry_run validates without writing', async () => {
        const fake = new FakePostHog()
        const result = await annotationsBatchCreate(
            fake.context(),
            parse(AnnotationsBatchCreateSchema, { items, dry_run: true })
        )
        expect(result.summary).toMatchObject({ dry_run: true, written: 0, ok: 8 })
        expect(fake.writes()).toHaveLength(0)
    })
})

describe('annotations-batch-delete', () => {
    function withAnnotations(): FakePostHog {
        const fake = new FakePostHog()
        for (let i = 10; i < 18; i++) {
            fake.seed('annotations', {
                id: i,
                content: `note ${i}`,
                date_marker: '2026-11-03T08:30:00Z',
                scope: 'project',
            })
        }
        return fake
    }

    it('soft-deletes eight annotations in one call', async () => {
        const fake = withAnnotations()
        const result = await annotationsBatchDelete(fake.context(), { ids: [10, 11, 12, 13, 14, 15, 16, 17] })
        expect(result.summary).toMatchObject({ requested: 8, ok: 8, written: 8 })
        expect(fake.get('annotations', 12)!.deleted).toBe(true)
        expect(result.items[0]).toMatchObject({ id: 10, status: 'ok', content: 'note 10' })
        expect(fake.log.filter((entry) => entry.method === 'GET')).toHaveLength(0)
    })

    it('reports a missing or already deleted id as not_found without blocking the rest', async () => {
        const fake = withAnnotations()
        fake.externalPatch('annotations', 11, { deleted: true })
        const result = await annotationsBatchDelete(fake.context(), { ids: [10, 11, 99] })
        expect(result.items.map((item) => item.status)).toEqual(['ok', 'not_found', 'not_found'])
        expect(result.summary).toMatchObject({ ok: 1, unchanged: 2, failed: 0 })
    })

    it('dry_run checks each id and deletes nothing', async () => {
        const fake = withAnnotations()
        const result = await annotationsBatchDelete(fake.context(), { ids: [10, 99], dry_run: true })
        expect(result.items.map((item) => item.status)).toEqual(['would_change', 'not_found'])
        expect(fake.writes()).toHaveLength(0)
    })
})
