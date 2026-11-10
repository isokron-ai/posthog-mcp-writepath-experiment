import type { z } from 'zod'

import { ReadDataSchemaSchema } from '@/schema/tool-inputs'
import type { Context, ToolBase } from '@/tools/types'

import { invokeMcpTool } from './invokeTool'

const schema = ReadDataSchemaSchema

type Params = z.infer<typeof schema>

/** The marker the backend's events formatter puts on an event defined for the project
 *  but not seen in its window ("(not seen in the last 30 days)"). */
const UNSEEN_EVENT_LINE = /^- .*\(not seen in the last (\d+) days?\)\s*$/

/** The backend's footnote explaining the marker, which has nothing to explain once
 *  the marked rows are gone. */
const UNSEEN_EVENTS_FOOTNOTE = /^# Events marked \(not seen in the last \d+ days?\)/

/**
 * Leaves out the events the project has not sent in the window, and says how many there
 * were and how to list them.
 *
 * On a young or narrow project most of the list is PostHog's catalogue of known events
 * (`$ai_*`, `$conversation_*`, mobile lifecycle) that it never sent: 66 of 71 rows on the
 * project this was measured on, about 3,000 tokens around 5 real events. The backend
 * marks those rows, so this is done here rather than in the backend helper, which other
 * surfaces share. Only a line the backend marked is removed; every other line, the
 * snapshot note included, passes through unchanged.
 */
export function omitUnseenEvents(content: string): string {
    const lines = content.split('\n')
    const kept: string[] = []
    let omitted = 0
    let windowDays: string | undefined
    for (const line of lines) {
        const unseen = UNSEEN_EVENT_LINE.exec(line)
        if (unseen) {
            omitted += 1
            windowDays ??= unseen[1]
            continue
        }
        if (UNSEEN_EVENTS_FOOTNOTE.test(line)) {
            continue
        }
        kept.push(line)
    }
    if (omitted === 0) {
        return content
    }
    const note = `# ${omitted} more event${omitted === 1 ? ' is' : 's are'} defined for this project but not seen in the last ${windowDays} days, so they are left out. To list them, call read-data-schema with {"query": {"kind": "events", "include_unseen": true}}.`
    // After the event rows, before the snapshot footnote, where the backend put its own note.
    const footnoteAt = kept.findIndex((line) => line.startsWith('# Taxonomy snapshot'))
    if (footnoteAt === -1) {
        return `${kept.join('\n').trimEnd()}\n\n${note}`
    }
    const before = kept.slice(0, footnoteAt).join('\n').trimEnd()
    const after = kept.slice(footnoteAt).join('\n')
    return `${before}\n\n${note}\n\n${after}`
}

export const readDataSchemaHandler: ToolBase<typeof schema, string>['handler'] = async (
    context: Context,
    params: Params
) => {
    const query = params.query
    const includeUnseen = query.kind === 'events' && query.include_unseen === true
    // `include_unseen` is this server's option, not the backend's.
    const { include_unseen: _option, ...backendQuery } = query as typeof query & { include_unseen?: boolean }
    const result = await invokeMcpTool(context, 'read_taxonomy', {
        query: backendQuery,
    })

    if (query.kind !== 'events' || includeUnseen || typeof result.content !== 'string') {
        return result.content
    }
    return omitUnseenEvents(result.content)
}

const tool = (): ToolBase<typeof schema, string> => ({
    name: 'read-data-schema',
    schema,
    handler: readDataSchemaHandler,
})

export default tool
