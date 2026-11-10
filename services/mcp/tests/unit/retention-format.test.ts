import { describe, expect, it, vi } from 'vitest'
import { z } from 'zod'

import { formatResponse } from '@/lib/response'
import { formatRetentionResults } from '@/tools/insights/retention-format'
import { createQueryWrapper } from '@/tools/query-wrapper-factory'
import { POSTHOG_FORMATTED_RESULTS_OVERRIDE_KEY, type Context } from '@/tools/types'

import fixture from '../fixtures/retention-query-result.json'

// The friction session ran this query at 2026-11-10T19:47Z (resp 0058).
const RAN_AT = new Date('2026-11-10T19:47:00Z')

describe('formatRetentionResults', () => {
    const text = formatRetentionResults(fixture.results, fixture.query, RAN_AT)!

    it('renders one line per cohort with size, counts and shares', () => {
        const lines = text.split('\n')
        expect(lines[0]).toBe(
            'Cohorts: first friction-signup_completed, returning: friction-pageview, period: Day, from -28d'
        )
        expect(lines[2]).toBe('Cohort|Size|Day 1|Day 2|Day 3|Day 4|Day 5|Day 6|Day 7')
        expect(lines[3]).toBe('2026-10-13|32|9|3|6|4|6|3|3')
        expect(lines.filter((line) => /^\d{4}-\d{2}-\d{2}\|/.test(line))).toHaveLength(29)
    })

    it('ends with the weighted share retained per period over completed cohorts', () => {
        const rows = [
            { date: '2026-10-01T00:00:00Z', values: [{ count: 10 }, { count: 5 }, { count: 2 }] },
            { date: '2026-10-02T00:00:00Z', values: [{ count: 30 }, { count: 6 }, { count: 0 }] },
        ]
        const table = formatRetentionResults(rows, { retentionFilter: { period: 'Day' } }, RAN_AT)!
        expect(table).toContain('\nRetained|40|27.5%|5%\n')
    })

    it('marks the period in progress and leaves periods not yet started blank', () => {
        expect(text).toContain('\n2026-11-09|36|0*||||||\n')
        expect(text).toContain('\n2026-11-10|0|||||||\n')
        expect(text).toContain('* marks a day still in progress.')
        expect(text).toContain('Blank: not started yet.')
    })

    it('has no null cells, no link and no query echo, and is a fraction of the default encoding', () => {
        expect(text).not.toContain('null')
        expect(text).not.toContain('http')
        expect(text).not.toContain('"kind"')
        const before = formatResponse({ _posthogUrl: 'http://127.0.0.1:8010/project/1/insights/new#q=x', ...fixture })
        expect(text.length * 4).toBeLessThan(before.length)
    })

    it('shows aggregation values and a breakdown column when the query has them', () => {
        const rows = [
            {
                breakdown_value: 'Safari',
                date: '2026-10-13T00:00:00Z',
                values: [
                    { count: 4, aggregation_value: 120.5 },
                    { count: 2, aggregation_value: 60 },
                ],
            },
        ]
        const query = { retentionFilter: { period: 'Week', aggregationType: 'sum', aggregationProperty: 'amount' } }
        const aggregated = formatRetentionResults(rows, query, RAN_AT)!
        expect(aggregated).not.toContain('Retained')
        expect(aggregated).toContain('values are the sum of amount')
        expect(aggregated).toContain('Breakdown|Cohort|Value|Week 1')
        expect(aggregated).toContain('Safari|2026-10-13|120.5|60')
    })

    it('returns undefined for anything that is not retention rows', () => {
        expect(formatRetentionResults([], {})).toBeUndefined()
        expect(formatRetentionResults([{ date: 'x' }], {})).toBeUndefined()
        expect(formatRetentionResults({ results: [] }, {})).toBeUndefined()
    })
})

describe('query-retention wrapper', () => {
    function contextReturning(data: Record<string, unknown>): Context {
        return {
            stateManager: {
                getProjectId: async () => '1',
                getCachedOrFetchProject: async () => ({}),
            },
            api: {
                getProjectBaseUrl: () => 'http://localhost:8010/project/1',
                query: () => ({ runQuery: vi.fn().mockResolvedValue(data) }),
            },
        } as unknown as Context
    }
    const tool = createQueryWrapper({
        name: 'query-retention',
        schema: z.object({ retentionFilter: z.record(z.string(), z.unknown()), output_format: z.string().optional() }),
        kind: 'RetentionQuery',
        outputFormat: 'optimized',
    })()

    it('carries the compact table as the model-facing text and keeps the structured rows', async () => {
        const result = (await tool.handler(contextReturning({ results: fixture.results }), {
            retentionFilter: fixture.query.retentionFilter,
        })) as Record<string, unknown>
        expect(result[POSTHOG_FORMATTED_RESULTS_OVERRIDE_KEY]).toContain('Cohort|Size|Day 1')
        expect(result.results).toEqual(fixture.results)
        expect(result._posthogUrl).toContain('/insights/new#q=')
    })

    it('leaves JSON output and a backend-formatted result alone', async () => {
        const json = (await tool.handler(contextReturning({ results: fixture.results }), {
            retentionFilter: fixture.query.retentionFilter,
            output_format: 'json',
        })) as Record<string, unknown>
        expect(json).not.toHaveProperty(POSTHOG_FORMATTED_RESULTS_OVERRIDE_KEY)

        const backend = (await tool.handler(
            contextReturning({ results: fixture.results, formatted_results: 'from the backend' }),
            { retentionFilter: fixture.query.retentionFilter }
        )) as Record<string, unknown>
        expect(backend[POSTHOG_FORMATTED_RESULTS_OVERRIDE_KEY]).toBe('from the backend')
    })
})
