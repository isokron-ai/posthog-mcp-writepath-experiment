import { describe, expect, it } from 'vitest'
import { parse as parseYaml } from 'yaml'
import { z } from 'zod'

import { SessionManager } from '@/lib/SessionManager'
import { getToolsFromContext } from '@/tools'
import { createExecTool } from '@/tools/exec'
import {
    compactInfoSchema,
    compactSchema,
    createToolCandidates,
    extractRepeatedDefinitions,
    infoShownKey,
} from '@/tools/schema-utils'
import type { Context } from '@/tools/types'

type JSONSchema = Record<string, unknown>

/** Inline every local `$ref` again, dropping `$defs`: the schema the compact form stands for. */
function dereference(schema: JSONSchema): unknown {
    const defs = (schema.$defs ?? {}) as Record<string, JSONSchema>
    const walk = (node: unknown): unknown => {
        if (Array.isArray(node)) {
            return node.map(walk)
        }
        if (node === null || typeof node !== 'object') {
            return node
        }
        const record = node as JSONSchema
        if (typeof record.$ref === 'string' && record.$ref.startsWith('#/$defs/')) {
            const { $ref, ...siblings } = record
            return walk({ ...defs[$ref.slice('#/$defs/'.length)], ...siblings })
        }
        const result: JSONSchema = {}
        for (const [key, value] of Object.entries(record)) {
            if (key !== '$defs') {
                result[key] = walk(value)
            }
        }
        return result
    }
    return walk(schema)
}

const DATE_RANGE = {
    type: 'object',
    properties: {
        date_from: { type: 'string', description: 'Start of the date range, for example -7d or 2024-01-01.' },
        date_to: { type: 'string', description: 'End of the date range. Omit for now.' },
        explicitDate: { type: 'boolean', description: 'Whether the dates are exact or relative.' },
    },
}

describe('compactSchema: choice lists', () => {
    it('drops DRF choice lines that only repeat the enum', () => {
        const schema = {
            type: 'object',
            properties: {
                schedule: {
                    description: 'How often to show it.\n\n* `once` - once\n* `recurring` - recurring',
                    anyOf: [{ type: 'string', enum: ['once', 'recurring'] }, { type: 'null' }],
                },
                kind: { type: 'string', enum: ['a_b', 'c'], description: '* `a_b` - A B\n* `c` - C' },
            },
        }
        const compact = compactSchema(schema) as { properties: Record<string, JSONSchema> }
        expect(compact.properties.schedule!.description).toBe('How often to show it.')
        expect(compact.properties.kind).not.toHaveProperty('description')
    })

    it('keeps a choice line whose label says more than the value, and lists without an enum', () => {
        const schema = {
            type: 'object',
            properties: {
                aggregation: {
                    type: 'string',
                    enum: ['distinct_id', 'session'],
                    description: '* `distinct_id` - User ID (default)\n* `session` - session',
                },
                free: { type: 'string', description: '* `x` - x' },
            },
        }
        const compact = compactSchema(schema) as { properties: Record<string, JSONSchema> }
        expect(compact.properties.aggregation!.description).toBe('* `distinct_id` - User ID (default)')
        expect(compact.properties.free!.description).toBe('* `x` - x')
    })
})

describe('extractRepeatedDefinitions', () => {
    it('moves a repeated sub-schema into $defs and stands for the same schema', () => {
        const schema = {
            type: 'object',
            properties: {
                dateRange: DATE_RANGE,
                compareDateRange: DATE_RANGE,
                series: { type: 'array', items: { type: 'object', properties: { dateRange: DATE_RANGE } } },
            },
        }
        const compact = extractRepeatedDefinitions(schema)
        expect(Object.keys(compact.$defs as JSONSchema)).toEqual(['dateRange'])
        expect((compact.properties as Record<string, JSONSchema>).compareDateRange).toEqual({
            $ref: '#/$defs/dateRange',
        })
        expect(JSON.stringify(compact).length).toBeLessThan(JSON.stringify(schema).length * 0.6)
        expect(dereference(compact)).toEqual(schema)
    })

    it('keeps differing descriptions on the references', () => {
        const schema = {
            type: 'object',
            properties: {
                a: { ...DATE_RANGE, description: 'First range.' },
                b: { ...DATE_RANGE, description: 'Second range.' },
            },
        }
        const compact = extractRepeatedDefinitions(schema)
        expect((compact.properties as Record<string, JSONSchema>).a).toEqual({
            $ref: '#/$defs/a',
            description: 'First range.',
        })
        expect(dereference(compact)).toEqual(schema)
    })

    it('leaves small or unique sub-schemas inline', () => {
        const schema = {
            type: 'object',
            properties: { a: { type: 'string' }, b: { type: 'string' }, c: DATE_RANGE },
        }
        expect(extractRepeatedDefinitions(schema)).toEqual(schema)
    })

    it('stands for the same schema on a real tool with nested repeats', async () => {
        const tools = await getToolsFromContext(execContext())
        const retention = tools.find((tool) => tool.name === 'query-retention')!
        const full = z.toJSONSchema(retention.schema, { io: 'input' }) as JSONSchema
        const compact = extractRepeatedDefinitions(full)
        expect(JSON.stringify(compact).length).toBeLessThan(JSON.stringify(full).length)
        expect(dereference(compact)).toEqual(full)
    })
})

describe('createToolCandidates', () => {
    it.each([
        ['insight-update', ['insight-create']],
        ['update-feature-flag', ['create-feature-flag']],
        ['annotations-partial-update', ['annotations-create', 'annotation-create']],
        ['cohorts-partial-update', ['cohorts-create', 'cohort-create']],
        ['insight-get', []],
    ])('%s → %j', (tool, expected) => {
        expect(createToolCandidates(tool)).toEqual(expected)
    })
})

function sessionState(): {
    wasShown: (key: string) => Promise<boolean>
    markShownOnce: (key: string) => Promise<boolean>
    getApiKey: () => Promise<{ scopes: string[] }>
    getAiConsentGiven: () => Promise<boolean>
} {
    const shown = new Set<string>()
    return {
        wasShown: async (key) => shown.has(key),
        markShownOnce: async (key) => {
            const first = !shown.has(key)
            shown.add(key)
            return first
        },
        getApiKey: async () => ({ scopes: ['*'] }),
        getAiConsentGiven: async () => true,
    }
}

function execContext(stateManager: unknown = sessionState()): Context {
    return {
        api: {} as never,
        cache: {} as never,
        env: {
            MCP_APPS_BASE_URL: undefined,
            POSTHOG_ANALYTICS_API_KEY: undefined,
            POSTHOG_ANALYTICS_HOST: undefined,
            POSTHOG_API_BASE_URL: undefined,
            POSTHOG_PUBLIC_URL: undefined,
            POSTHOG_MCP_APPS_ANALYTICS_BASE_URL: undefined,
            POSTHOG_UI_APPS_TOKEN: undefined,
        },
        stateManager: stateManager as never,
        sessionManager: new SessionManager({} as never),
        getDistinctId: async () => 'test-distinct-id',
        trackEvent: async () => {},
    }
}

describe('compactInfoSchema: update tools point at their create tool', () => {
    const QUERY = {
        type: 'object',
        properties: { dateRange: DATE_RANGE, compare: { ...DATE_RANGE, title: 'Compare' }, interval: DATE_RANGE },
    }
    const create = { type: 'object', properties: { name: { type: 'string' }, query: QUERY, small: DATE_RANGE } }
    const update = {
        type: 'object',
        properties: { id: { type: 'number' }, name: { type: 'string' }, query: QUERY, small: DATE_RANGE },
    }
    const tools = async (): Promise<{ name: string; schema: unknown; rawInputSchema: JSONSchema }[]> => [
        { name: 'thing-create', schema: undefined, rawInputSchema: create },
    ]

    it('replaces an identical property once the create info was shown', async () => {
        const stateManager = sessionState()
        await stateManager.markShownOnce(infoShownKey('thing-create'))
        const compact = await compactInfoSchema(update, 'thing-update', { context: { stateManager }, tools })
        const properties = compact.properties as Record<string, JSONSchema>
        expect(properties.query!.$ref).toBe('thing-create#/properties/query')
        // A property not much bigger than the pointer stays inline.
        expect(properties.small!.$ref).not.toBe('thing-create#/properties/small')
        expect(properties.name).toEqual({ type: 'string' })
        expect(properties.id).toEqual({ type: 'number' })
    })

    it('keeps the update tool own description when only the description differs', async () => {
        const stateManager = sessionState()
        await stateManager.markShownOnce(infoShownKey('thing-create'))
        const reworded = {
            ...update,
            properties: { ...update.properties, query: { ...QUERY, description: 'The new definition.' } },
        }
        const compact = await compactInfoSchema(reworded, 'thing-update', { context: { stateManager }, tools })
        const query = (compact.properties as Record<string, JSONSchema>).query!
        expect(query.$ref).toBe('thing-create#/properties/query')
        expect(query.description).toMatch(/^The new definition\. Otherwise the same schema as `query` on thing-create/)
    })

    it('prints everything when the create info was not shown in this session', async () => {
        const compact = await compactInfoSchema(update, 'thing-update', {
            context: { stateManager: sessionState() },
            tools,
        })
        expect(compact).toEqual(compactSchema(update))
    })
})

describe('exec info and schema output', () => {
    async function run(commands: string[]): Promise<string[]> {
        const context = execContext()
        const exec = createExecTool(await getToolsFromContext(context), context, 'test', 'test', undefined)
        const outputs: string[] = []
        for (const command of commands) {
            outputs.push((await exec.handler(context, { command })) as string)
        }
        return outputs
    }

    it('points insight-update at insight-create after info insight-create', async () => {
        const [alone] = await run(['info insight-update'])
        const [, afterCreate] = await run(['info insight-create', 'info insight-update'])
        expect(afterCreate).toContain('insight-create#/properties/query')
        expect(afterCreate!.length).toBeLessThan(alone!.length / 2)
        const inputSchema = JSON.parse(parseYaml(afterCreate!).inputSchema) as JSONSchema
        expect(Object.keys(inputSchema.properties as JSONSchema)).toEqual(
            Object.keys(JSON.parse(parseYaml(alone!).inputSchema).properties)
        )
    })

    it('carries no DRF choice line that repeats an enum', async () => {
        const [surveyCreate] = await run(['info survey-create'])
        expect(surveyCreate).not.toContain('* `once` - once')
    })

    it('shrinks a drilled field that repeats sub-schemas', async () => {
        const [drilled] = await run(['schema query-retention retentionFilter.targetEntity'])
        const parsed = JSON.parse(drilled!) as { field: string; schema: JSONSchema }
        expect(parsed.field).toBe('retentionFilter.targetEntity')
        expect(parsed.schema.$defs).toBeTruthy()
    })
})
