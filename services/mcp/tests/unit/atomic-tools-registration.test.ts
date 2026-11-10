import { describe, expect, it } from 'vitest'

import { TOOL_MAP } from '@/tools'
import { ATOMIC_TOOLS } from '@/tools/atomic'
import { getToolDefinition } from '@/tools/toolDefinitions'

import toolDefinitionsAll from '../../schema/tool-definitions-all.json'

/** What each tool's description must say about its guarantees. */
const SEMANTICS: Record<string, RegExp[]> = {
    'insights-batch-update': [/NOT all-or-nothing/, /dry_run/, /conflict/],
    'annotations-batch-create': [/NOT all-or-nothing/, /dry_run/, /skip_duplicates/],
    'annotations-batch-delete': [/NOT all-or-nothing/, /dry_run/, /not_found/],
    'dashboard-create-with-insights': [/Before writing anything/, /compensating rollback/, /dry_run/],
    'insight-update-query-partial': [/re-reads it immediately before writing/, /Remaining race window/],
    'feature-flag-update-conditions': [/re-reads it immediately before writing/, /Remaining race window/, /version/],
    'survey-update-question': [/re-reads it immediately before writing/, /Remaining race window/],
}

describe('atomic-write and batch tools are registered like the other hand-written tools', () => {
    it.each(Object.keys(ATOMIC_TOOLS))(
        '%s has a factory, a definition, api_operations and stated semantics',
        (name) => {
            expect(TOOL_MAP[name]).toBe(ATOMIC_TOOLS[name])
            expect(TOOL_MAP[name]!().name).toBe(name)
            const definition = getToolDefinition(name)
            expect(definition.required_scopes.length).toBeGreaterThan(0)
            expect(definition.api_operations?.length).toBeGreaterThan(0)
            expect((toolDefinitionsAll as Record<string, unknown>)[name]).toEqual(definition)
            expect(SEMANTICS[name]).toBeTruthy()
            for (const pattern of SEMANTICS[name]!) {
                expect(definition.description).toMatch(pattern)
            }
        }
    )
})
