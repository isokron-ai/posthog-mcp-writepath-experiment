import { describe, expect, it, vi } from 'vitest'

import { ReadDataSchemaSchema } from '@/schema/tool-inputs'
import { omitUnseenEvents, readDataSchemaHandler } from '@/tools/posthogAiTools/readDataSchema'
import type { Context } from '@/tools/types'

const EVENTS = [
    'events:',
    '- `All events` - All events. This is a wildcard that matches all events.',
    '- `signup_started`',
    '- `signup_completed`',
    '- `$ai_embedding` - AI embedding (LLM). A call to an embedding model. (not seen in the last 30 days)',
    '- `$ai_trace` - AI trace (LLM). A generative AI trace. (not seen in the last 30 days)',
    '- `Application opened` - Application opened. When a user opens the mobile app. (not seen in the last 30 days)',
    '',
    '# Events marked (not seen in the last 30 days) are listed for reference only. This project has sent none of them recently, so never present them as data it is collecting.',
    '',
    '# Taxonomy snapshot taken at 2026-11-10T19:45:18Z. Counts cover the last 30 days.',
].join('\n')

function contextReturning(content: string): { context: Context; request: ReturnType<typeof vi.fn> } {
    const request = vi.fn(async () => ({ success: true, content }))
    const context = {
        api: { request },
        stateManager: { getProjectId: async () => '1' },
    } as unknown as Context
    return { context, request }
}

describe('read-data-schema events: seen events only', () => {
    it('leaves out unseen events and says how many there were and how to list them', () => {
        const out = omitUnseenEvents(EVENTS)
        expect(out).toContain('- `signup_started`')
        expect(out).toContain('- `All events`')
        expect(out).not.toContain('$ai_embedding')
        expect(out).not.toContain('Events marked (not seen')
        expect(out).toContain(
            '# 3 more events are defined for this project but not seen in the last 30 days, so they are left out. To list them, call read-data-schema with {"query": {"kind": "events", "include_unseen": true}}.'
        )
        // The snapshot note stays last, where the backend put it.
        expect(out.trimEnd().split('\n').at(-1)).toMatch(/^# Taxonomy snapshot/)
    })

    it('returns a list with nothing unseen unchanged', () => {
        const seenOnly = 'events:\n- `signup_started`\n\n# Taxonomy snapshot taken at now.'
        expect(omitUnseenEvents(seenOnly)).toBe(seenOnly)
    })

    it('filters by default and lists everything with include_unseen, without sending the option to the backend', async () => {
        const { context, request } = contextReturning(EVENTS)
        const filtered = await readDataSchemaHandler(context, ReadDataSchemaSchema.parse({ query: { kind: 'events' } }))
        expect(filtered).not.toContain('$ai_trace')

        const all = await readDataSchemaHandler(
            context,
            ReadDataSchemaSchema.parse({ query: { kind: 'events', include_unseen: true } })
        )
        expect(all).toBe(EVENTS)
        for (const call of request.mock.calls as unknown as [
            { body: { args: { query: Record<string, unknown> } } },
        ][]) {
            expect(call[0].body.args.query).not.toHaveProperty('include_unseen')
        }
    })

    it('accepts include_unseen as a string and drops it from other kinds', () => {
        expect(ReadDataSchemaSchema.parse({ query: { kind: 'events', include_unseen: 'true' } })).toEqual({
            query: { kind: 'events', include_unseen: true, limit: 500, offset: 0 },
        })
        expect(
            ReadDataSchemaSchema.parse({ query: { kind: 'event_properties', event_name: 'x', include_unseen: true } })
        ).toEqual({ query: { kind: 'event_properties', event_name: 'x' } })
    })

    it('passes other kinds through untouched', async () => {
        const text = '- `plan` (not seen in the last 30 days)'
        const { context } = contextReturning(text)
        await expect(
            readDataSchemaHandler(
                context,
                ReadDataSchemaSchema.parse({ query: { kind: 'event_properties', event_name: 'x' } })
            )
        ).resolves.toBe(text)
    })
})
