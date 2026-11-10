/**
 * Validation helpers shared by the atomic-write and batch tools.
 *
 * The tools keep their own input schemas small (a query is a plain object in the input schema,
 * so the tool stays far under the registry's schema size limit), then validate each nested value
 * here against the same schema the single-object tool uses. One schema, two entry points.
 */
import type { z } from 'zod'

import { isRecord } from '@/lib/plain-object'
import { GENERATED_TOOL_MAP } from '@/tools/generated'
import type { ZodObjectAny } from '@/tools/types'

type Issue = z.core.$ZodIssue

function issueLines(issues: readonly Issue[], prefix: string[]): string[] {
    const lines: string[] = []
    for (const issue of issues) {
        const path = [...prefix, ...issue.path.map(String)]
        if (issue.code === 'invalid_union' && Array.isArray(issue.errors) && issue.errors.length > 0) {
            // Report the branch the value was closest to: the one that accepted its `kind`, with the
            // fewest problems. Listing every branch's complaint would bury the one that matters.
            const branches = issue.errors as Issue[][]
            const ranked = [...branches].sort((a, b) => score(a) - score(b))
            lines.push(...issueLines(ranked[0]!, path))
            continue
        }
        lines.push(`${path.join('.') || '(root)'}: ${issue.message}`)
    }
    return lines
}

function score(branch: readonly Issue[]): number {
    const kindMiss = branch.some((issue) => issue.path[issue.path.length - 1] === 'kind') ? 1000 : 0
    return kindMiss + branch.length
}

/** `a.b: message; c: message`, at most `max` entries. */
export function formatIssues(error: z.ZodError, prefix: string[] = [], max = 5): string {
    const lines = issueLines(error.issues, prefix)
    const shown = lines.slice(0, max)
    return shown.join('; ') + (lines.length > max ? `; and ${lines.length - max} more` : '')
}

function toolShape(toolName: string): Record<string, z.ZodType> | undefined {
    const factory = GENERATED_TOOL_MAP[toolName]
    const schema = factory?.().schema as ZodObjectAny | undefined
    return schema && 'shape' in schema ? (schema.shape as Record<string, z.ZodType>) : undefined
}

let insightQuerySchema: z.ZodType | undefined

/** The `query` schema of insight-create, so a tile is checked exactly as insight-create would check it. */
export function getInsightQuerySchema(): z.ZodType {
    if (!insightQuerySchema) {
        const schema = toolShape('insight-create')?.query
        if (!schema) {
            throw new Error('insight-create is not registered, so a query cannot be validated')
        }
        insightQuerySchema = schema
    }
    return insightQuerySchema
}

/** Returns an error message for an invalid insight query, or undefined when it is valid. */
export function validateInsightQuery(query: unknown, prefix: string[] = ['query']): string | undefined {
    if (!isRecord(query)) {
        return `${prefix.join('.')}: must be an object with a \`kind\``
    }
    const parsed = getInsightQuerySchema().safeParse(query)
    return parsed.success ? undefined : formatIssues(parsed.error, prefix)
}

let annotationItemSchema: ZodObjectAny | undefined

/** The input schema of annotation-create: the batch item is the single tool's input, unchanged. */
export function getAnnotationCreateSchema(): ZodObjectAny {
    if (!annotationItemSchema) {
        const schema = GENERATED_TOOL_MAP['annotation-create']?.().schema as ZodObjectAny | undefined
        if (!schema) {
            throw new Error('annotation-create is not registered')
        }
        annotationItemSchema = schema
    }
    return annotationItemSchema
}

/**
 * The query an insight runs. A visualization node (InsightVizNode, DataTableNode, DataVisualizationNode,
 * BIVisualizationNode) wraps the runnable query in `source`; anything else runs as it is.
 */
export function runnableQuery(query: Record<string, unknown>): Record<string, unknown> {
    const wrappers = ['InsightVizNode', 'DataTableNode', 'DataVisualizationNode', 'BIVisualizationNode']
    if (typeof query.kind === 'string' && wrappers.includes(query.kind) && isRecord(query.source)) {
        return query.source
    }
    return query
}
