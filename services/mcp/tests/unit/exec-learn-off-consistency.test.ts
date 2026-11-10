import { describe, expect, it } from 'vitest'
import { z } from 'zod'

import { MCP_EXEC_SKILLS_FEATURE_FLAG } from '@/hono/constants'
import { InstructionsBuilder } from '@/hono/instructions'
import { SessionManager } from '@/lib/SessionManager'
import { getToolsFromContext } from '@/tools'
import { createExecTool } from '@/tools/exec'
import { agentFacingInputSchema, rewritePlannerWording } from '@/tools/exec-schema-view'
import { stripSkillInstructions } from '@/tools/skill-mentions'
import { withAgentNote } from '@/tools/tool-utils'
import type { Context, Tool, ZodObjectAny } from '@/tools/types'

import { makeToolExecutorState } from '../shared/test-utils'

const context = {
    api: {} as any,
    cache: {} as any,
    env: {} as any,
    stateManager: { getApiKey: async () => ({ scopes: ['*'] }), getAiConsentGiven: async () => true } as any,
    sessionManager: new SessionManager({} as any),
    getDistinctId: async () => 'd',
    trackEvent: async () => {},
} as Context

describe('stripSkillInstructions', () => {
    it.each([
        [
            'drops a sentence that only loads a skill, and the one saying what it covers',
            'Create a dashboard. Load the building-a-dashboard skill before you create or change a dashboard. It covers layout. Pick tiles.',
            'Create a dashboard. Pick tiles.',
        ],
        [
            'keeps the rest of a sentence that also asks for something else',
            'Load the configuring-experiment-analytics skill before constructing the query, and use read-data-schema to confirm event names.',
            'Use read-data-schema to confirm event names.',
        ],
        [
            'keeps the step around an inline skill instruction',
            "If you don't have the ID, load the finding-experiments skill to resolve the user's reference first.",
            "If you don't have the ID, resolve the user's reference first.",
        ],
        [
            'keeps the alternative a sentence offers',
            'To act, use the `authoring-error-tracking-alerts` skill (or the `error-tracking-alerts-create` tool).',
            'To act, use the `error-tracking-alerts-create` tool.',
        ],
        [
            'drops an aside about a skill and keeps its sentence',
            'Provide design (design JSON for the editor — schema in the designing-email-templates skill); the email is compiled from it.',
            'Provide design (design JSON for the editor); the email is compiled from it.',
        ],
        [
            'renumbers a RULES list after removing an item',
            'RULES:\n1. Load the creating-experiments skill for the full\n   creation workflow.\n\n2. Do NOT pass metrics on creation.\n\nCreates an experiment.',
            'RULES:\n\n1. Do NOT pass metrics on creation.\n\nCreates an experiment.',
        ],
    ])('%s', (_label, input, expected) => {
        expect(stripSkillInstructions(input)).toBe(expected)
    })

    it('leaves text about the agent skills store alone', () => {
        const text =
            'Get a specific agent skill by name. Load a built-in skill with `learn posthog:<skill>` when the `learn` command is available.'
        expect(stripSkillInstructions(text)).toBe(text)
    })
})

describe('exec text when skills cannot be loaded', () => {
    function noteTool(note: string): Tool<ZodObjectAny> {
        return {
            name: 'dashboard-create',
            title: 'Create dashboard',
            description:
                'Create a dashboard. Load the building-a-dashboard skill before you create or change a dashboard.',
            schema: z.object({}),
            scopes: [],
            annotations: { destructiveHint: false, idempotentHint: false, openWorldHint: false, readOnlyHint: false },
            handler: async () => withAgentNote({ id: 7 }, note),
        }
    }
    const NOTE =
        'If you have not loaded the building-a-dashboard skill in this conversation, load it now, before you add tiles. Consider offering a subscription.'

    it('drops the skill step from info and from the _agentNote', async () => {
        const exec = createExecTool([noteTool(NOTE)], context, 'd', 'r', undefined, undefined, [], {
            skillsAvailable: false,
        })
        const info = (await exec.handler(context, { command: 'info dashboard-create' })) as string
        expect(info).not.toContain('building-a-dashboard')
        const call = (await exec.handler(context, { command: 'call --json dashboard-create {}' })) as string
        expect(JSON.parse(call)._agentNote).toBe('Consider offering a subscription.')
    })

    it('keeps the skill step where skills can be loaded', async () => {
        const exec = createExecTool([noteTool(NOTE)], context, 'd', 'r', undefined)
        const call = (await exec.handler(context, { command: 'call --json dashboard-create {}' })) as string
        expect(JSON.parse(call)._agentNote).toBe(NOTE)
    })

    it('names no skill in the real experiment, dashboard and survey tools', async () => {
        const tools = await getToolsFromContext(context)
        const exec = createExecTool(tools, context, 'd', 'r', undefined, undefined, [], { skillsAvailable: false })
        for (const name of ['experiment-create', 'experiment-update', 'dashboard-create', 'survey-create']) {
            const info = (await exec.handler(context, { command: `info ${name}` })) as string
            expect(info, name).not.toMatch(/[a-z0-9]+(?:-[a-z0-9]+)+`? skills?\b/)
        }
    })
})

describe('planner wording', () => {
    it('rewrites the PostHog AI planner sentences', () => {
        expect(rewritePlannerWording('Use one of the properties the user has provided in the plan.')).toBe(
            'Use a property that exists in the project.'
        )
        expect(rewritePlannerWording('Action name from the plan.')).toBe('Action name.')
        expect(rewritePlannerWording('No planner words here.')).toBe('No planner words here.')
    })

    it('leaves no plan wording in the schemas exec shows, without touching the tool schema', async () => {
        const tools = await getToolsFromContext(context)
        const retention = tools.find((tool) => tool.name === 'query-retention')!
        const source = JSON.stringify(z.toJSONSchema(retention.schema, { io: 'input' }))
        expect(source).toMatch(/\b(in|from) the plan\b/)
        expect(JSON.stringify(agentFacingInputSchema(retention))).not.toMatch(/\b(in|from) the plan\b/)
        const exec = createExecTool(tools, context, 'd', 'r', undefined)
        const drilled = (await exec.handler(context, {
            command: 'schema query-retention retentionFilter.targetEntity',
        })) as string
        expect(drilled).not.toMatch(/\b(in|from) the plan\b/)
    })
})

describe('instructions when learn is off', () => {
    const builder = new InstructionsBuilder('guidelines')
    const tools = ['dashboard-create', 'insight-create', 'dashboard-widgets-batch-add', 'execute-sql'].map((name) => ({
        name,
    }))

    it('does not ask to prioritize skills without the skills flag', () => {
        const off = builder.build(makeToolExecutorState(tools, { useSingleExec: true }))
        expect(off).not.toContain('Prioritize skills over tools.')
        const on = builder.build(
            makeToolExecutorState(tools, {
                useSingleExec: true,
                toolFeatureFlags: { [MCP_EXEC_SKILLS_FEATURE_FLAG]: true },
            })
        )
        expect(on).toContain('Prioritize skills over tools.')
    })

    it('names insight-create with dashboards for insight tiles', () => {
        const reference = builder.buildExecCommandReference(makeToolExecutorState(tools, { useSingleExec: true }))
        expect(reference).toContain('`insight-create` with `dashboards: [<dashboard id>]` for each insight tile')
        expect(reference).not.toContain('`dashboard-create` plus `dashboard-widgets-batch-add`')
    })
})
