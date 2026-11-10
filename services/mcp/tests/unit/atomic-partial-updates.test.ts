import { describe, expect, it } from 'vitest'

import { ToolInputValidationError } from '@/lib/errors'
import { WriteConflictError } from '@/tools/atomic/errors'
import {
    featureFlagUpdateConditions,
    FeatureFlagUpdateConditionsSchema,
    insightUpdateQueryPartial,
    InsightUpdateQueryPartialSchema,
    planFlagFilters,
    surveyUpdateQuestion,
    SurveyUpdateQuestionSchema,
} from '@/tools/atomic/partialUpdates'
import { surveyQuestionsVersion } from '@/tools/atomic/resources'
import { conditionId } from '@/tools/featureFlags/conditionIds'

import { FakePostHog } from '../fixtures/fake-posthog-backend'

type Funnel = {
    kind: string
    source: { kind: string; series: { kind: string; event: string }[]; dateRange: { date_from: string } }
}
type Condition = { properties: Record<string, unknown>[]; rollout_percentage: number }

const funnel = (): Funnel => ({
    kind: 'InsightVizNode',
    source: {
        kind: 'FunnelsQuery',
        series: [
            { kind: 'EventsNode', event: 'pageview' },
            { kind: 'EventsNode', event: 'signup_completed' },
        ],
        dateRange: { date_from: '-7d' },
    },
})

const conditions = (): Condition[] => [
    {
        properties: [{ key: 'email', value: '@acme.com', operator: 'icontains', type: 'person' }],
        rollout_percentage: 100,
    },
    { properties: [], rollout_percentage: 20 },
]

function fake(): FakePostHog {
    const backend = new FakePostHog()
    backend.seed('insights', { id: 81, short_id: 'legacy01', name: 'Signup funnel', query: funnel() })
    backend.seed('feature_flags', { id: 488, key: 'new-checkout', filters: { groups: conditions() }, version: 3 })
    backend.seed('surveys', {
        id: 'sv1',
        name: 'Signup survey',
        questions: [
            { id: 'q1', type: 'rating', question: 'How easy was it?', display: 'number', scale: 5 },
            { id: 'q2', type: 'single_choice', question: 'Which device?', choices: ['Desktop', 'Phone', 'Tablet'] },
            { id: 'q3', type: 'open', question: 'What almost stopped you?', optional: true },
        ],
    })
    return backend
}

describe('insight-update-query-partial', () => {
    it('job 2: adds a funnel step and widens the date range with one JSON Patch, returning only the diff', async () => {
        const backend = fake()
        const receipt = await insightUpdateQueryPartial(
            backend.context(),
            InsightUpdateQueryPartialSchema.parse({
                id: 'legacy01',
                json_patch: [
                    { op: 'test', path: '/source/series/1/event', value: 'signup_completed' },
                    { op: 'add', path: '/source/series/1', value: { kind: 'EventsNode', event: 'signup_started' } },
                    { op: 'replace', path: '/source/dateRange/date_from', value: '-30d' },
                ],
            })
        )
        const stored = backend.get('insights', 81)!.query as ReturnType<typeof funnel>
        expect(stored.source.series.map((s) => s.event)).toEqual(['pageview', 'signup_started', 'signup_completed'])
        expect(stored.source.dateRange.date_from).toBe('-30d')
        expect(receipt).toMatchObject({
            status: 'ok',
            id: 81,
            changed: {
                '/query/source/dateRange/date_from': ['-7d', '-30d'],
                '/query/source/series/1/event': ['signup_completed', 'signup_started'],
                '/query/source/series/2': [null, { kind: 'EventsNode', event: 'signup_completed' }],
            },
        })
        expect(receipt.version).toBe(backend.get('insights', 81)!.updated_at)
        const patch = backend.log.find((entry) => entry.method === 'PATCH')
        expect(Object.keys(patch!.body!)).toEqual(['query'])
    })

    it('merge_patch edits a nested object', async () => {
        const backend = fake()
        await insightUpdateQueryPartial(backend.context(), {
            id: 81,
            merge_patch: { source: { filterTestAccounts: true } },
        })
        expect((backend.get('insights', 81)!.query as { source: Record<string, unknown> }).source).toMatchObject({
            filterTestAccounts: true,
            dateRange: { date_from: '-7d' },
        })
    })

    it('rejects a patch that does not apply, or yields an invalid query, without writing', async () => {
        const backend = fake()
        await expect(
            insightUpdateQueryPartial(backend.context(), {
                id: 81,
                json_patch: [{ op: 'replace', path: '/source/series/7/event', value: 'x' }],
            })
        ).rejects.toThrow(/does not apply .*out of range/)
        await expect(
            insightUpdateQueryPartial(backend.context(), {
                id: 81,
                json_patch: [{ op: 'replace', path: '/kind', value: 'Bogus' }],
            })
        ).rejects.toThrow(/patched query is not valid/)
        expect(backend.writes()).toHaveLength(0)
    })

    it('refuses a stale base_version and supports dry_run', async () => {
        const backend = fake()
        await expect(
            insightUpdateQueryPartial(backend.context(), {
                id: 81,
                merge_patch: { source: { interval: 'week' } },
                base_version: '2020-01-01T00:00:00Z',
            })
        ).rejects.toBeInstanceOf(WriteConflictError)
        const dry = await insightUpdateQueryPartial(backend.context(), {
            id: 81,
            merge_patch: { source: { interval: 'week' } },
            dry_run: true,
        })
        expect(dry).toMatchObject({ status: 'dry_run', changed: { '/query/source/interval': [null, 'week'] } })
        expect(backend.writes()).toHaveLength(0)
    })

    it('writes name and description in the same guarded update', async () => {
        const backend = fake()
        const receipt = await insightUpdateQueryPartial(backend.context(), {
            id: 81,
            name: 'Signup funnel (3 steps)',
            merge_patch: { source: { dateRange: { date_from: '-30d' } } },
        })
        expect(receipt.changed).toEqual({
            '/query/source/dateRange/date_from': ['-7d', '-30d'],
            '/name': ['Signup funnel', 'Signup funnel (3 steps)'],
        })
        expect(Object.keys(backend.log.find((entry) => entry.method === 'PATCH')!.body!).sort()).toEqual([
            'name',
            'query',
        ])
    })

    it('needs a change, and not both patch kinds', () => {
        expect(InsightUpdateQueryPartialSchema.safeParse({ id: 1 }).success).toBe(false)
        expect(InsightUpdateQueryPartialSchema.safeParse({ id: 1, name: 'x' }).success).toBe(true)
        expect(
            InsightUpdateQueryPartialSchema.safeParse({
                id: 1,
                merge_patch: {},
                json_patch: [{ op: 'remove', path: '/a' }],
            }).success
        ).toBe(false)
    })
})

describe('feature-flag-update-conditions', () => {
    it('job 4: sets a rollout by condition_id and adds variants without resending the conditions', async () => {
        const backend = fake()
        const id0 = conditionId(conditions()[0]!, undefined)
        const receipt = await featureFlagUpdateConditions(
            backend.context(),
            FeatureFlagUpdateConditionsSchema.parse({
                id: 488,
                base_version: 3,
                conditions: [{ op: 'update', condition_id: id0, set: { rollout_percentage: 75 } }],
                variants: [
                    { op: 'add', key: 'control', rollout_percentage: 50 },
                    { op: 'add', key: 'test', rollout_percentage: 50 },
                ],
            })
        )
        const stored = backend.get('feature_flags', 488)!
        expect(stored.version).toBe(4)
        expect((stored.filters as { groups: { rollout_percentage: number; properties: unknown[] }[] }).groups).toEqual([
            { properties: conditions()[0]!.properties, rollout_percentage: 75 },
            { properties: [], rollout_percentage: 20 },
        ])
        expect(receipt).toMatchObject({
            status: 'ok',
            version: 4,
            key: 'new-checkout',
            variants: [
                { key: 'control', rollout_percentage: 50 },
                { key: 'test', rollout_percentage: 50 },
            ],
        })
        expect(receipt.conditions).toEqual([
            { condition_id: id0, rollout_percentage: 75, properties: 1 },
            { condition_id: expect.any(String), rollout_percentage: 20, properties: 0 },
        ])
        // The write carries the version precondition and no condition_id (the API does not store it).
        const patch = backend.log.find((entry) => entry.method === 'PATCH')!
        expect(patch.body).toMatchObject({ version: 3 })
        expect(JSON.stringify(patch.body)).not.toContain('condition_id')
    })

    it('adds and removes conditions', () => {
        const flag = { filters: { groups: conditions() } }
        const next = planFlagFilters(flag, {
            conditions: [
                { op: 'remove', index: 1 },
                { op: 'add', set: { properties: [], rollout_percentage: 5 }, position: 0 },
            ],
        })
        expect((next.groups as { rollout_percentage: number }[]).map((g) => g.rollout_percentage)).toEqual([5, 100])
    })

    it('validates variant totals, unknown keys and conditions that force a removed variant', () => {
        const flag = {
            filters: {
                groups: [{ properties: [], rollout_percentage: 100, variant: 'test' }],
                multivariate: {
                    variants: [
                        { key: 'control', rollout_percentage: 50 },
                        { key: 'test', rollout_percentage: 50 },
                    ],
                },
            },
        }
        expect(() =>
            planFlagFilters(flag, { variants: [{ op: 'update', key: 'test', rollout_percentage: 60 }] })
        ).toThrow(/add up to 110, not 100/)
        // Updating only the name keeps the stored rollout.
        const renamed = planFlagFilters(flag, { variants: [{ op: 'update', key: 'test', name: 'Treatment' }] })
        expect((renamed.multivariate as { variants: unknown[] }).variants[1]).toEqual({
            key: 'test',
            rollout_percentage: 50,
            name: 'Treatment',
        })
        expect(() => planFlagFilters(flag, { variants: [{ op: 'remove', key: 'nope' }] })).toThrow(
            /No variant with key nope/
        )
        expect(() =>
            planFlagFilters(flag, {
                variants: [
                    { op: 'remove', key: 'test' },
                    { op: 'update', key: 'control', rollout_percentage: 100 },
                ],
            })
        ).toThrow(ToolInputValidationError)
        expect(() =>
            planFlagFilters(flag, { conditions: [{ op: 'update', condition_id: 'deadbeefdeadbeef', set: {} }] })
        ).toThrow(/flag may have changed/)
    })

    it('refuses a stale base_version without writing', async () => {
        const backend = fake()
        await expect(
            featureFlagUpdateConditions(backend.context(), {
                id: 488,
                base_version: 2,
                conditions: [{ op: 'update', index: 0, set: { rollout_percentage: 1 } }],
            })
        ).rejects.toBeInstanceOf(WriteConflictError)
        expect(backend.writes()).toHaveLength(0)
    })
})

describe('survey-update-question', () => {
    it('job 7: changes one question by id, leaving the others as stored', async () => {
        const backend = fake()
        const before = backend.get('surveys', 'sv1')!
        const receipt = await surveyUpdateQuestion(
            backend.context(),
            SurveyUpdateQuestionSchema.parse({
                id: 'sv1',
                question_id: 'q3',
                patch: { question: 'What nearly stopped you from signing up?' },
            })
        )
        const questions = backend.get('surveys', 'sv1')!.questions as { question: string; optional?: boolean }[]
        expect(questions[2]).toMatchObject({
            id: 'q3',
            question: 'What nearly stopped you from signing up?',
            optional: true,
        })
        expect(questions[1]).toEqual((before.questions as unknown[])[1])
        expect(receipt).toMatchObject({
            status: 'ok',
            changed: {
                '/questions/2/question': ['What almost stopped you?', 'What nearly stopped you from signing up?'],
            },
            version: surveyQuestionsVersion(backend.get('surveys', 'sv1')!),
        })
    })

    it('chains with the returned version and refuses a stale one', async () => {
        const backend = fake()
        const first = await surveyUpdateQuestion(backend.context(), {
            id: 'sv1',
            question_index: 0,
            patch: { scale: 10 },
        })
        await expect(
            surveyUpdateQuestion(backend.context(), {
                id: 'sv1',
                question_index: 1,
                patch: { question: 'x' },
                base_version: 'q-00000000',
            })
        ).rejects.toBeInstanceOf(WriteConflictError)
        const second = await surveyUpdateQuestion(backend.context(), {
            id: 'sv1',
            question_index: 1,
            patch: { question: 'Which device did you use?' },
            base_version: first.version as string,
        })
        expect(second.status).toBe('ok')
    })

    it('rejects an unknown question, an id change and an invalid result', async () => {
        const backend = fake()
        await expect(
            surveyUpdateQuestion(backend.context(), { id: 'sv1', question_id: 'zz', patch: { question: 'x' } })
        ).rejects.toThrow(/no question with id zz/)
        expect(
            SurveyUpdateQuestionSchema.safeParse({ id: 'sv1', question_id: 'q1', patch: { id: 'q9' } }).success
        ).toBe(false)
        await expect(
            surveyUpdateQuestion(backend.context(), { id: 'sv1', question_id: 'q1', patch: { type: 'bogus' } })
        ).rejects.toThrow(/patched question is not valid/)
        expect(backend.writes()).toHaveLength(0)
    })
})
