/**
 * Partial updates of nested arrays, each a version-checked read-merge-write (see versionGuard.ts):
 *
 * - insight-update-query-partial: a JSON Patch (RFC 6902) or merge patch (RFC 7396) on an insight's
 *   `query`, e.g. change one funnel step or one trend series.
 * - feature-flag-update-conditions: change, add or remove one release condition (by condition_id or
 *   index) or one variant (by key), without resending the rest of `filters`.
 * - survey-update-question: merge-patch one survey question (by id or index).
 *
 * Each reads the object, applies the change, validates the result, re-reads and compares the
 * version marker, and only then writes. A change since the agent's `base_version`, or since the
 * read, returns a conflict and writes nothing. The receipt lists what changed as `{path: [old, new]}`
 * and the new `version` to send as `base_version` next time.
 */
import { z } from 'zod'

import * as insightSchemas from '@/generated/product_analytics/api'
import * as surveySchemas from '@/generated/surveys/api'
import { ToolInputValidationError } from '@/lib/errors'
import { canonicalJson, isRecord } from '@/lib/plain-object'
import { flagLevelGroupIndex } from '@/tools/featureFlags/aggregation'
import { conditionId } from '@/tools/featureFlags/conditionIds'
import type { Context, ToolBase } from '@/tools/types'

import { applyJsonPatch, applyMergePatch, cloneJson, diffJson, JsonPatchOperationSchema } from './jsonPatch'
import {
    type ApiObject,
    appUrl,
    featureFlagResource,
    insightResource,
    resolveInsightId,
    surveyQuestionsVersion,
    surveyResource,
} from './resources'
import { formatIssues, validateInsightQuery } from './validation'
import { versionCheckedUpdate, type GuardedUpdateResult } from './versionGuard'

export interface PartialUpdateReceipt {
    status: 'ok' | 'unchanged' | 'dry_run'
    id: number | string
    name?: string | null
    key?: string
    changed: Record<string, [unknown, unknown]>
    changed_truncated?: boolean
    version: string | number | null
    concurrent_write_detected?: boolean
    warning?: string
    url: string
    [extra: string]: unknown
}

const BaseVersion = z
    .union([z.string(), z.number()])
    .optional()
    .describe(
        "The version from your last read (an insight's updated_at, a flag's version, or the version a previous call returned). If the object has changed since, nothing is written and you get a conflict."
    )

const DryRun = z.boolean().optional().describe('Apply and validate the change and show the diff, without writing.')

function receipt<T extends ApiObject>(
    result: GuardedUpdateResult<T>,
    fields: readonly string[],
    version: (object: T) => string | number | null | undefined
): Pick<
    PartialUpdateReceipt,
    'status' | 'changed' | 'changed_truncated' | 'version' | 'concurrent_write_detected' | 'warning'
> {
    const changed: Record<string, [unknown, unknown]> = {}
    let truncated = false
    if (result.status !== 'unchanged') {
        for (const field of fields) {
            if (result.body && !(field in result.body)) {
                continue
            }
            const after = result.after ? result.after[field] : result.body?.[field]
            const diff = diffJson(result.before[field], after)
            truncated ||= diff.truncated
            for (const [path, pair] of Object.entries(diff.changes)) {
                changed[`/${field}${path === '/' ? '' : path}`] = pair
            }
        }
    }
    return {
        status: result.status,
        changed,
        ...(truncated ? { changed_truncated: true } : {}),
        version: (result.after ? version(result.after) : version(result.before)) ?? null,
        ...(result.concurrentWriteDetected ? { concurrent_write_detected: true, warning: result.warning } : {}),
    }
}

// ---------------------------------------------------------------------------------------------
// insight-update-query-partial

const insightBody = insightSchemas.InsightsPartialUpdateBody().shape

export const InsightUpdateQueryPartialSchema = z
    .object({
        id: z.union([z.number().int(), z.string().min(1)]).describe('Insight id or short_id.'),
        json_patch: z
            .array(JsonPatchOperationSchema)
            .min(1)
            .max(50)
            .optional()
            .describe(
                'RFC 6902 operations on the insight\'s `query`, e.g. [{"op":"replace","path":"/source/series/1/event","value":"signup"}] or [{"op":"add","path":"/source/series/-","value":{"kind":"EventsNode","event":"purchase"}}]. Add a `test` op to assert a value first. Use this to change one array element.'
            ),
        merge_patch: z
            .record(z.string(), z.unknown())
            .optional()
            .describe(
                'RFC 7396 merge patch on `query`, e.g. {"source":{"dateRange":{"date_from":"-30d"}}}. null removes a key. Arrays are replaced whole, so use json_patch for one element.'
            ),
        name: insightBody.name.describe('New name, written in the same version-checked update.'),
        description: insightBody.description.describe('New description, written in the same update.'),
        base_version: BaseVersion,
        dry_run: DryRun,
    })
    .superRefine((value, ctx) => {
        if (value.json_patch !== undefined && value.merge_patch !== undefined) {
            ctx.addIssue({ code: 'custom', message: 'give json_patch or merge_patch, not both' })
        }
        if ([value.json_patch, value.merge_patch, value.name, value.description].every((v) => v === undefined)) {
            ctx.addIssue({ code: 'custom', message: 'give json_patch, merge_patch, name or description' })
        }
    })

export async function insightUpdateQueryPartial(
    context: Context,
    params: z.infer<typeof InsightUpdateQueryPartialSchema>
): Promise<PartialUpdateReceipt> {
    const projectId = await context.stateManager.getProjectId()
    const id = await resolveInsightId(context, projectId, params.id)
    const resource = insightResource(context, projectId, id)
    const result = await versionCheckedUpdate(
        resource,
        (current) => {
            const body: Record<string, unknown> = {}
            if (params.json_patch !== undefined || params.merge_patch !== undefined) {
                if (!isRecord(current.query)) {
                    throw new ToolInputValidationError(
                        `Insight ${id} has no query to patch (it may be a legacy filters-only insight). Use insight-update.`
                    )
                }
                let next: unknown
                try {
                    next = params.json_patch
                        ? applyJsonPatch(current.query, params.json_patch)
                        : applyMergePatch(current.query, params.merge_patch)
                } catch (error) {
                    const reason = error instanceof Error ? error.message : String(error)
                    throw new ToolInputValidationError(
                        `The patch does not apply to insight ${id}'s query: ${reason}. Nothing was written.`
                    )
                }
                const invalid = validateInsightQuery(next)
                if (invalid) {
                    throw new ToolInputValidationError(
                        `The patched query is not valid: ${invalid}. Nothing was written.`
                    )
                }
                if (canonicalJson(current.query) !== canonicalJson(next)) {
                    body.query = next
                }
            }
            for (const field of ['name', 'description'] as const) {
                if (params[field] !== undefined && params[field] !== current[field]) {
                    body[field] = params[field]
                }
            }
            return Object.keys(body).length > 0 ? { body } : { unchanged: true }
        },
        { baseVersion: params.base_version, dryRun: params.dry_run }
    )
    const insight = result.after ?? result.before
    return {
        id,
        name: (insight.name as string | null | undefined) ?? null,
        short_id: insight.short_id,
        ...receipt(result, ['query', 'name', 'description'], resource.agentVersion),
        url: await appUrl(context, `/insights/${insight.short_id as string}`),
    }
}

// ---------------------------------------------------------------------------------------------
// feature-flag-update-conditions

const ConditionRef = {
    condition_id: z
        .string()
        .optional()
        .describe('The condition_id a flag read returned. Preferred: it survives reordering.'),
    index: z.number().int().min(0).optional().describe('Position in filters.groups, from 0.'),
}

const ConditionFields = z
    .object({
        rollout_percentage: z
            .number()
            .min(0)
            .max(100)
            .nullable()
            .optional()
            .describe('Rollout for this condition, 0-100.'),
        variant: z
            .string()
            .nullable()
            .optional()
            .describe('Force this variant key for matching users; null clears it.'),
        description: z.string().nullable().optional().describe('Condition description.'),
        properties: z
            .array(z.record(z.string(), z.unknown()))
            .optional()
            .describe('Replace the property filters of this condition (each with key, value, operator, type).'),
        aggregation_group_type_index: z.number().int().nullable().optional().describe('Group type to aggregate on.'),
    })
    .strict()

const ConditionOpSchema = z
    .object({
        op: z
            .enum(['update', 'add', 'remove'])
            .describe('update and remove name a condition; add inserts `set` as a new one.'),
        ...ConditionRef,
        position: z.number().int().min(0).optional().describe('add only: insert at this index; default is the end.'),
        set: ConditionFields.optional().describe(
            'update: the fields to change, others stay. add: the new condition (properties default to [], rollout to 100).'
        ),
    })
    .strict()
    .superRefine((op, ctx) => {
        const named = op.condition_id !== undefined || op.index !== undefined
        if (op.op !== 'add' && !named) {
            ctx.addIssue({ code: 'custom', message: `${op.op} needs condition_id or index` })
        }
        if (op.op !== 'remove' && op.set === undefined) {
            ctx.addIssue({ code: 'custom', path: ['set'], message: `${op.op} needs set` })
        }
    })
    .describe('One change to the release conditions.')

const VariantOpSchema = z
    .object({
        op: z.enum(['update', 'add', 'remove']).describe('What to do with the variant named by key.'),
        key: z.string().min(1).describe('Variant key.'),
        rollout_percentage: z.number().min(0).max(100).optional().describe('Share of users, 0-100. Required for add.'),
        name: z.string().nullable().optional().describe('Variant description.'),
    })
    .strict()
    .superRefine((op, ctx) => {
        if (op.op === 'add' && op.rollout_percentage === undefined) {
            ctx.addIssue({ code: 'custom', path: ['rollout_percentage'], message: 'add needs rollout_percentage' })
        }
    })
    .describe('One change to the multivariate variants.')

export const FeatureFlagUpdateConditionsSchema = z
    .object({
        id: z.number().int().describe('Feature flag id.'),
        conditions: z
            .array(ConditionOpSchema)
            .max(20)
            .optional()
            .describe('Changes to release conditions, applied in order.'),
        variants: z
            .array(VariantOpSchema)
            .max(20)
            .optional()
            .describe('Changes to multivariate variants, applied in order. Rollouts must add up to 100 afterwards.'),
        base_version: BaseVersion,
        dry_run: DryRun,
    })
    .superRefine((value, ctx) => {
        if (!value.conditions?.length && !value.variants?.length) {
            ctx.addIssue({ code: 'custom', message: 'give at least one change in conditions or variants' })
        }
    })

type FlagParams = z.infer<typeof FeatureFlagUpdateConditionsSchema>

function findCondition(
    groups: ApiObject[],
    flagLevel: number | undefined,
    ref: { condition_id?: string | undefined; index?: number | undefined }
): number {
    if (ref.condition_id !== undefined) {
        const at = groups.findIndex((group) => conditionId(group, flagLevel) === ref.condition_id)
        if (at < 0) {
            throw new ToolInputValidationError(
                `No condition has condition_id ${ref.condition_id}; the flag may have changed since you read it. Read it again.`
            )
        }
        return at
    }
    if (ref.index !== undefined) {
        if (ref.index >= groups.length) {
            throw new ToolInputValidationError(
                `Condition index ${ref.index} is out of range (the flag has ${groups.length}).`
            )
        }
        return ref.index
    }
    throw new ToolInputValidationError('Name the condition with condition_id or index.')
}

const withoutUndefined = (object: Record<string, unknown>): Record<string, unknown> =>
    Object.fromEntries(Object.entries(object).filter(([, value]) => value !== undefined))

/** The new `filters`, from the flag as it is now. Exported for tests. */
export function planFlagFilters(flag: ApiObject, params: Pick<FlagParams, 'conditions' | 'variants'>): ApiObject {
    const filters = isRecord(flag.filters) ? (cloneJson(flag.filters) as ApiObject) : {}
    const flagLevel = flagLevelGroupIndex(filters)
    // Ids are computed on the stored conditions once, before any edit moves them.
    const groups = (Array.isArray(filters.groups) ? filters.groups : []).filter(isRecord).map((group) => {
        const { condition_id: _drop, ...rest } = group
        return rest
    })
    const ids = groups.map((group) => conditionId(group, flagLevel))
    const resolve = (ref: { condition_id?: string | undefined; index?: number | undefined }): number => {
        if (ref.condition_id !== undefined) {
            const at = ids.indexOf(ref.condition_id)
            if (at < 0) {
                return findCondition(groups, flagLevel, ref)
            }
            return at
        }
        return findCondition(groups, flagLevel, ref)
    }
    for (const op of params.conditions ?? []) {
        if (op.op === 'update') {
            const at = resolve(op)
            groups[at] = { ...groups[at], ...withoutUndefined({ ...op.set }) }
        } else if (op.op === 'add') {
            const position = op.position ?? groups.length
            const condition = withoutUndefined({ properties: [], rollout_percentage: 100, ...op.set })
            groups.splice(Math.min(position, groups.length), 0, condition)
            ids.splice(Math.min(position, ids.length), 0, '')
        } else {
            const at = resolve(op)
            groups.splice(at, 1)
            ids.splice(at, 1)
        }
    }
    filters.groups = groups

    if (params.variants?.length) {
        const multivariate = isRecord(filters.multivariate) ? filters.multivariate : { variants: [] }
        const variants = (Array.isArray(multivariate.variants) ? multivariate.variants : []).filter(isRecord)
        for (const op of params.variants) {
            const at = variants.findIndex((variant) => variant.key === op.key)
            if (op.op === 'add') {
                if (at >= 0) {
                    throw new ToolInputValidationError(`Variant ${op.key} already exists. Use op "update".`)
                }
                variants.push(
                    withoutUndefined({ key: op.key, name: op.name, rollout_percentage: op.rollout_percentage })
                )
                continue
            }
            if (at < 0) {
                throw new ToolInputValidationError(`No variant with key ${op.key}.`)
            }
            if (op.op === 'update') {
                variants[at] = {
                    ...variants[at],
                    ...withoutUndefined({ rollout_percentage: op.rollout_percentage, name: op.name }),
                }
            } else {
                variants.splice(at, 1)
                for (const group of groups) {
                    if (group.variant === op.key) {
                        throw new ToolInputValidationError(
                            `Variant ${op.key} is forced by a release condition. Change or remove that condition's variant first.`
                        )
                    }
                }
            }
        }
        if (variants.length > 0) {
            const total = variants.reduce((sum, variant) => sum + Number(variant.rollout_percentage ?? 0), 0)
            if (Math.abs(total - 100) > 1e-9) {
                throw new ToolInputValidationError(
                    `Variant rollouts add up to ${total}, not 100: ${variants.map((v) => `${String(v.key)}=${String(v.rollout_percentage)}`).join(', ')}. Adjust them in the same call.`
                )
            }
            filters.multivariate = { ...multivariate, variants }
        } else {
            filters.multivariate = null
        }
    }
    for (const group of groups) {
        if (typeof group.variant === 'string' && group.variant !== '') {
            const known =
                isRecord(filters.multivariate) && Array.isArray(filters.multivariate.variants)
                    ? filters.multivariate.variants.some(
                          (variant) => isRecord(variant) && variant.key === group.variant
                      )
                    : false
            if (!known) {
                throw new ToolInputValidationError(
                    `A condition forces variant ${group.variant}, which the flag does not have.`
                )
            }
        }
    }
    return filters
}

export async function featureFlagUpdateConditions(context: Context, params: FlagParams): Promise<PartialUpdateReceipt> {
    const projectId = await context.stateManager.getProjectId()
    const resource = featureFlagResource(context, projectId, params.id)
    const result = await versionCheckedUpdate(
        resource,
        (current) => {
            const next = planFlagFilters(current, params)
            return canonicalJson(next) === canonicalJson(current.filters)
                ? { unchanged: true }
                : { body: { filters: next } }
        },
        { baseVersion: params.base_version, dryRun: params.dry_run }
    )
    const flag = result.after ?? result.before
    const filters = (result.after?.filters ?? result.body?.filters ?? result.before.filters) as ApiObject | undefined
    const flagLevel = filters ? flagLevelGroupIndex(filters) : undefined
    return {
        id: params.id,
        key: flag.key as string,
        ...receipt(result, ['filters'], resource.agentVersion),
        conditions: (Array.isArray(filters?.groups) ? filters.groups : []).filter(isRecord).map((group) => ({
            condition_id: conditionId(group, flagLevel),
            rollout_percentage: group.rollout_percentage ?? null,
            ...(group.variant ? { variant: group.variant } : {}),
            properties: Array.isArray(group.properties) ? group.properties.length : 0,
        })),
        ...(isRecord(filters?.multivariate) && Array.isArray(filters.multivariate.variants)
            ? {
                  variants: filters.multivariate.variants
                      .filter(isRecord)
                      .map((variant) => ({ key: variant.key, rollout_percentage: variant.rollout_percentage })),
              }
            : {}),
        url: await appUrl(context, `/feature-flags/${params.id}`),
    }
}

// ---------------------------------------------------------------------------------------------
// survey-update-question

export const SurveyUpdateQuestionSchema = z
    .object({
        id: z.string().min(1).describe('Survey id.'),
        question_id: z
            .string()
            .optional()
            .describe("The question's id from a survey read. Preferred over question_index."),
        question_index: z.number().int().min(0).optional().describe('Position in questions, from 0.'),
        patch: z
            .record(z.string(), z.unknown())
            .describe(
                'Merge patch (RFC 7396) on that one question, e.g. {"question":"New text"} or {"choices":["A","B"]}. null removes a key. The question id cannot change.'
            ),
        base_version: BaseVersion,
        dry_run: DryRun,
    })
    .superRefine((value, ctx) => {
        if ((value.question_id === undefined) === (value.question_index === undefined)) {
            ctx.addIssue({ code: 'custom', message: 'give exactly one of question_id or question_index' })
        }
        if ('id' in value.patch) {
            ctx.addIssue({ code: 'custom', path: ['patch', 'id'], message: 'a question id cannot be changed' })
        }
    })

let questionsSchema: z.ZodType | undefined
function getQuestionsSchema(): z.ZodType {
    questionsSchema ??= surveySchemas.SurveysPartialUpdateBody().shape.questions as z.ZodType
    return questionsSchema
}

export async function surveyUpdateQuestion(
    context: Context,
    params: z.infer<typeof SurveyUpdateQuestionSchema>
): Promise<PartialUpdateReceipt> {
    const projectId = await context.stateManager.getProjectId()
    const resource = surveyResource(context, projectId, params.id)
    const result = await versionCheckedUpdate(
        resource,
        (current) => {
            const questions = (Array.isArray(current.questions) ? cloneJson(current.questions) : []) as unknown[]
            const at =
                params.question_id !== undefined
                    ? questions.findIndex((question) => isRecord(question) && question.id === params.question_id)
                    : params.question_index!
            if (at < 0 || at >= questions.length) {
                throw new ToolInputValidationError(
                    params.question_id !== undefined
                        ? `Survey ${params.id} has no question with id ${params.question_id}. Read the survey again.`
                        : `Question index ${params.question_index} is out of range (the survey has ${questions.length}).`
                )
            }
            questions[at] = applyMergePatch(questions[at], params.patch)
            const parsed = getQuestionsSchema().safeParse(questions)
            if (!parsed.success) {
                throw new ToolInputValidationError(
                    `The patched question is not valid: ${formatIssues(parsed.error, ['questions'])}. Nothing was written.`
                )
            }
            return canonicalJson(questions) === canonicalJson(current.questions)
                ? { unchanged: true }
                : { body: { questions } }
        },
        { baseVersion: params.base_version, dryRun: params.dry_run }
    )
    const survey = result.after ?? result.before
    return {
        id: params.id,
        name: (survey.name as string | null | undefined) ?? null,
        ...receipt(result, ['questions'], surveyQuestionsVersion),
        // A dry run has not written, so its version is still the one read.
        ...(result.status === 'dry_run' ? { version: surveyQuestionsVersion(result.before) } : {}),
        url: await appUrl(context, `/surveys/${params.id}`),
    }
}

// ---------------------------------------------------------------------------------------------

export const insightUpdateQueryPartialTool = (): ToolBase<
    typeof InsightUpdateQueryPartialSchema,
    PartialUpdateReceipt
> => ({
    name: 'insight-update-query-partial',
    schema: InsightUpdateQueryPartialSchema,
    handler: insightUpdateQueryPartial,
})

export const featureFlagUpdateConditionsTool = (): ToolBase<
    typeof FeatureFlagUpdateConditionsSchema,
    PartialUpdateReceipt
> => ({
    name: 'feature-flag-update-conditions',
    schema: FeatureFlagUpdateConditionsSchema,
    handler: featureFlagUpdateConditions,
})

export const surveyUpdateQuestionTool = (): ToolBase<typeof SurveyUpdateQuestionSchema, PartialUpdateReceipt> => ({
    name: 'survey-update-question',
    schema: SurveyUpdateQuestionSchema,
    handler: surveyUpdateQuestion,
})
