import { describe, expect, it } from 'vitest'

import { PostHogApiError, PostHogValidationError, ToolInputValidationError } from '@/lib/errors'
import { CompensationLog, describeRollback } from '@/tools/atomic/compensation'
import {
    dashboardCreateWithInsights,
    DashboardCreateWithInsightsSchema,
    type DashboardReceipt,
} from '@/tools/atomic/dashboardCreateWithInsights'
import { AtomicWriteError } from '@/tools/atomic/errors'

import { FakePostHog } from '../fixtures/fake-posthog-backend'

const trends = (event: string): Record<string, unknown> => ({
    kind: 'InsightVizNode',
    source: { kind: 'TrendsQuery', series: [{ kind: 'EventsNode', event }] },
})
const funnel = {
    kind: 'InsightVizNode',
    source: {
        kind: 'FunnelsQuery',
        series: [
            { kind: 'EventsNode', event: 'pageview' },
            { kind: 'EventsNode', event: 'signup_started' },
            { kind: 'EventsNode', event: 'signup_completed' },
        ],
    },
}
const retention = {
    kind: 'InsightVizNode',
    source: {
        kind: 'RetentionQuery',
        retentionFilter: {
            targetEntity: { id: 'signup_completed', type: 'events' },
            returningEntity: { id: 'pageview', type: 'events' },
        },
    },
}
const sql = { kind: 'DataVisualizationNode', source: { kind: 'HogQLQuery', query: 'SELECT 1' } }

/** Job 1 of the friction session: four new tiles plus a fifth, in a chosen order. */
const fiveTiles = (
    existingId?: number
): { name: string; description: string; tiles: Record<string, unknown>[]; layout: 'two_column' } => ({
    name: 'Product overview',
    description: 'Signups, conversion and retention',
    tiles: [
        { name: 'Signup errors', query: trends('signup_error') },
        { name: 'Signup funnel', query: funnel },
        { name: 'Daily signups', query: trends('signup_completed') },
        { name: 'Signup retention', query: retention },
        existingId !== undefined ? { insight_id: existingId } : { name: 'Signups by browser (SQL)', query: sql },
    ],
    layout: 'two_column' as const,
})

const run = (fake: FakePostHog, input: unknown): Promise<DashboardReceipt> =>
    dashboardCreateWithInsights(fake.context(), DashboardCreateWithInsightsSchema.parse(input))

describe('dashboard-create-with-insights', () => {
    it('creates the dashboard and five tiles in order, arranges them and returns a trimmed receipt', async () => {
        const fake = new FakePostHog()
        const receipt = await run(fake, fiveTiles())

        expect(receipt.status).toBe('created')
        expect(receipt.dashboard).toMatchObject({ name: 'Product overview' })
        expect(receipt.dashboard!.url).toBe(`http://ph.test/project/42/dashboard/${receipt.dashboard!.id}`)
        expect(receipt.tiles.map((tile) => tile.name)).toEqual([
            'Signup errors',
            'Signup funnel',
            'Daily signups',
            'Signup retention',
            'Signups by browser (SQL)',
        ])
        expect(receipt.tiles.every((tile) => 'tile_id' in tile && typeof tile.tile_id === 'number')).toBe(true)

        const reorder = fake.log.find((entry) => entry.path.endsWith('/reorder_tiles/'))
        expect(reorder?.body).toEqual({
            tile_order: receipt.tiles.map((tile) => (tile as { tile_id: number }).tile_id),
            layout: 'two_column',
        })
        // Each query ran once before any write, and the tile ids came from the insights: no dashboard re-read.
        expect(fake.log.filter((entry) => entry.path.endsWith('/query/'))).toHaveLength(5)
        expect(fake.log.filter((entry) => entry.method === 'GET' && entry.path.includes('/dashboards/'))).toHaveLength(
            0
        )
        const firstWrite = fake.log.findIndex((entry) => entry.method === 'POST' && entry.path.endsWith('/dashboards/'))
        const lastQuery = fake.log.map((entry) => entry.path.endsWith('/query/')).lastIndexOf(true)
        expect(lastQuery).toBeLessThan(firstWrite)
        // The receipt stays small: no query, results or creator objects.
        expect(JSON.stringify(receipt).length).toBeLessThan(1200)
    })

    it('runs the source of a visualization node, not the wrapper', async () => {
        const fake = new FakePostHog()
        const ran: unknown[] = []
        fake.runQuery = async (query) => {
            ran.push(query)
            return { results: [] }
        }
        await run(fake, { name: 'd', tiles: [{ name: 'sql', query: sql }] })
        expect(ran).toEqual([{ kind: 'HogQLQuery', query: 'SELECT 1' }])
    })

    it('attaches an existing insight by id or short_id, keeping its other dashboards', async () => {
        const fake = new FakePostHog()
        fake.seed('dashboards', { id: 7, name: 'Other' })
        fake.seed('insights', { id: 81, short_id: 'legacy01', name: 'Legacy funnel', query: funnel })
        await fake.request({ method: 'PATCH', path: '/api/projects/42/insights/81/', body: { dashboards: [7] } })

        const receipt = await run(fake, fiveTiles(81))
        expect(receipt.tiles[4]).toMatchObject({ insight_id: 81, source: 'attached', name: 'Legacy funnel' })
        const insight = await fake.request<{ dashboards: number[] }>({
            method: 'GET',
            path: '/api/projects/42/insights/81/',
        })
        expect(insight.dashboards.sort()).toEqual([7, receipt.dashboard!.id].sort())
    })

    it('validates every tile before writing: two bad tiles are both named and nothing is created', async () => {
        const fake = new FakePostHog()
        fake.runQuery = async (query) => {
            if (query.kind === 'HogQLQuery') {
                throw new PostHogValidationError({
                    detail: 'Unknown table "evnts"',
                    attr: undefined,
                    code: undefined,
                    extra: undefined,
                    url: '',
                    method: 'POST',
                })
            }
            return { results: [] }
        }
        const input = fiveTiles()
        input.tiles[1] = { name: 'Broken', query: { kind: 'NotAQuery' } as never }
        const error = await run(fake, input).then(
            () => new Error('expected a failure'),
            (e: unknown) => e as Error
        )
        expect(error).toBeInstanceOf(ToolInputValidationError)
        expect((error as Error).message).toMatch(/Nothing was created: 2 of 5 tile\(s\) failed validation/)
        expect((error as Error).message).toMatch(/tile 1 \(Broken\): query.kind/)
        expect((error as Error).message).toMatch(/tile 4 \(Signups by browser \(SQL\)\): .*Unknown table/)
        expect(fake.writes()).toHaveLength(0)
    })

    it('refuses a missing existing insight and a duplicate one before writing', async () => {
        const fake = new FakePostHog()
        fake.seed('insights', { id: 81, short_id: 'legacy01', name: 'Legacy', query: funnel })
        const error = await run(fake, {
            name: 'd',
            tiles: [{ insight_id: 81 }, { insight_id: 'legacy01' }, { insight_id: 404 }],
        }).then(
            () => new Error('expected a failure'),
            (e: unknown) => e as Error
        )
        expect(error.message).toMatch(/tile 1: insight 81 is already tile 0/)
        expect(error.message).toMatch(/tile 2: .*404|Not Found/)
        expect(fake.writes()).toHaveLength(0)
    })

    it('rolls back everything it created when a later step fails, and says so', async () => {
        const fake = new FakePostHog()
        fake.seed('insights', { id: 81, short_id: 'legacy01', name: 'Legacy', query: funnel })
        let creates = 0
        fake.failWhen = (request) => {
            if (request.method === 'POST' && request.path.endsWith('/insights/') && ++creates === 3) {
                return new PostHogApiError({
                    status: 500,
                    statusText: 'Server Error',
                    body: '',
                    url: request.path,
                    method: 'POST',
                })
            }
            return undefined
        }
        const input = { ...fiveTiles(), tiles: [{ insight_id: 81 }, ...fiveTiles().tiles.slice(0, 4)] }
        const error = await run(fake, input).then(
            () => new Error('expected a failure'),
            (e: unknown) => e as Error
        )

        expect(error).toBeInstanceOf(AtomicWriteError)
        expect(error.message).toMatch(/failed at step "create tile 3 \(Daily signups\)"/)
        expect(error.message).toMatch(
            /Rolled back: insight \d+ soft-deleted; insight \d+ soft-deleted; insight 81 detached from dashboard \d+; dashboard \d+ soft-deleted/
        )
        expect(error.message).toMatch(/Nothing from this call remains/)
        const live = [...fake.collection('insights').values()].filter((insight) => insight.deleted !== true)
        expect(live.map((insight) => insight.id)).toEqual([81])
        expect([...fake.collection('dashboards').values()].every((dashboard) => dashboard.deleted === true)).toBe(true)
        const legacy = await fake.request<{ dashboards: number[] }>({
            method: 'GET',
            path: '/api/projects/42/insights/81/',
        })
        expect(legacy.dashboards).toEqual([])
    })

    it('names anything a failed rollback left behind', async () => {
        const fake = new FakePostHog()
        fake.failWhen = (request) => {
            if (request.path.endsWith('/reorder_tiles/')) {
                return new PostHogApiError({
                    status: 503,
                    statusText: 'Unavailable',
                    body: '',
                    url: request.path,
                    method: 'POST',
                })
            }
            if (request.method === 'PATCH' && request.path.includes('/dashboards/')) {
                return new PostHogApiError({
                    status: 503,
                    statusText: 'Unavailable',
                    body: '',
                    url: request.path,
                    method: 'PATCH',
                })
            }
            return undefined
        }
        const error = await run(fake, fiveTiles()).then(
            () => new Error('expected a failure'),
            (e: unknown) => e as Error
        )
        expect(error.message).toMatch(/failed at step "arrange the tiles"/)
        expect(error.message).toMatch(/ROLLBACK INCOMPLETE.*dashboard \d+ \(could not be soft-deleted/)
    })

    it('dry_run validates and returns the plan without writing', async () => {
        const fake = new FakePostHog()
        const receipt = await run(fake, { ...fiveTiles(), dry_run: true, validate: 'schema' })
        expect(receipt.status).toBe('dry_run')
        expect(receipt.tiles).toHaveLength(5)
        expect(fake.log).toHaveLength(0)
    })
})

describe('CompensationLog', () => {
    it('undoes newest first and keeps going after a failed undo', async () => {
        const log = new CompensationLog()
        const order: string[] = []
        log.record({ target: 'a', action: 'deleted', undo: async () => order.push('a') })
        log.record({
            target: 'b',
            action: 'deleted',
            undo: async () => {
                throw new Error('nope')
            },
        })
        log.record({ target: 'c', action: 'deleted', undo: async () => order.push('c') })
        const report = await log.rollback()
        expect(order).toEqual(['c', 'a'])
        expect(report.complete).toBe(false)
        expect(describeRollback(report)).toMatch(/ROLLBACK INCOMPLETE.*b \(could not be deleted: nope\)/)
        expect(describeRollback({ entries: [], complete: true })).toMatch(/Nothing had been written yet/)
    })
})
