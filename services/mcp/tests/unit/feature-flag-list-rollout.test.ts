import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it, vi } from 'vitest'

import { formatResponse } from '@/lib/response'
import { summarizeRollout } from '@/tools/featureFlags/rolloutSummary'
import { GENERATED_TOOL_MAP } from '@/tools/generated'
import type { Context } from '@/tools/types'

// The two flags of the friction session's job 4, as the list endpoint returns them (abridged).
const CHECKOUT = {
    id: 488,
    key: 'friction-new-checkout',
    name: 'friction- new checkout flow',
    updated_at: '2026-11-10T19:40:46.345332Z',
    status: 'ACTIVE',
    tags: ['friction-checkout'],
    last_called_at: null,
    active: false,
    created_at: '2026-11-10T19:39:50.994322Z',
    version: 3,
    ensure_experience_continuity: false,
    filters: {
        groups: [
            {
                properties: [{ key: '$browser', value: ['Chrome'], type: 'person', operator: 'exact' }],
                rollout_percentage: 75,
                aggregation_group_type_index: null,
            },
            {
                properties: [{ key: 'friction-plan', value: ['pro'], type: 'person', operator: 'exact' }],
                rollout_percentage: 100,
                aggregation_group_type_index: null,
            },
        ],
        multivariate: {
            variants: [
                { key: 'control', name: 'Control', rollout_percentage: 50 },
                { key: 'test', name: 'New checkout', rollout_percentage: 50 },
            ],
        },
        aggregation_group_type_index: null,
        payloads: { test: '{"big": "payload"}' },
    },
}
const DARK_MODE = {
    ...CHECKOUT,
    id: 489,
    key: 'friction-dark-mode',
    name: 'friction- dark mode',
    tags: ['friction-ui'],
    active: true,
    filters: { groups: [{ properties: [], rollout_percentage: 20 }], aggregation_group_type_index: null },
}

describe('summarizeRollout', () => {
    it('summarizes conditions and variants on one line', () => {
        expect(summarizeRollout(CHECKOUT.filters)).toBe(
            '75% where $browser = Chrome; 100% where friction-plan = pro | variants: control 50%, test 50%'
        )
        expect(summarizeRollout(DARK_MODE.filters)).toBe('20% of everyone')
    })

    it('covers empty, cohort, unset, many-property, variant-override and group-type conditions', () => {
        expect(summarizeRollout({ groups: [] })).toBe('no release conditions')
        expect(
            summarizeRollout({
                groups: [
                    {
                        properties: [
                            { key: 'id', type: 'cohort', value: 7, operator: 'in' },
                            { key: 'email', type: 'person', operator: 'is_set' },
                            { key: 'plan', type: 'person', operator: 'is_not', value: ['free'] },
                        ],
                        rollout_percentage: null,
                        variant: 'test',
                    },
                ],
                aggregation_group_type_index: 0,
            })
        ).toBe('100% where in cohort 7 and email is set +1 more → test | by group type 0')
        expect(summarizeRollout(undefined)).toBe('unknown')
    })
})

describe('feature-flag-get-all rows', () => {
    async function list(): Promise<Record<string, unknown>> {
        const request = vi
            .fn()
            .mockResolvedValue({ count: 2, next: null, previous: null, results: [DARK_MODE, CHECKOUT] })
        const context = {
            api: { request, getProjectBaseUrl: () => 'http://localhost:8010/project/1' },
            stateManager: { getProjectId: async () => '1' },
        } as unknown as Context
        return (await GENERATED_TOOL_MAP['feature-flag-get-all']!().handler(context, {})) as Record<string, unknown>
    }

    it('carry active, tags and a rollout summary instead of the raw filters', async () => {
        const result = await list()
        const rows = result.results as Record<string, unknown>[]
        expect(rows[1]).toEqual({
            id: 488,
            key: 'friction-new-checkout',
            name: 'friction- new checkout flow',
            updated_at: '2026-11-10T19:40:46.345332Z',
            status: 'ACTIVE',
            tags: ['friction-checkout'],
            last_called_at: null,
            active: false,
            created_at: '2026-11-10T19:39:50.994322Z',
            rollout: '75% where $browser = Chrome; 100% where friction-plan = pro | variants: control 50%, test 50%',
            _posthogUrl: 'http://localhost:8010/project/1/feature-flags/488',
        })
        expect(rows[0]).toMatchObject({ active: true, tags: ['friction-ui'], rollout: '20% of everyone' })
        expect(formatResponse(result)).not.toContain('payload')
    })
})

describe('the execute-sql guidance for listing flags', () => {
    const guidelines = fs.readFileSync(
        path.resolve(
            __dirname,
            '../../../../products/posthog_ai/skills/querying-posthog-data/references/guidelines.md'
        ),
        'utf-8'
    )

    it('reads rollouts from the release conditions, not the legacy top-level column', () => {
        expect(guidelines).not.toContain('SELECT key, name, rollout_percentage')
        expect(guidelines).toContain("JSONExtractRaw(filters, 'groups') AS release_conditions")
        expect(guidelines).toContain('call `feature-flag-get-all` instead')
    })
})
