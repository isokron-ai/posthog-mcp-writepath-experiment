/**
 * The version-checked read-merge-write, and the concurrency guarantee of the partial-update tools:
 * two simultaneous partial updates to different elements of one object never silently lose one.
 * Either both land, or one is refused with a conflict (or, for a flag, reports that another write
 * landed in its window).
 */
import { describe, expect, it } from 'vitest'

import { KeyedMutex } from '@/tools/atomic/concurrency'
import { WriteConflictError } from '@/tools/atomic/errors'
import {
    featureFlagUpdateConditions,
    insightUpdateQueryPartial,
    surveyUpdateQuestion,
} from '@/tools/atomic/partialUpdates'
import { featureFlagResource, insightResource } from '@/tools/atomic/resources'
import { versionCheckedUpdate } from '@/tools/atomic/versionGuard'

import { FakePostHog, jitter } from '../fixtures/fake-posthog-backend'

type Funnel = { kind: string; source: { kind: string; series: { kind: string; event: string }[] } }
type FlagFilters = {
    groups: { properties: Record<string, unknown>[]; rollout_percentage: number }[]
    multivariate: { variants: { key: string; rollout_percentage: number }[] }
}

const funnelQuery = (): Funnel => ({
    kind: 'InsightVizNode',
    source: {
        kind: 'FunnelsQuery',
        series: [
            { kind: 'EventsNode', event: 'pageview' },
            { kind: 'EventsNode', event: 'signup_started' },
            { kind: 'EventsNode', event: 'signup_completed' },
        ],
    },
})

const flagFilters = (): FlagFilters => ({
    groups: [
        {
            properties: [{ key: 'email', value: '@acme.com', operator: 'icontains', type: 'person' }],
            rollout_percentage: 100,
        },
        { properties: [], rollout_percentage: 20 },
    ],
    multivariate: {
        variants: [
            { key: 'control', rollout_percentage: 50 },
            { key: 'test', rollout_percentage: 50 },
        ],
    },
})

const surveyQuestions = (): Record<string, unknown>[] => [
    { id: 'q1', type: 'rating', question: 'How easy was it?', display: 'number', scale: 5 },
    { id: 'q2', type: 'single_choice', question: 'Which device?', choices: ['Desktop', 'Phone'] },
    { id: 'q3', type: 'open', question: 'What almost stopped you?' },
]

function seeded(options: ConstructorParameters<typeof FakePostHog>[0] = {}): FakePostHog {
    const fake = new FakePostHog(options)
    fake.seed('insights', { id: 94, short_id: 'abc12345', name: 'Signup funnel', query: funnelQuery(), tags: [] })
    fake.seed('feature_flags', { id: 488, key: 'new-checkout', filters: flagFilters(), version: 3 })
    fake.seed('surveys', { id: 'sv1', name: 'Signup survey', questions: surveyQuestions() })
    return fake
}

describe('versionCheckedUpdate', () => {
    it('writes nothing and raises a conflict when the object changed between the read and the final check', async () => {
        const fake = seeded()
        const resource = insightResource(fake.context(), '42', 94)
        await expect(
            versionCheckedUpdate(resource, () => {
                // Another writer lands while this update is being prepared.
                fake.externalPatch('insights', 94, {
                    query: { ...funnelQuery(), source: { kind: 'TrendsQuery', series: [] } },
                })
                return { body: { query: funnelQuery() } }
            })
        ).rejects.toBeInstanceOf(WriteConflictError)
        expect(fake.writes()).toHaveLength(0)
    })

    it('refuses a stale base_version before reading further', async () => {
        const fake = seeded()
        const resource = featureFlagResource(fake.context(), '42', 488)
        await expect(
            versionCheckedUpdate(resource, () => ({ body: { active: false } }), { baseVersion: 2 })
        ).rejects.toThrow(/changed since the version you read .*base_version 2, it is now 3/)
        expect(fake.writes()).toHaveLength(0)
    })

    it('sends the flag version as the precondition and maps the API 409 to a conflict', async () => {
        const fake = seeded({ flagVersionCheck: true })
        fake.beforeWrite = () => {
            fake.beforeWrite = undefined
            fake.externalPatch('feature_flags', 488, { name: 'renamed in the UI' })
        }
        const resource = featureFlagResource(fake.context(), '42', 488)
        const attempt = versionCheckedUpdate(resource, (flag) => ({ body: { filters: flag.filters } }))
        await expect(attempt).rejects.toBeInstanceOf(WriteConflictError)
        expect(fake.log.find((entry) => entry.method === 'PATCH')?.body).toMatchObject({ version: 3 })
    })

    it('reports a write that landed in the race window when the flag version moved by more than one', async () => {
        const fake = seeded({ flagVersionCheck: false })
        fake.beforeWrite = () => {
            fake.beforeWrite = undefined
            fake.externalPatch('feature_flags', 488, { name: 'renamed in the UI' })
        }
        const result = await versionCheckedUpdate(featureFlagResource(fake.context(), '42', 488), (flag) => ({
            body: { filters: flag.filters },
        }))
        expect(result.status).toBe('ok')
        expect(result.concurrentWriteDetected).toBe(true)
        expect(result.warning).toMatch(/may have replaced that other change/)
    })

    it('dry_run plans and validates but makes no write', async () => {
        const fake = seeded()
        const result = await versionCheckedUpdate(
            insightResource(fake.context(), '42', 94),
            () => ({ body: { name: 'x' } }),
            {
                dryRun: true,
            }
        )
        expect(result.status).toBe('dry_run')
        expect(fake.writes()).toHaveLength(0)
    })

    it('documents the remaining race window: an endpoint without a precondition can still lose an outside write that lands between the final check and the write', async () => {
        // This is the risk the tool descriptions and the README state. It needs a writer outside this
        // process (separate lock) whose write lands in the one round trip after the final re-read.
        const fake = seeded()
        fake.beforeWrite = (request) => {
            if (request.method === 'PATCH') {
                fake.beforeWrite = undefined
                fake.externalPatch('insights', 94, {
                    query: {
                        ...funnelQuery(),
                        source: { ...funnelQuery().source, breakdownFilter: { breakdown: '$browser' } },
                    },
                })
            }
        }
        const result = await versionCheckedUpdate(
            insightResource(fake.context(), '42', 94),
            (insight) => ({ body: { query: { ...(insight.query as object), filterTestAccounts: true } } }),
            { locks: new KeyedMutex() }
        )
        expect(result.status).toBe('ok')
        expect(result.concurrentWriteDetected).toBeUndefined()
        expect(
            (fake.get('insights', 94)!.query as { source: Record<string, unknown> }).source.breakdownFilter
        ).toBeUndefined()
    })
})

type Outcome = 'both_landed' | 'one_conflict' | 'race_reported' | 'silent_loss'

async function race(
    first: () => Promise<{ concurrent_write_detected?: boolean } | unknown>,
    second: () => Promise<{ concurrent_write_detected?: boolean } | unknown>,
    landed: () => [boolean, boolean]
): Promise<Outcome> {
    const settled = await Promise.allSettled([first(), second()])
    const [a, b] = landed()
    const conflicts = settled.filter((s) => s.status === 'rejected' && s.reason instanceof WriteConflictError).length
    const other = settled.find((s) => s.status === 'rejected' && !(s.reason instanceof WriteConflictError))
    if (other) {
        throw (other as PromiseRejectedResult).reason
    }
    const reported = settled.some(
        (s) =>
            s.status === 'fulfilled' && (s.value as { concurrent_write_detected?: boolean })?.concurrent_write_detected
    )
    if (a && b) {
        return 'both_landed'
    }
    if (conflicts === 1 && (a || b)) {
        return 'one_conflict'
    }
    if (reported) {
        return 'race_reported'
    }
    return 'silent_loss'
}

const ROUNDS = 40

describe('concurrent partial updates through the tools never silently lose one', () => {
    it('insight-update-query-partial: two series edited at the same time', async () => {
        const outcomes: Outcome[] = []
        for (let round = 0; round < ROUNDS; round++) {
            const fake = seeded({ latency: jitter(0, 3) })
            const context = fake.context()
            outcomes.push(
                await race(
                    () =>
                        insightUpdateQueryPartial(context, {
                            id: 94,
                            json_patch: [{ op: 'replace', path: '/source/series/0/event', value: `a${round}` }],
                        }),
                    () =>
                        insightUpdateQueryPartial(context, {
                            id: 'abc12345',
                            json_patch: [{ op: 'replace', path: '/source/series/2/event', value: `b${round}` }],
                        }),
                    () => {
                        const series = (fake.get('insights', 94)!.query as ReturnType<typeof funnelQuery>).source.series
                        return [series[0]!.event === `a${round}`, series[2]!.event === `b${round}`]
                    }
                )
            )
        }
        expect(outcomes).not.toContain('silent_loss')
        // Inside one server process the object lock serializes the two, so both always land.
        expect(new Set(outcomes)).toEqual(new Set(['both_landed']))
    })

    it('feature-flag-update-conditions: two conditions edited at the same time', async () => {
        const outcomes: Outcome[] = []
        for (let round = 0; round < ROUNDS; round++) {
            const fake = seeded({ latency: jitter(0, 3) })
            const context = fake.context()
            outcomes.push(
                await race(
                    () =>
                        featureFlagUpdateConditions(context, {
                            id: 488,
                            conditions: [{ op: 'update', index: 0, set: { rollout_percentage: 75 } }],
                        }),
                    () =>
                        featureFlagUpdateConditions(context, {
                            id: 488,
                            conditions: [{ op: 'update', index: 1, set: { rollout_percentage: 40 } }],
                        }),
                    () => {
                        const groups = (fake.get('feature_flags', 488)!.filters as ReturnType<typeof flagFilters>)
                            .groups
                        return [groups[0]!.rollout_percentage === 75, groups[1]!.rollout_percentage === 40]
                    }
                )
            )
        }
        expect(new Set(outcomes)).toEqual(new Set(['both_landed']))
    })

    it('survey-update-question: two questions edited at the same time', async () => {
        const outcomes: Outcome[] = []
        for (let round = 0; round < ROUNDS; round++) {
            const fake = seeded({ latency: jitter(0, 3) })
            const context = fake.context()
            outcomes.push(
                await race(
                    () =>
                        surveyUpdateQuestion(context, {
                            id: 'sv1',
                            question_id: 'q1',
                            patch: { question: `first ${round}` },
                        }),
                    () =>
                        surveyUpdateQuestion(context, {
                            id: 'sv1',
                            question_index: 2,
                            patch: { question: `third ${round}` },
                        }),
                    () => {
                        const questions = fake.get('surveys', 'sv1')!.questions as { question: string }[]
                        return [
                            questions[0]!.question === `first ${round}`,
                            questions[2]!.question === `third ${round}`,
                        ]
                    }
                )
            )
        }
        expect(new Set(outcomes)).toEqual(new Set(['both_landed']))
    })
})

describe('concurrent partial updates from two server processes (separate locks)', () => {
    async function crossProcessFlagRounds(flagVersionCheck: boolean): Promise<Record<Outcome, number>> {
        const counts: Record<Outcome, number> = { both_landed: 0, one_conflict: 0, race_reported: 0, silent_loss: 0 }
        for (let round = 0; round < ROUNDS; round++) {
            const fake = seeded({ latency: jitter(0, 3), flagVersionCheck })
            const resource = featureFlagResource(fake.context(), '42', 488)
            const edit = (index: number, rollout: number, locks: KeyedMutex) => async () => {
                const result = await versionCheckedUpdate(
                    resource,
                    (flag) => {
                        const filters = JSON.parse(JSON.stringify(flag.filters)) as ReturnType<typeof flagFilters>
                        filters.groups[index]!.rollout_percentage = rollout
                        return { body: { filters } }
                    },
                    { locks }
                )
                return { concurrent_write_detected: result.concurrentWriteDetected }
            }
            const outcome = await race(edit(0, 75, new KeyedMutex()), edit(1, 40, new KeyedMutex()), () => {
                const groups = (fake.get('feature_flags', 488)!.filters as ReturnType<typeof flagFilters>).groups
                return [groups[0]!.rollout_percentage === 75, groups[1]!.rollout_percentage === 40]
            })
            counts[outcome]++
        }
        return counts
    }

    it('flags that check version: every race ends with both landed or one conflict', async () => {
        const counts = await crossProcessFlagRounds(true)
        expect(counts.silent_loss).toBe(0)
        expect(counts.race_reported).toBe(0)
        expect(counts.both_landed + counts.one_conflict).toBe(ROUNDS)
    })

    it('flags that do not check version: a lost race is always reported by the version counter', async () => {
        const counts = await crossProcessFlagRounds(false)
        expect(counts.silent_loss).toBe(0)
        expect(counts.both_landed + counts.one_conflict + counts.race_reported).toBe(ROUNDS)
    })
})
