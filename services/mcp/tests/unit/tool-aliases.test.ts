import { describe, expect, it } from 'vitest'
import { z } from 'zod'

import { ExecCommandError } from '@/lib/errors'
import { createExecTool } from '@/tools/exec'
import { buildToolAliasMap, closestToolNames, resolveToolAlias } from '@/tools/tool-search'
import { getToolDefinitions } from '@/tools/toolDefinitions'
import type { Context, Tool, ZodObjectAny } from '@/tools/types'

const CATALOG = Object.keys(getToolDefinitions())

function tool(name: string, readOnly = true): Tool<ZodObjectAny> {
    return {
        name,
        title: name,
        description: name,
        schema: z.object({}),
        scopes: [],
        annotations: { destructiveHint: false, idempotentHint: true, openWorldHint: false, readOnlyHint: readOnly },
        handler: async () => ({ ran: name }),
    }
}

describe('tool-name aliases', () => {
    const aliases = buildToolAliasMap(CATALOG)

    it.each([
        ['feature-flag-create', 'create-feature-flag'],
        ['feature-flag-update', 'update-feature-flag'],
        ['feature-flag-delete', 'delete-feature-flag'],
        ['action-get-all', 'actions-get-all'],
        ['action-list', 'actions-get-all'],
    ])('resolves %s to the real tool %s', (alias, real) => {
        expect(CATALOG).toContain(real)
        expect(aliases.get(alias)).toBe(real)
    })

    it('never maps a real tool name to another tool', () => {
        for (const name of CATALOG) {
            expect(aliases.has(name)).toBe(false)
        }
    })

    it('leaves out a spelling two tools could answer to', () => {
        expect(buildToolAliasMap(['widget-list']).get('list-widget')).toBe('widget-list')
        // `widget-get-all` reads as `widget-list` too, so `list-widget` could mean either tool.
        const clash = buildToolAliasMap(['widget-get-all', 'widget-list'])
        expect(clash.has('list-widget')).toBe(false)
        expect(clash.has('widget-list')).toBe(false)
    })

    it('caches the map per tool list', () => {
        const tools = [tool('create-thing')]
        expect(resolveToolAlias(tools, 'thing-create')).toBe('create-thing')
        expect(resolveToolAlias(tools, 'thing-delete')).toBeUndefined()
    })
})

describe('closest tool names', () => {
    it('ranks by shared words, folding plurals, verb synonyms and one-letter typos', () => {
        expect(closestToolNames('feature-flag-lst', CATALOG)[0]).toBe('feature-flag-get-all')
        expect(closestToolNames('insight-retrieve', ['insight-get', 'insights-list', 'dashboard-get'])[0]).toBe(
            'insight-get'
        )
    })

    it('returns nothing for a name that shares no word with the catalog', () => {
        expect(closestToolNames('zzz-qqq', ['insight-get'])).toEqual([])
    })
})

describe('exec resolves aliases and names close tools', () => {
    const tools = [tool('create-feature-flag', false), tool('feature-flag-get-all'), tool('actions-get-all')]
    const exec = createExecTool(tools, {} as Context, 'd', 'r', undefined)

    it('runs the real tool for an alias, and info shows the real name', async () => {
        await expect(exec.handler({} as Context, { command: 'call feature-flag-create {}' })).resolves.toContain(
            'create-feature-flag'
        )
        await expect(exec.handler({} as Context, { command: 'info action-get-all' })).resolves.toMatch(
            /^name: actions-get-all/
        )
    })

    it('lists the closest real names in the unknown-tool error', async () => {
        const error = await exec.handler({} as Context, { command: 'info feature-flag-lst' }).catch((e: unknown) => e)
        expect(error).toBeInstanceOf(ExecCommandError)
        expect((error as ExecCommandError).reason).toBe('unknown_tool')
        expect((error as Error).message).toContain('Closest tool names: "feature-flag-get-all"')
        expect((error as Error).message).toContain('search feature-flag-lst')
    })

    it('sends an alias of a scope-gated tool to that tool’s own refusal', async () => {
        const gated = createExecTool(
            [tool('feature-flag-get-all')],
            { api: { config: {} } } as unknown as Context,
            'd',
            'r',
            undefined,
            undefined,
            [
                {
                    name: 'create-feature-flag',
                    title: 't',
                    description: 'd',
                    requiredScopes: ['feature_flag:write'],
                    missingScopes: ['feature_flag:write'],
                },
            ]
        )
        await expect(gated.handler({} as Context, { command: 'info feature-flag-create' })).rejects.toThrow(
            /Tool "create-feature-flag" exists, but this MCP connection is missing the required scope\(s\): feature_flag:write/
        )
    })
})
