/**
 * An in-memory stand-in for the PostHog REST endpoints the atomic-write and batch tools call.
 *
 * It behaves like the real API where the tools depend on it:
 * - PATCH updates only the fields it is sent (field-level, as insights do since PostHog#131620) and
 *   moves `updated_at`; a feature flag's `version` goes up by one per write.
 * - A soft-deleted object reads as 404.
 * - With `flagVersionCheck`, a flag PATCH whose `version` is stale is refused with 409 (the
 *   behaviour of flags whose filters.version is 2).
 * - Every request waits `latency()` ms before it reads or writes, so concurrent calls interleave the
 *   way real round trips do. `beforeWrite` runs just before a write is applied, which lets a test put
 *   another writer exactly in the race window.
 */
import { PostHogApiError, PostHogValidationError } from '@/lib/errors'
import type { Context } from '@/tools/types'

type Json = Record<string, unknown>

export interface RequestLog {
    method: string
    path: string
    body?: Json | undefined
    query?: Json | undefined
}

export interface FakeOptions {
    latency?: () => number
    flagVersionCheck?: boolean
}

const clone = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T

export class FakePostHog {
    readonly store = new Map<string, Map<number | string, Json>>()
    readonly log: RequestLog[] = []
    private nextId = 1000
    private tick = 0
    latency: () => number
    flagVersionCheck: boolean
    /** Runs right before a write is applied. */
    beforeWrite?: (request: RequestLog) => Promise<void> | void
    /** Return an error to fail a request instead of serving it. */
    failWhen?: (request: RequestLog) => Error | undefined
    /** Result or error for a query run. */
    runQuery: (query: Json) => Promise<unknown> = async () => ({ results: [] })

    constructor(options: FakeOptions = {}) {
        this.latency = options.latency ?? (() => 0)
        this.flagVersionCheck = options.flagVersionCheck ?? false
    }

    private now(): string {
        this.tick += 1
        return new Date(Date.UTC(2026, 10, 10, 12, 0, 0, 0) + this.tick).toISOString()
    }

    collection(name: string): Map<number | string, Json> {
        let map = this.store.get(name)
        if (!map) {
            map = new Map()
            this.store.set(name, map)
        }
        return map
    }

    seed(name: string, object: Json): Json {
        const id = (object.id as number | string | undefined) ?? this.nextId++
        const stored: Json = { ...clone(object), id, updated_at: object.updated_at ?? this.now() }
        if (name === 'feature_flags' && stored.version === undefined) {
            stored.version = 1
        }
        this.collection(name).set(id, stored)
        return stored
    }

    get(name: string, id: number | string): Json | undefined {
        return this.collection(name).get(id)
    }

    /** Applies a write from outside the tools (the UI, another server), without any latency. */
    externalPatch(name: string, id: number | string, body: Json): Json {
        const object = this.collection(name).get(id)
        if (!object) {
            throw new Error(`no ${name} ${id}`)
        }
        Object.assign(object, clone(body), { updated_at: this.now() })
        if (name === 'feature_flags') {
            object.version = Number(object.version ?? 0) + 1
        }
        return clone(object)
    }

    private notFound(path: string, method: string): PostHogApiError {
        return new PostHogApiError({ status: 404, statusText: 'Not Found', body: '{"detail":"Not found."}', url: path, method })
    }

    private view(name: string, object: Json): Json {
        if (name === 'insights') {
            const tiles = [...this.collection('dashboard_tiles').values()].filter((tile) => tile.insight === object.id)
            return {
                ...clone(object),
                dashboards: tiles.map((tile) => tile.dashboard),
                dashboard_tiles: tiles.map((tile) => ({ id: tile.id, dashboard_id: tile.dashboard, deleted: null })),
            }
        }
        if (name === 'dashboards') {
            const tiles = [...this.collection('dashboard_tiles').values()].filter((tile) => tile.dashboard === object.id)
            return { ...clone(object), tiles: tiles.map((tile) => ({ id: tile.id, insight: { id: tile.insight } })) }
        }
        return clone(object)
    }

    private setDashboards(insightId: number, dashboards: number[]): void {
        const tiles = this.collection('dashboard_tiles')
        for (const [id, tile] of tiles) {
            if (tile.insight === insightId && !dashboards.includes(tile.dashboard as number)) {
                tiles.delete(id)
            }
        }
        for (const dashboard of dashboards) {
            const exists = [...tiles.values()].some((tile) => tile.insight === insightId && tile.dashboard === dashboard)
            if (!exists) {
                const id = this.nextId++
                tiles.set(id, { id, insight: insightId, dashboard })
            }
        }
    }

    request = async <T = unknown>(opts: {
        method: string
        path: string
        body?: Json
        query?: Json
    }): Promise<T> => {
        const entry: RequestLog = { method: opts.method, path: opts.path, body: opts.body, query: opts.query }
        this.log.push(entry)
        await new Promise((resolve) => setTimeout(resolve, this.latency()))
        const failure = this.failWhen?.(entry)
        if (failure) {
            throw failure
        }
        const match = /^\/api\/(?:projects|environments)\/[^/]+\/([a-z_]+)\/(?:([^/]+)\/)?(?:([a-z_]+)\/)?$/.exec(opts.path)
        if (!match) {
            throw new Error(`fake backend has no route for ${opts.method} ${opts.path}`)
        }
        const [, name, rawId, action] = match as unknown as [string, string, string | undefined, string | undefined]
        const items = this.collection(name)
        const id = rawId === undefined ? undefined : /^\d+$/.test(rawId) ? Number(rawId) : rawId

        if (name === 'query' && opts.method === 'POST') {
            return (await this.runQuery((opts.body?.query ?? {}) as Json)) as T
        }

        if (id === undefined) {
            if (opts.method === 'GET') {
                let rows = [...items.values()].filter((row) => row.deleted !== true)
                if (opts.query?.short_id !== undefined) {
                    rows = rows.filter((row) => row.short_id === opts.query?.short_id)
                }
                if (typeof opts.query?.search === 'string') {
                    const term = opts.query.search.toLowerCase()
                    rows = rows.filter((row) => String(row.content ?? row.name ?? '').toLowerCase().includes(term))
                }
                return { results: rows.map((row) => this.view(name, row)) } as T
            }
            if (opts.method === 'POST') {
                await this.beforeWrite?.(entry)
                const { dashboards, ...rest } = clone(opts.body ?? {})
                if (name === 'insights' && rest.query === undefined) {
                    throw new PostHogValidationError({
                        detail: 'query is required',
                        attr: 'query',
                        code: undefined,
                        extra: undefined,
                        url: opts.path,
                        method: 'POST',
                    })
                }
                const created = this.seed(name, {
                    ...rest,
                    ...(name === 'insights' ? { short_id: `s${this.nextId}`, tags: rest.tags ?? [] } : {}),
                    created_at: this.now(),
                })
                if (name === 'insights' && Array.isArray(dashboards)) {
                    this.setDashboards(created.id as number, dashboards as number[])
                }
                return this.view(name, created) as T
            }
        }

        const object = id === undefined ? undefined : items.get(id)
        if (!object || object.deleted === true) {
            throw this.notFound(opts.path, opts.method)
        }
        if (action === 'reorder_tiles' && opts.method === 'POST') {
            await this.beforeWrite?.(entry)
            object.tile_order = clone(opts.body?.tile_order)
            object.layout = opts.body?.layout
            return this.view(name, object) as T
        }
        if (opts.method === 'GET') {
            return this.view(name, object) as T
        }
        if (opts.method === 'PATCH') {
            await this.beforeWrite?.(entry)
            const { version, dashboards, ...fields } = clone(opts.body ?? {})
            if (name === 'feature_flags' && this.flagVersionCheck && version !== undefined && version !== object.version) {
                throw new PostHogApiError({
                    status: 409,
                    statusText: 'Conflict',
                    body: '{"detail":"The flag was updated since you read it."}',
                    url: opts.path,
                    method: 'PATCH',
                })
            }
            Object.assign(object, fields, { updated_at: this.now() })
            if (name === 'feature_flags') {
                object.version = Number(object.version ?? 0) + 1
            }
            if (name === 'insights' && Array.isArray(dashboards)) {
                this.setDashboards(object.id as number, dashboards as number[])
            }
            return this.view(name, object) as T
        }
        throw new Error(`fake backend has no route for ${opts.method} ${opts.path}`)
    }

    context(): Context {
        return {
            api: {
                request: this.request,
                getProjectBaseUrl: (projectId: string) => `http://ph.test/project/${projectId}`,
                query: () => ({ runQuery: async ({ query }: { query: Json }) => this.request({ method: 'POST', path: '/api/environments/42/query/', body: { query } }) }),
            } as unknown as Context['api'],
            stateManager: { getProjectId: async () => '42' } as unknown as Context['stateManager'],
            env: {} as Context['env'],
            sessionManager: {} as Context['sessionManager'],
            cache: {} as Context['cache'],
            getDistinctId: async () => 'test',
            trackEvent: async () => {},
        } as Context
    }

    writes(): RequestLog[] {
        return this.log.filter((entry) => entry.method !== 'GET' && !entry.path.endsWith('/query/'))
    }
}

/** Random latency between `min` and `max` ms. */
export const jitter =
    (min = 0, max = 4): (() => number) =>
    () =>
        min + Math.random() * (max - min)
