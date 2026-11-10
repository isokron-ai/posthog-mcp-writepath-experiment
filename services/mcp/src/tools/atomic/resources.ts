/**
 * The REST objects the atomic tools read and write, each described once as a VersionedResource:
 * where it lives, which fields act as its version marker, and how it is written.
 *
 * Version markers per endpoint (what the API exposes; the backend is unchanged):
 * - insight: `updated_at` and `last_modified_at`. No precondition field, so the re-read is the guard.
 * - feature flag: `version` (a write counter) and `updated_at`. The PATCH accepts `version` and
 *   refuses a stale one with 409 for flags whose `filters.version` is 2; we always send it.
 * - survey: no marker is exposed. The guard compares the content of the fields being written
 *   (the questions), which a concurrent edit of those fields always changes.
 */
import { PostHogApiError } from '@/lib/errors'
import { canonicalJson } from '@/lib/plain-object'
import type { Context } from '@/tools/types'

import type { VersionedResource } from './versionGuard'

export type ApiObject = Record<string, unknown>

const enc = (value: string | number): string => encodeURIComponent(String(value))

export function projectPath(projectId: string, suffix: string): string {
    return `/api/projects/${enc(projectId)}/${suffix}`
}

/** Accepts a numeric insight id or a short_id and returns the numeric id. */
export async function resolveInsightId(context: Context, projectId: string, id: string | number): Promise<number> {
    if (typeof id === 'number') {
        return id
    }
    const trimmed = id.trim()
    if (/^\d+$/.test(trimmed)) {
        return Number(trimmed)
    }
    const page = await context.api.request<{ results?: { id: number; short_id?: string }[] }>({
        method: 'GET',
        path: projectPath(projectId, 'insights/'),
        query: { short_id: trimmed, limit: 1 },
    })
    const match = page.results?.find((row) => row.short_id === trimmed)
    if (!match) {
        throw new PostHogApiError({
            status: 404,
            statusText: 'Not Found',
            body: '',
            url: '',
            method: 'GET',
            message: `No insight with short_id "${trimmed}" in this project.`,
        })
    }
    return match.id
}

export function insightResource(context: Context, projectId: string, id: number): VersionedResource<ApiObject> {
    const path = projectPath(projectId, `insights/${enc(id)}/`)
    return {
        kind: 'insight',
        id,
        lockKey: `insight:${projectId}:${id}`,
        markerFields: ['updated_at', 'last_modified_at'],
        agentVersion: (insight) => (insight.updated_at as string | undefined) ?? null,
        read: () => context.api.request<ApiObject>({ method: 'GET', path }),
        write: (body) => context.api.request<ApiObject>({ method: 'PATCH', path, body }),
    }
}

export function featureFlagResource(context: Context, projectId: string, id: number): VersionedResource<ApiObject> {
    const path = projectPath(projectId, `feature_flags/${enc(id)}/`)
    const counter = (flag: ApiObject): number | undefined =>
        typeof flag.version === 'number' ? flag.version : undefined
    return {
        kind: 'feature flag',
        id,
        lockKey: `feature_flag:${projectId}:${id}`,
        markerFields: ['version', 'updated_at'],
        agentVersion: (flag) => counter(flag) ?? null,
        read: () => context.api.request<ApiObject>({ method: 'GET', path }),
        // The API's own precondition: a flag whose filters.version is 2 refuses a stale version with 409.
        write: (body, base) =>
            context.api.request<ApiObject>({
                method: 'PATCH',
                path,
                body: counter(base) !== undefined ? { ...body, version: counter(base) } : body,
            }),
        expectedCounterAfterWrite: (base) => (counter(base) !== undefined ? counter(base)! + 1 : undefined),
        counter,
    }
}

/** A survey exposes no version marker, so its version is a short hash of its questions. */
export function surveyQuestionsVersion(survey: ApiObject): string {
    let hash = 0x811c9dc5
    const text = canonicalJson(survey.questions ?? null)
    for (let i = 0; i < text.length; i++) {
        hash ^= text.charCodeAt(i)
        hash = Math.imul(hash, 0x01000193) >>> 0
    }
    return `q-${hash.toString(16).padStart(8, '0')}`
}

export function surveyResource(context: Context, projectId: string, id: string): VersionedResource<ApiObject> {
    const path = projectPath(projectId, `surveys/${enc(id)}/`)
    return {
        kind: 'survey',
        id,
        lockKey: `survey:${projectId}:${id}`,
        markerFields: ['updated_at'],
        agentVersion: surveyQuestionsVersion,
        read: () => context.api.request<ApiObject>({ method: 'GET', path }),
        write: (body) => context.api.request<ApiObject>({ method: 'PATCH', path, body }),
    }
}

/** A small public link for receipts, built the same way withPostHogUrl builds it. */
export async function appUrl(context: Context, path: string): Promise<string> {
    const projectId = await context.stateManager.getProjectId()
    return `${context.api.getProjectBaseUrl(projectId)}${path}`
}
