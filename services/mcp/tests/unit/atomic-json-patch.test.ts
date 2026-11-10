import { describe, expect, it } from 'vitest'

import { applyJsonPatch, applyMergePatch, diffJson, JsonPatchError } from '@/tools/atomic/jsonPatch'

const funnel = {
    kind: 'InsightVizNode',
    source: {
        kind: 'FunnelsQuery',
        series: [
            { kind: 'EventsNode', event: 'pageview' },
            { kind: 'EventsNode', event: 'signup_started' },
        ],
        dateRange: { date_from: '-7d' },
    },
}

describe('applyJsonPatch', () => {
    it('replaces, appends and removes array elements without touching the input', () => {
        const next = applyJsonPatch(funnel, [
            { op: 'replace', path: '/source/series/1/event', value: 'signup' },
            { op: 'add', path: '/source/series/-', value: { kind: 'EventsNode', event: 'signup_completed' } },
            { op: 'remove', path: '/source/dateRange' },
        ]) as typeof funnel

        expect(next.source.series.map((s) => s.event)).toEqual(['pageview', 'signup', 'signup_completed'])
        expect(next.source).not.toHaveProperty('dateRange')
        expect(funnel.source.series[1]!.event).toBe('signup_started')
    })

    it('inserts at an index, moves and copies', () => {
        const next = applyJsonPatch({ a: [1, 2, 3], b: {} }, [
            { op: 'add', path: '/a/1', value: 9 },
            { op: 'move', from: '/a/0', path: '/b/first' },
            { op: 'copy', from: '/b/first', path: '/c' },
        ])
        expect(next).toEqual({ a: [9, 2, 3], b: { first: 1 }, c: 1 })
    })

    it('is all-or-nothing: a failed test op rejects the whole patch and names it', () => {
        expect(() =>
            applyJsonPatch(funnel, [
                { op: 'replace', path: '/source/series/0/event', value: 'x' },
                { op: 'test', path: '/source/series/1/event', value: 'not-it' },
            ])
        ).toThrow(JsonPatchError)
        try {
            applyJsonPatch(funnel, [{ op: 'test', path: '/source/series/1/event', value: 'nope' }])
        } catch (error) {
            expect((error as JsonPatchError).operationIndex).toBe(0)
            expect((error as Error).message).toContain('test failed')
        }
    })

    it('refuses missing paths, out-of-range indexes and prototype segments', () => {
        expect(() => applyJsonPatch(funnel, [{ op: 'replace', path: '/source/nope', value: 1 }])).toThrow(
            /does not exist/
        )
        expect(() => applyJsonPatch(funnel, [{ op: 'remove', path: '/source/series/5' }])).toThrow(/out of range/)
        expect(() => applyJsonPatch({}, [{ op: 'add', path: '/__proto__/polluted', value: 1 }])).toThrow(/not allowed/)
        expect(({} as Record<string, unknown>).polluted).toBeUndefined()
    })

    it('decodes ~0 and ~1 in pointers', () => {
        expect(
            applyJsonPatch({ 'a/b': 1, 'c~d': 2 }, [
                { op: 'replace', path: '/a~1b', value: 3 },
                { op: 'remove', path: '/c~0d' },
            ])
        ).toEqual({
            'a/b': 3,
        })
    })
})

describe('applyMergePatch', () => {
    it('merges objects, deletes on null and replaces arrays whole (RFC 7396)', () => {
        const next = applyMergePatch(funnel, {
            source: { dateRange: { date_from: '-30d' }, series: [{ kind: 'EventsNode', event: 'only' }] },
            name: null,
        }) as typeof funnel
        expect(next.source.dateRange.date_from).toBe('-30d')
        expect(next.source.series).toHaveLength(1)
        expect(next.kind).toBe('InsightVizNode')
    })

    it('refuses prototype keys', () => {
        expect(() => applyMergePatch({}, JSON.parse('{"__proto__": {"x": 1}}'))).toThrow(/not allowed/)
    })
})

describe('diffJson', () => {
    it('lists leaf changes by pointer and truncates', () => {
        const { changes } = diffJson(funnel, applyMergePatch(funnel, { source: { dateRange: { date_from: '-30d' } } }))
        expect(changes).toEqual({ '/source/dateRange/date_from': ['-7d', '-30d'] })
        const many = diffJson({ a: [1, 2, 3, 4] }, { a: [5, 6, 7, 8] }, 2)
        expect(Object.keys(many.changes)).toHaveLength(2)
        expect(many.truncated).toBe(true)
    })
})
