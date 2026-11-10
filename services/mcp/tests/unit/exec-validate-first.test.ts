import { describe, expect, it, vi } from 'vitest'
import { z } from 'zod'

import { ToolInputValidationError } from '@/lib/errors'
import { SessionManager } from '@/lib/SessionManager'
import { getToolsFromContext } from '@/tools'
import { createExecTool, type ExecInnerCallProperties } from '@/tools/exec'
import { describeFailingFieldSchemas, MAX_ERROR_SCHEMA_CHARS } from '@/tools/exec-schema-view'
import type { Context, Tool, ZodObjectAny } from '@/tools/types'

const context = {
    api: {} as any,
    cache: {} as any,
    env: {} as any,
    stateManager: { getApiKey: async () => ({ scopes: ['*'] }), getAiConsentGiven: async () => true } as any,
    sessionManager: new SessionManager({} as any),
    getDistinctId: async () => 'd',
    trackEvent: async () => {},
} as Context

function mockTool(schema: ZodObjectAny, handler = vi.fn(async () => ({ ok: true }))): Tool<ZodObjectAny> {
    return {
        name: 'mock-tool',
        title: 'Mock',
        description: 'Mock',
        schema,
        scopes: [],
        annotations: { destructiveHint: false, idempotentHint: true, openWorldHint: false, readOnlyHint: true },
        handler,
    }
}

async function rejection(exec: Tool<any>, command: string): Promise<Error> {
    return exec.handler(context, { command }).then(
        () => {
            throw new Error('expected the call to be rejected')
        },
        (error: Error) => error
    )
}

describe('a failed call carries the failing field schema', () => {
    it('shows the parent object of a missing nested field, so its siblings are visible', async () => {
        const schema = z.object({
            breakdownFilter: z.object({
                breakdown: z.string().describe('The property to break down by.'),
                breakdown_type: z.enum(['event', 'person']).optional(),
            }),
        })
        const exec = createExecTool([mockTool(schema)], context, 'd', 'r', undefined)
        const error = await rejection(exec, 'call mock-tool {"breakdownFilter": {"breakdowns": []}}')
        expect(error).toBeInstanceOf(ToolInputValidationError)
        expect(error.message).toMatch(
            /^Invalid input for "mock-tool": missing required parameter: breakdownFilter\.breakdown/
        )
        expect(error.message).toContain('no separate info or schema call is needed')
        const [, block] = error.message.split('Schema of breakdownFilter:\n')
        const summary = JSON.parse(block!)
        expect(summary.required).toEqual(['breakdown'])
        expect(summary.properties.breakdown.description).toBe('The property to break down by.')
        expect(summary.properties.breakdown_type.enum).toEqual(['event', 'person'])
    })

    it('keeps the analytics message short and value-free', async () => {
        const tracked: ExecInnerCallProperties[] = []
        const schema = z.object({ filter: z.object({ key: z.string() }) })
        const exec = createExecTool([mockTool(schema)], context, 'd', 'r', undefined, (_name, props) => {
            tracked.push(props)
        })
        await rejection(exec, 'call mock-tool {"filter": {"secret-value": "hunter2"}}')
        expect(tracked[0]!.error_message).toBe('Invalid input for "mock-tool": missing required parameter: filter.key')
    })

    it('carries no schema for a length rejection, which already names the bound', async () => {
        const exec = createExecTool([mockTool(z.object({ name: z.string().max(3) }))], context, 'd', 'r', undefined)
        const error = await rejection(exec, 'call mock-tool {"name": "toolong"}')
        expect(error.message).not.toContain('Schema of')
    })

    it('prints two failing fields of the same shape once', () => {
        const entity = z.object({ id: z.string(), type: z.literal('events').optional() })
        const schema = z.object({ filter: z.object({ target: entity, returning: entity }) })
        const parsed = schema.safeParse({ filter: { target: {}, returning: {} } })
        expect(parsed.success).toBe(false)
        const text = describeFailingFieldSchemas(mockTool(schema), parsed.error!.issues)
        expect(text.match(/"required":\["id"\]/g)).toHaveLength(1)
        expect(text).toMatch(/Schema of filter\.(returning|target): same as filter\.(target|returning)\./)
    })

    it('reproduces the friction-report probes #139 and #140 with the real query tools', async () => {
        const tools = await getToolsFromContext(context)
        const exec = createExecTool(tools, context, 'd', 'r', undefined)

        // #139: a trends-shaped breakdown sent to a funnel.
        const funnel = await rejection(
            exec,
            'call query-funnel {"series": [{"kind": "EventsNode", "event": "a"}, {"kind": "EventsNode", "event": "b"}], "breakdownFilter": {"breakdowns": [{"property": "$browser", "type": "event"}]}, "dateRange": {"date_from": "-7d"}}'
        )
        expect(funnel.message).toContain('missing required parameter: breakdownFilter.breakdown')
        expect(funnel.message).toContain('Schema of breakdownFilter:')
        expect(funnel.message).toContain('"breakdown_type"')

        // #140: series-shaped entities sent to retention.
        const retention = await rejection(
            exec,
            'call query-retention {"retentionFilter": {"targetEntity": {"kind": "EventsNode", "event": "a"}, "returningEntity": {"kind": "EventsNode", "event": "b"}}, "dateRange": {"date_from": "-28d"}}'
        )
        expect(retention.message).toMatch(/Schema of retentionFilter\.(returningEntity|targetEntity):/)
        expect(retention.message).toMatch(/same as retentionFilter\.(returningEntity|targetEntity)/)
        expect(retention.message).toContain('"id"')
        expect(retention.message.length).toBeLessThan(MAX_ERROR_SCHEMA_CHARS + 1_000)
    })
})

describe('info and schema still work as before', () => {
    it('serves the drill-down a validation error would point at', async () => {
        const tools = await getToolsFromContext(context)
        const exec = createExecTool(tools, context, 'd', 'r', undefined)
        const result = JSON.parse(
            (await exec.handler(context, { command: 'schema query-funnel breakdownFilter' })) as string
        ) as { field: string; schema: Record<string, unknown> }
        expect(result.field).toBe('breakdownFilter')
        expect(JSON.stringify(result.schema)).toContain('breakdown_type')
    })
})
