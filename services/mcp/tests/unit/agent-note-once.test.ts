import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import { parse as parseYaml } from 'yaml'

import type { ApiClient } from '@/api/client'
import { MemoryCache } from '@/lib/cache/MemoryCache'
import { ScopedCache } from '@/lib/cache/ScopedCache'
import { StateManager } from '@/lib/StateManager'
import { GENERATED_TOOL_MAP } from '@/tools/generated'
import { withAgentNoteOnce } from '@/tools/tool-utils'
import type { Context, SessionScopedState, State } from '@/tools/types'

import { generateToolCode } from '../../scripts/generate-tools'
import type { ToolConfig } from '../../scripts/yaml-config-schema'

let scope = 0
function sessionStateManager(): StateManager {
    scope += 1
    return new StateManager(
        new MemoryCache<State>(`note-user-${scope}`),
        {} as ApiClient,
        undefined,
        new MemoryCache<SessionScopedState>(`note-session-${scope}`)
    )
}

class FailingCache extends ScopedCache<SessionScopedState> {
    async get(): Promise<undefined> {
        throw new Error('redis down')
    }
    async set(): Promise<void> {
        throw new Error('redis down')
    }
    async setIfAbsent(): Promise<boolean> {
        throw new Error('redis down')
    }
    async delete(): Promise<void> {}
    async clear(): Promise<void> {}
}

describe('StateManager.markShownOnce', () => {
    it('is true the first time a key is seen in a session and false after', async () => {
        const stateManager = sessionStateManager()
        expect(await stateManager.markShownOnce('agentNote:insight-create')).toBe(true)
        expect(await stateManager.markShownOnce('agentNote:insight-create')).toBe(false)
        expect(await stateManager.markShownOnce('agentNote:insight-update')).toBe(true)
        expect(await stateManager.wasShown('agentNote:insight-create')).toBe(true)
    })

    it('keeps sessions apart', async () => {
        expect(await sessionStateManager().markShownOnce('agentNote:x')).toBe(true)
        expect(await sessionStateManager().markShownOnce('agentNote:x')).toBe(true)
    })

    it('is always true without a session, or when the session store fails', async () => {
        const sessionless = new StateManager(new MemoryCache<State>('note-sessionless'), {} as ApiClient)
        expect(await sessionless.markShownOnce('agentNote:x')).toBe(true)
        expect(await sessionless.markShownOnce('agentNote:x')).toBe(true)
        expect(await sessionless.wasShown('agentNote:x')).toBe(false)

        const failing = new StateManager(
            new MemoryCache<State>('note-failing'),
            {} as ApiClient,
            undefined,
            new FailingCache('failing')
        )
        expect(await failing.markShownOnce('agentNote:x')).toBe(true)
        expect(await failing.markShownOnce('agentNote:x')).toBe(true)
    })
})

describe('withAgentNoteOnce', () => {
    it('adds the note on the first call only and keeps the shape', async () => {
        const context = { stateManager: sessionStateManager() } as unknown as Context
        expect(await withAgentNoteOnce(context, 't', { id: 1 }, 'note')).toEqual({ id: 1, _agentNote: 'note' })
        expect(await withAgentNoteOnce(context, 't', { id: 2 }, 'note')).toEqual({ id: 2 })
        expect(await withAgentNoteOnce(context, 'a', [1], 'note')).toEqual({ results: [1], _agentNote: 'note' })
        expect(await withAgentNoteOnce(context, 'a', [2], 'note')).toEqual({ results: [2] })
    })

    it('adds the note every time when the context has no session state', async () => {
        const context = { stateManager: {} } as unknown as Context
        expect(await withAgentNoteOnce(context, 't', { id: 1 }, 'note')).toHaveProperty('_agentNote', 'note')
        expect(await withAgentNoteOnce(context, 't', { id: 1 }, 'note')).toHaveProperty('_agentNote', 'note')
    })
})

describe('generated tools with an agent_note', () => {
    it('insight-create carries its note once per session', async () => {
        const stateManager = sessionStateManager()
        vi.spyOn(stateManager, 'getProjectId').mockResolvedValue('1')
        const context = {
            stateManager,
            api: {
                request: vi.fn().mockResolvedValue({ id: 1, short_id: 'abc', name: 'Signups' }),
                getProjectBaseUrl: () => 'http://localhost:8010/project/1',
            },
        } as unknown as Context
        const tool = GENERATED_TOOL_MAP['insight-create']!()
        const params = { name: 'Signups', query: { kind: 'DataVisualizationNode', source: {} } } as never
        const first = (await tool.handler(context, params)) as Record<string, unknown>
        const second = (await tool.handler(context, params)) as Record<string, unknown>
        expect(first._agentNote).toEqual(expect.stringContaining('name the display you chose'))
        expect(second).not.toHaveProperty('_agentNote')
        expect(second).toMatchObject({ id: 1, short_id: 'abc' })
    })

    it('codegen keys the note on the tool name', () => {
        const config: ToolConfig = { operation: 'things_retrieve', enabled: true, agent_note: 'Check it.' }
        const { code } = generateToolCode(
            'things-get',
            config,
            { method: 'GET', path: '/api/projects/{project_id}/things/', operation: { operationId: 'x' } },
            { category: 'Things', feature: 'things', url_prefix: '/things', tools: {} },
            { paths: {}, components: { schemas: {} } },
            new Set<string>(),
            () => ({ definitions: {} })
        )
        expect(code).toContain(`return await withAgentNoteOnce(context, 'things-get', result, "Check it.")`)
    })

    it('insight-create no longer tells the agent to re-run the query it just tested', () => {
        const definitions = parseYaml(
            fs.readFileSync(path.resolve(__dirname, '../../../../products/product_analytics/mcp/tools.yaml'), 'utf-8')
        )
        const note: string = definitions.tools['insight-create'].agent_note
        expect(note).not.toMatch(/call insight-query with the returned\s+short_id, read the current value/)
        expect(note).toContain('do not re-run it')
    })
})
