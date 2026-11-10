import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import { parse as parseYaml } from 'yaml'
import { z } from 'zod'

import { formatResponse } from '@/lib/response'
import { trimUserRefs } from '@/lib/user-refs'
import { GENERATED_TOOL_MAP } from '@/tools/generated'
import { buildWriteReceipt, readReceiptPreImage } from '@/tools/tool-utils'
import type { Context } from '@/tools/types'

import { generateToolCode, resolveReceiptPlan } from '../../scripts/generate-tools'
import type { OpenApiSpec, ResolvedOperation } from '../../scripts/generate-tools'
import { ToolConfigSchema, type ToolConfig } from '../../scripts/yaml-config-schema'

const USER = {
    id: 1,
    uuid: '01a1c6ad-64b3-0000-06ce-0fcf1fe26771',
    distinct_id: 'nPvQFFFdWoEnLp6BoNemPqQpcgzUmuyXYWe2WFNNMQZY',
    first_name: 'Bench',
    last_name: 'Owner',
    email: 'bench-owner@example.test',
    is_email_verified: false,
    hedgehog_config: null,
    role_at_organization: 'engineering',
}

// Shaped like PATCH /api/projects/:id/insights/:id/ on the friction session (resp 0083).
const INSIGHT = {
    id: 82,
    short_id: 'i1ukxWSK',
    name: 'friction-old 01 pricing page views',
    derived_name: null,
    query: {
        kind: 'InsightVizNode',
        source: {
            kind: 'TrendsQuery',
            series: [{ kind: 'EventsNode', math: 'total', event: 'friction-pageview' }],
            dateRange: { date_from: '-30d' },
        },
    },
    deleted: false,
    dashboards: [],
    dashboard_tiles: [],
    created_by: USER,
    last_modified_by: USER,
    tags: [] as string[],
    filters_hash: 'cache_1_fdab',
    result: [{ data: [1, 2, 3] }],
}

function contextWith(request: ReturnType<typeof vi.fn>): Context {
    return {
        api: { request, getProjectBaseUrl: (id: string) => `http://localhost:8010/project/${id}` },
        stateManager: { getProjectId: async () => '1' },
    } as unknown as Context
}

describe('buildWriteReceipt', () => {
    it('keeps the identity fields and the listed fields only', () => {
        const receipt = buildWriteReceipt(INSIGHT, { fields: ['dashboards'] })
        expect(receipt).toEqual({ id: 82, short_id: 'i1ukxWSK', name: INSIGHT.name, dashboards: [] })
    })

    it('lists each sent field it changed as from/to and each it did not change as unchanged', () => {
        const after = { ...INSIGHT, tags: ['friction-legacy'] }
        const receipt = buildWriteReceipt(after, {
            sent: { tags: ['friction-legacy'], name: INSIGHT.name },
            before: INSIGHT,
        })
        expect(receipt.changed).toEqual({ tags: { from: [], to: ['friction-legacy'] } })
        expect(receipt.unchanged).toEqual(['name'])
    })

    it('reports the leaf path of a nested change, by index for same-length arrays', () => {
        const before = {
            id: 1,
            questions: [
                { id: 'a', question: 'Old?' },
                { id: 'b', question: 'Same' },
            ],
        }
        const after = {
            id: 1,
            questions: [
                { id: 'a', question: 'New?' },
                { id: 'b', question: 'Same' },
            ],
        }
        const receipt = buildWriteReceipt(after, { sent: { questions: after.questions }, before })
        expect(receipt.changed).toEqual({ 'questions.0.question': { from: 'Old?', to: 'New?' } })
    })

    it('reports a whole array when its length changed', () => {
        const before = { id: 1, query: { source: { series: [{ event: 'a' }] } } }
        const after = { id: 1, query: { source: { series: [{ event: 'a' }, { event: 'b' }] } } }
        const receipt = buildWriteReceipt(after, { sent: { query: after.query }, before })
        expect(receipt.changed).toEqual({
            'query.source.series': { from: [{ event: 'a' }], to: [{ event: 'a' }, { event: 'b' }] },
        })
    })

    it('does not count a default the server filled in as a change', () => {
        const before = { id: 1, query: { source: { series: [], funnelsFilter: { layout: 'horizontal' } } } }
        const after = {
            id: 1,
            query: { source: { series: [], funnelsFilter: { layout: 'vertical', exclusions: [], showLegend: false } } },
        }
        const receipt = buildWriteReceipt(after, { sent: { query: after.query }, before })
        expect(receipt.changed).toEqual({
            'query.source.funnelsFilter.layout': { from: 'horizontal', to: 'vertical' },
        })
    })

    it('falls back to the stored value when there is no pre-image', () => {
        const receipt = buildWriteReceipt({ ...INSIGHT, name: 'renamed' }, { sent: { name: 'renamed' } })
        expect(receipt.changed).toEqual({ name: { to: 'renamed' } })
        expect(receipt.unchanged).toBeUndefined()
    })

    it('leaves a non-object result alone', () => {
        expect(buildWriteReceipt(null)).toBeNull()
        expect(buildWriteReceipt('ok')).toBe('ok')
    })
})

describe('readReceiptPreImage', () => {
    it('returns undefined instead of throwing when the read fails', async () => {
        const request = vi.fn().mockRejectedValue(new Error('404'))
        await expect(readReceiptPreImage(contextWith(request), '/api/x/')).resolves.toBeUndefined()
        expect(request).toHaveBeenCalledWith({ method: 'GET', path: '/api/x/' })
    })
})

describe('generated receipt tools', () => {
    it('insight-update reads first, writes the same PATCH, and returns a receipt', async () => {
        const request = vi
            .fn()
            .mockResolvedValueOnce(INSIGHT)
            .mockResolvedValueOnce({ ...INSIGHT, tags: ['friction-legacy'] })
        const tool = GENERATED_TOOL_MAP['insight-update']!()
        const result = (await tool.handler(contextWith(request), { id: 82, tags: ['friction-legacy'] })) as Record<
            string,
            unknown
        >

        expect(request.mock.calls[0]![0]).toEqual({ method: 'GET', path: '/api/projects/1/insights/82/' })
        expect(request.mock.calls[1]![0]).toEqual({
            method: 'PATCH',
            path: '/api/projects/1/insights/82/',
            body: { tags: ['friction-legacy'] },
        })
        expect(result).toMatchObject({
            id: 82,
            short_id: 'i1ukxWSK',
            changed: { tags: { from: [], to: ['friction-legacy'] } },
            _posthogUrl: 'http://localhost:8010/project/1/insights/i1ukxWSK',
        })
        expect(result).not.toHaveProperty('query')
        expect(result).not.toHaveProperty('created_by')
    })

    it('insight-update with full: true skips the read and returns the old shape', async () => {
        const request = vi.fn().mockResolvedValue({ ...INSIGHT, tags: ['friction-legacy'] })
        const tool = GENERATED_TOOL_MAP['insight-update']!()
        const result = (await tool.handler(contextWith(request), {
            id: 82,
            tags: ['friction-legacy'],
            full: true,
        })) as Record<string, unknown>

        expect(request).toHaveBeenCalledTimes(1)
        expect(request.mock.calls[0]![0].body).toEqual({ tags: ['friction-legacy'] })
        expect(result).toMatchObject({ query: INSIGHT.query, created_by: USER })
        expect(result).not.toHaveProperty('result')
        expect(result).not.toHaveProperty('changed')
    })

    it('insight-delete still soft-deletes and confirms with the deleted flag', async () => {
        const request = vi.fn().mockResolvedValue({ ...INSIGHT, deleted: true })
        const result = await GENERATED_TOOL_MAP['insight-delete']!().handler(contextWith(request), { id: 82 })
        expect(request).toHaveBeenCalledWith({
            method: 'PATCH',
            path: '/api/projects/1/insights/82/',
            body: { deleted: true },
        })
        expect(result).toEqual({ id: 82, short_id: 'i1ukxWSK', name: INSIGHT.name, deleted: true })
    })

    it('dashboard-reorder-tiles keeps the tile order and positions only', async () => {
        const dashboard = {
            id: 15,
            name: 'friction-Product overview',
            created_by: USER,
            tiles: [
                {
                    id: 58,
                    order: 0,
                    layouts: { sm: { x: 0, y: 0, w: 6, h: 5 } },
                    insight: { id: 95, short_id: '5oIMY3B7', name: 'Signup funnel', query: {}, result: [1, 2] },
                },
            ],
        }
        const request = vi.fn().mockResolvedValue(dashboard)
        const result = await GENERATED_TOOL_MAP['dashboard-reorder-tiles']!().handler(contextWith(request), {
            id: 15,
            tile_order: [58],
        })
        expect(result).toEqual({
            id: 15,
            name: 'friction-Product overview',
            tiles: [
                {
                    id: 58,
                    order: 0,
                    layouts: { sm: { x: 0, y: 0, w: 6, h: 5 } },
                    insight: { id: 95, short_id: '5oIMY3B7', name: 'Signup funnel' },
                },
            ],
            _posthogUrl: 'http://localhost:8010/project/1/dashboard/15',
        })
    })

    it('survey-delete reports that it archived the survey', async () => {
        const request = vi.fn().mockResolvedValue({ id: 's1', name: 'Survey', archived: true, questions: [] })
        const result = await GENERATED_TOOL_MAP['survey-delete']!().handler(contextWith(request), { id: 's1' })
        expect(result).toEqual({ id: 's1', name: 'Survey', archived: true })
    })

    it('every tool the change covers declares a receipt', () => {
        const declared = (product: string): Record<string, { response?: { receipt?: unknown } }> =>
            parseYaml(
                fs.readFileSync(path.resolve(__dirname, `../../../../products/${product}/mcp/tools.yaml`), 'utf-8')
            ).tools
        const expected: Record<string, string[]> = {
            product_analytics: ['insight-create', 'insight-update', 'insight-delete'],
            dashboards: ['dashboard-create', 'dashboard-delete', 'dashboard-reorder-tiles'],
            annotations: ['annotation-create', 'annotations-partial-update', 'annotation-delete'],
            surveys: ['survey-create', 'survey-update', 'survey-delete'],
            cohorts: ['cohorts-create', 'cohorts-partial-update'],
            actions: ['action-create', 'action-update', 'action-delete'],
        }
        for (const [product, tools] of Object.entries(expected)) {
            const definitions = declared(product)
            for (const tool of tools) {
                expect(definitions[tool]?.response?.receipt, tool).toBeTruthy()
                const jsonSchema = z.toJSONSchema(GENERATED_TOOL_MAP[tool]!().schema, { io: 'input' }) as {
                    properties?: Record<string, unknown>
                }
                expect(jsonSchema.properties, tool).toHaveProperty('full')
            }
        }
    })
})

describe('receipt codegen', () => {
    const spec: OpenApiSpec = {
        paths: {
            '/api/projects/{project_id}/things/{id}/': {
                patch: {
                    operationId: 'things_partial_update',
                    parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'integer' } }],
                    requestBody: {
                        content: {
                            'application/json': { schema: { $ref: '#/components/schemas/PatchedThing' } },
                        },
                    },
                },
            },
        },
        components: {
            schemas: { PatchedThing: { type: 'object', properties: { name: { type: 'string' } } } },
        },
    } as unknown as OpenApiSpec
    const category = { category: 'Things', feature: 'things', url_prefix: '/things', tools: {} }
    const resolved = {
        method: 'PATCH',
        path: '/api/projects/{project_id}/things/{id}/',
        operation: spec.paths['/api/projects/{project_id}/things/{id}/']!['patch'],
    } as unknown as ResolvedOperation

    it('emits a pre-read, the unchanged write, a receipt and a full escape hatch for an update', () => {
        const config: ToolConfig = {
            operation: 'things_partial_update',
            enabled: true,
            enrich_url: '{id}',
            response: { receipt: { fields: ['tags'] }, exclude: ['result'] },
        }
        const { code, toolUtilsValueImports } = generateToolCode(
            'thing-update',
            config,
            resolved,
            category,
            spec,
            new Set(['Thing', 'PatchedThing']),
            () => ({ definitions: {} })
        )
        expect(code).toContain('.extend({ full: z.boolean().optional()')
        expect(code).toContain('const before = params.full ? undefined : await readReceiptPreImage(context, ')
        expect(code.indexOf('const before')).toBeLessThan(code.indexOf("method: 'PATCH'"))
        expect(code).toContain(
            "const filtered = (params.full ? omitResponseFields(result, ['result']) : buildWriteReceipt(result, { fields: ['tags'], sent: body, before })) as typeof result"
        )
        expect(code).toContain('withPostHogUrl(context, filtered,')
        expect([...toolUtilsValueImports]).toEqual(['omitResponseFields', 'buildWriteReceipt', 'readReceiptPreImage'])
    })

    it('plans no diff for creates, actions or soft deletes, and keeps the soft-delete field', () => {
        const config = (receipt: ToolConfig['response']): ToolConfig => ({
            operation: 'x',
            enabled: true,
            response: receipt,
        })
        expect(resolveReceiptPlan(config({ receipt: true }), 'POST', true, undefined)).toEqual({
            fields: [],
            diff: false,
            hasBody: false,
        })
        expect(resolveReceiptPlan(config({ receipt: true }), 'PATCH', false, 'archived')).toEqual({
            fields: ['archived'],
            diff: false,
            hasBody: false,
        })
        expect(resolveReceiptPlan(config({ receipt: { diff: false } }), 'PATCH', true, undefined)).toEqual({
            fields: [],
            diff: false,
            hasBody: true,
        })
        expect(resolveReceiptPlan(config(undefined), 'PATCH', true, undefined)).toBeUndefined()
    })

    it('rejects a receipt on a list tool', () => {
        const parsed = ToolConfigSchema.safeParse({
            operation: 'things_list',
            enabled: true,
            list: true,
            response: { receipt: true },
        })
        expect(parsed.success).toBe(false)
    })
})

describe('creator trim in the text the model reads', () => {
    it('shrinks created_by and last_modified_by to id and name at any depth', () => {
        const trimmed = trimUserRefs({ created_by: USER, tiles: [{ insight: { last_modified_by: USER } }] })
        expect(trimmed).toEqual({
            created_by: { id: 1, name: 'Bench Owner' },
            tiles: [{ insight: { last_modified_by: { id: 1, name: 'Bench Owner' } } }],
        })
    })

    it('falls back to the email and leaves other user-shaped keys alone', () => {
        const noName = { ...USER, first_name: '', last_name: '' }
        expect(trimUserRefs({ created_by: noName, user: USER })).toEqual({
            created_by: { id: 1, name: 'bench-owner@example.test' },
            user: USER,
        })
    })

    it('is applied by formatResponse without touching the input', () => {
        const input = { id: 82, created_by: USER }
        const text = formatResponse(input)
        expect(text).toContain('name: Bench Owner')
        expect(text).not.toContain('distinct_id')
        expect(input.created_by).toBe(USER)
    })

    it('cuts the friction-session insight-update echo to a fraction', () => {
        const before = formatResponse({ ...INSIGHT, tags: ['friction-legacy'] })
        const receipt = formatResponse(
            buildWriteReceipt({ ...INSIGHT, tags: ['friction-legacy'] }, { sent: { tags: ['x'] }, before: INSIGHT })
        )
        expect(receipt.length * 4).toBeLessThan(before.length)
    })
})
