/**
 * dashboard-create-with-insights: one call for a dashboard and all of its insight tiles.
 *
 *   1. Validate everything before writing anything: each new tile's query against insight-create's
 *      query schema, then (by default) by running it through the query API, and each existing
 *      insight id by reading it. Any failure returns every tile's problem and writes nothing.
 *   2. Create the dashboard, then each tile in order: a new insight created onto the dashboard, or an
 *      existing insight attached to it (a version-checked update of its `dashboards` list).
 *   3. Optionally reorder and resize the tiles with the dashboard's reorder endpoint.
 *   4. If any write fails, undo what this call wrote, newest first (compensating rollback): created
 *      insights and the dashboard are soft-deleted, attached insights get their old dashboards list
 *      back. The error says what failed, what was rolled back, and anything that could not be.
 *
 * The receipt is trimmed to ids, names, tile ids in order and the dashboard URL.
 */
import { z } from 'zod'

import { ToolInputValidationError } from '@/lib/errors'
import { isRecord } from '@/lib/plain-object'
import type { Context, ToolBase } from '@/tools/types'

import { CompensationLog, describeRollback } from './compensation'
import { mapWithConcurrency } from './concurrency'
import { AtomicWriteError, errorMessage } from './errors'
import { type ApiObject, appUrl, insightResource, projectPath, resolveInsightId } from './resources'
import { runnableQuery, validateInsightQuery } from './validation'
import { versionCheckedUpdate } from './versionGuard'

export const MAX_TILES = 20

const NewTileSchema = z
    .object({
        name: z.string().min(1).max(400).describe('Insight name.'),
        description: z.string().max(400).optional().describe('Optional, about 15 words.'),
        query: z
            .record(z.string(), z.unknown())
            .describe(
                'The insight query, exactly as insight-create takes it, e.g. {"kind":"InsightVizNode","source":{"kind":"TrendsQuery",...}} or {"kind":"DataVisualizationNode","source":{"kind":"HogQLQuery","query":"..."}}.'
            ),
    })
    .strict()
    .describe('A new insight to create on the dashboard.')

const ExistingTileSchema = z
    .object({
        insight_id: z.union([z.number().int(), z.string().min(1)]).describe('Id or short_id of an existing insight.'),
    })
    .strict()
    .describe('An existing insight to add to the dashboard.')

export const DashboardCreateWithInsightsSchema = z.object({
    name: z.string().min(1).max(400).describe('Dashboard name.'),
    description: z.string().optional().describe('Dashboard description.'),
    tags: z.array(z.string()).optional().describe('Dashboard tags.'),
    pinned: z.boolean().optional().describe('Pin the dashboard in the sidebar.'),
    tiles: z
        .array(z.union([NewTileSchema, ExistingTileSchema]))
        .min(1)
        .max(MAX_TILES)
        .describe(`The tiles in display order, at most ${MAX_TILES}. Each is a new insight or an existing one.`),
    layout: z
        .enum(['preserve', 'two_column', 'three_column', 'full_width'])
        .optional()
        .describe(
            "Arrange the tiles in the given order. 'two_column' is 6 wide, 'three_column' 4 wide, 'full_width' 12 wide; 'preserve' keeps default sizes. Omit to keep the order the tiles were added in."
        ),
    validate: z
        .enum(['run', 'schema'])
        .optional()
        .describe(
            "'run' (default) runs every new tile's query once before writing anything, which catches unknown events, bad HogQL and bad filters. 'schema' checks the shape only."
        ),
    dry_run: z.boolean().optional().describe('Validate every tile and report the plan, without creating anything.'),
})

type Params = z.infer<typeof DashboardCreateWithInsightsSchema>

type TilePlan =
    | { index: number; kind: 'new'; name: string; description?: string | undefined; query: ApiObject }
    | { index: number; kind: 'existing'; insightId: number; insight: ApiObject }

export interface TileReceipt {
    position: number
    name: string | null
    insight_id: number
    short_id: string | null
    tile_id: number | null
    source: 'created' | 'attached' | 'already_on_dashboard'
}

export interface DashboardReceipt {
    status: 'created' | 'dry_run'
    dashboard?: { id: number; name: string; url: string }
    tiles: (TileReceipt | { position: number; name: string | null; source: 'new' | 'existing'; insight_id?: number })[]
    layout?: string
    validated: 'run' | 'schema'
}

/** Check every tile. Returns the plans, or throws one error listing every tile that failed. */
async function validateTiles(context: Context, projectId: string, params: Params): Promise<TilePlan[]> {
    const mode = params.validate ?? 'run'
    const problems: string[] = []
    const plans = await mapWithConcurrency(params.tiles, 4, async (tile, index): Promise<TilePlan | undefined> => {
        const label = `tile ${index}${'name' in tile ? ` (${tile.name})` : ''}`
        try {
            if ('insight_id' in tile) {
                const insightId = await resolveInsightId(context, projectId, tile.insight_id)
                const insight = await insightResource(context, projectId, insightId).read()
                if (insight.deleted === true) {
                    throw new Error(`insight ${insightId} is deleted`)
                }
                return { index, kind: 'existing', insightId, insight }
            }
            const schemaError = validateInsightQuery(tile.query)
            if (schemaError) {
                throw new Error(schemaError)
            }
            if (mode === 'run') {
                await context.api.query({ projectId }).runQuery({ query: runnableQuery(tile.query) })
            }
            return { index, kind: 'new', name: tile.name, description: tile.description, query: tile.query }
        } catch (error) {
            problems[index] = `${label}: ${errorMessage(error)}`
            return undefined
        }
    })
    const seen = new Map<number, number>()
    for (const plan of plans) {
        if (plan?.kind === 'existing') {
            const first = seen.get(plan.insightId)
            if (first !== undefined) {
                problems[plan.index] = `tile ${plan.index}: insight ${plan.insightId} is already tile ${first}`
            }
            seen.set(plan.insightId, first ?? plan.index)
        }
    }
    const failed = problems.filter(Boolean)
    if (failed.length > 0) {
        throw new ToolInputValidationError(
            `Nothing was created: ${failed.length} of ${params.tiles.length} tile(s) failed validation. ${failed.join(' | ')}`,
            { fields: ['tiles'] }
        )
    }
    return plans as TilePlan[]
}

/** The tile id of `insight` on `dashboardId`, from the insight's own `dashboard_tiles`. */
function tileIdOn(insight: ApiObject, dashboardId: number): number | undefined {
    const tiles = Array.isArray(insight.dashboard_tiles) ? insight.dashboard_tiles : []
    const tile = tiles.find((entry) => isRecord(entry) && entry.dashboard_id === dashboardId && !entry.deleted)
    return isRecord(tile) && typeof tile.id === 'number' ? tile.id : undefined
}

function tileIdsByInsight(dashboard: ApiObject): Map<number, number> {
    const map = new Map<number, number>()
    for (const tile of Array.isArray(dashboard.tiles) ? dashboard.tiles : []) {
        if (
            isRecord(tile) &&
            isRecord(tile.insight) &&
            typeof tile.insight.id === 'number' &&
            typeof tile.id === 'number'
        ) {
            map.set(tile.insight.id, tile.id)
        }
    }
    return map
}

const dashboardIds = (insight: ApiObject): number[] =>
    (Array.isArray(insight.dashboards) ? insight.dashboards : [])
        .map((entry) => (isRecord(entry) ? entry.id : entry))
        .filter((id): id is number => typeof id === 'number')

export async function dashboardCreateWithInsights(context: Context, params: Params): Promise<DashboardReceipt> {
    const projectId = await context.stateManager.getProjectId()
    const validated = params.validate ?? 'run'
    const plans = await validateTiles(context, projectId, params)

    if (params.dry_run) {
        return {
            status: 'dry_run',
            validated,
            ...(params.layout ? { layout: params.layout } : {}),
            tiles: plans.map((plan) =>
                plan.kind === 'new'
                    ? { position: plan.index, name: plan.name, source: 'new' as const }
                    : {
                          position: plan.index,
                          name: (plan.insight.name as string | null) ?? null,
                          source: 'existing' as const,
                          insight_id: plan.insightId,
                      }
            ),
        }
    }

    const log = new CompensationLog()
    let step = 'create the dashboard'
    try {
        const dashboard = await context.api.request<ApiObject>({
            method: 'POST',
            path: projectPath(projectId, 'dashboards/'),
            body: {
                name: params.name,
                ...(params.description !== undefined ? { description: params.description } : {}),
                ...(params.tags !== undefined ? { tags: params.tags } : {}),
                ...(params.pinned !== undefined ? { pinned: params.pinned } : {}),
            },
        })
        const dashboardId = dashboard.id as number
        log.record({
            target: `dashboard ${dashboardId}`,
            action: 'soft-deleted',
            undo: () =>
                context.api.request({
                    method: 'PATCH',
                    path: projectPath(projectId, `dashboards/${dashboardId}/`),
                    body: { deleted: true },
                }),
        })

        // Sequential on purpose: tiles land in the order given, and a failure stops at a known step.
        const placed: { plan: TilePlan; insight: ApiObject; source: TileReceipt['source'] }[] = []
        for (const plan of plans) {
            if (plan.kind === 'new') {
                step = `create tile ${plan.index} (${plan.name})`
                const insight = await context.api.request<ApiObject>({
                    method: 'POST',
                    path: projectPath(projectId, 'insights/'),
                    body: {
                        name: plan.name,
                        ...(plan.description !== undefined ? { description: plan.description } : {}),
                        query: plan.query,
                        dashboards: [dashboardId],
                    },
                })
                const insightId = insight.id as number
                log.record({
                    target: `insight ${insightId}`,
                    action: 'soft-deleted',
                    undo: () =>
                        context.api.request({
                            method: 'PATCH',
                            path: projectPath(projectId, `insights/${insightId}/`),
                            body: { deleted: true },
                        }),
                })
                placed.push({ plan, insight, source: 'created' })
                continue
            }
            step = `attach insight ${plan.insightId} as tile ${plan.index}`
            const resource = insightResource(context, projectId, plan.insightId)
            const result = await versionCheckedUpdate(resource, (current) => {
                const ids = dashboardIds(current)
                return ids.includes(dashboardId) ? { unchanged: true } : { body: { dashboards: [...ids, dashboardId] } }
            })
            if (result.status === 'ok') {
                log.record({
                    target: `insight ${plan.insightId}`,
                    action: `detached from dashboard ${dashboardId}`,
                    undo: () =>
                        versionCheckedUpdate(resource, (current) => {
                            const ids = dashboardIds(current)
                            return ids.includes(dashboardId)
                                ? { body: { dashboards: ids.filter((id) => id !== dashboardId) } }
                                : { unchanged: true }
                        }),
                })
            }
            placed.push({
                plan,
                insight: result.after ?? result.before,
                source: result.status === 'ok' ? 'attached' : 'already_on_dashboard',
            })
        }

        // Tile ids come back on each insight's dashboard_tiles. Read the dashboard only if one is missing.
        const tilesNow = new Map<number, number>()
        for (const { insight } of placed) {
            const tileId = tileIdOn(insight, dashboardId)
            if (tileId !== undefined) {
                tilesNow.set(insight.id as number, tileId)
            }
        }
        if (tilesNow.size < placed.length) {
            step = 'read the dashboard tiles'
            const fromDashboard = tileIdsByInsight(
                await context.api.request<ApiObject>({
                    method: 'GET',
                    path: projectPath(projectId, `dashboards/${dashboardId}/`),
                })
            )
            for (const [insightId, tileId] of fromDashboard) {
                tilesNow.set(insightId, tileId)
            }
        }
        const tileOrder = placed
            .map(({ insight }) => tilesNow.get(insight.id as number))
            .filter((id): id is number => id !== undefined)

        if (params.layout && tileOrder.length > 0) {
            step = 'arrange the tiles'
            await context.api.request({
                method: 'POST',
                path: projectPath(projectId, `dashboards/${dashboardId}/reorder_tiles/`),
                body: { tile_order: tileOrder, layout: params.layout },
            })
        }

        return {
            status: 'created',
            validated,
            dashboard: {
                id: dashboardId,
                name: (dashboard.name as string) ?? params.name,
                url: await appUrl(context, `/dashboard/${dashboardId}`),
            },
            ...(params.layout ? { layout: params.layout } : {}),
            tiles: placed.map(({ plan, insight, source }) => ({
                position: plan.index,
                name: (insight.name as string | null) ?? null,
                insight_id: insight.id as number,
                short_id: (insight.short_id as string | undefined) ?? null,
                tile_id: tilesNow.get(insight.id as number) ?? null,
                source,
            })),
        }
    } catch (error) {
        const report = await log.rollback()
        throw new AtomicWriteError(
            `dashboard-create-with-insights failed at step "${step}": ${errorMessage(error)} ${describeRollback(report)}`,
            error
        )
    }
}

export default (): ToolBase<typeof DashboardCreateWithInsightsSchema, DashboardReceipt> => ({
    name: 'dashboard-create-with-insights',
    schema: DashboardCreateWithInsightsSchema,
    handler: dashboardCreateWithInsights,
})
