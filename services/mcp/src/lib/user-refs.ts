/**
 * Keys under which PostHog serializers embed the acting user as a full `UserBasic` object (id,
 * uuid, distinct_id, first and last name, email, verification flag, hedgehog config, role).
 */
export const USER_REF_KEYS = new Set(['created_by', 'last_modified_by', 'updated_by'])

const USER_BASIC_MARKERS = ['uuid', 'distinct_id', 'email', 'first_name'] as const

function isUserBasic(value: unknown): value is Record<string, unknown> {
    if (value === null || typeof value !== 'object' || Array.isArray(value)) {
        return false
    }
    const record = value as Record<string, unknown>
    return 'id' in record && USER_BASIC_MARKERS.some((key) => key in record)
}

/** `{id, name}` for a `UserBasic`, the name being the person's full name, or their email without one. */
export function shrinkUserRef(user: Record<string, unknown>): { id: unknown; name: string } {
    const fullName = [user.first_name, user.last_name]
        .filter((part): part is string => typeof part === 'string' && part.trim() !== '')
        .join(' ')
        .trim()
    const email = typeof user.email === 'string' ? user.email : ''
    return { id: user.id, name: fullName || email }
}

/**
 * Replaces every embedded creator or modifier with `{id, name}`, at any depth. Over the friction
 * session these objects were 18,226 of the 61,363 tokens write echoes returned, and no task read
 * more of them than who the person was. The input is not modified.
 *
 * Applied to the model-facing text only: JSON output and the structured payload UI apps read keep
 * the full objects.
 */
export function trimUserRefs<T>(value: T): T {
    return trim(value) as T
}

function trim(value: unknown): unknown {
    if (Array.isArray(value)) {
        return value.map(trim)
    }
    if (value === null || typeof value !== 'object') {
        return value
    }
    const result: Record<string, unknown> = {}
    for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
        result[key] = USER_REF_KEYS.has(key) && isUserBasic(item) ? shrinkUserRef(item) : trim(item)
    }
    return result
}
