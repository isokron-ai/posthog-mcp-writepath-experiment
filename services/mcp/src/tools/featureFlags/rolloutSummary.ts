/**
 * A one-line summary of a flag's release conditions and variants, for list rows. "List flags with
 * their rollout" took 4 calls and 11,229 tokens on the friction session: the list rows carried no
 * rollout, `system.feature_flags` keeps it inside `filters.groups`, and the status tool is one call
 * per flag. The list response has `filters`, so the MCP server summarizes it per row instead.
 */

interface PropertyFilter {
    key?: unknown
    type?: unknown
    operator?: unknown
    value?: unknown
}

interface ReleaseCondition {
    properties?: PropertyFilter[] | null
    rollout_percentage?: number | null
    variant?: string | null
}

interface FlagFilters {
    groups?: ReleaseCondition[] | null
    multivariate?: { variants?: { key?: string; rollout_percentage?: number | null }[] | null } | null
    aggregation_group_type_index?: number | null
}

const OPERATOR_TEXT: Record<string, string> = {
    exact: '=',
    is_not: '≠',
    icontains: 'contains',
    not_icontains: 'does not contain',
    regex: 'matches',
    not_regex: 'does not match',
    gt: '>',
    gte: '≥',
    lt: '<',
    lte: '≤',
    is_date_before: 'before',
    is_date_after: 'after',
    in: 'in',
    not_in: 'not in',
}

/** At most this many property filters are spelled out per condition; the rest are counted. */
const MAX_PROPERTIES_SHOWN = 2

function describeValue(value: unknown): string {
    if (Array.isArray(value)) {
        return value.length > 3
            ? `${value.slice(0, 3).map(String).join(', ')} +${value.length - 3}`
            : value.map(String).join(', ')
    }
    return String(value)
}

function describeProperty(property: PropertyFilter): string {
    const key = String(property.key ?? '?')
    const operator = typeof property.operator === 'string' ? property.operator : 'exact'
    if (property.type === 'cohort') {
        return `${operator === 'not_in' ? 'not in' : 'in'} cohort ${describeValue(property.value)}`
    }
    if (property.type === 'flag') {
        return `flag ${key} = ${describeValue(property.value)}`
    }
    if (operator === 'is_set') {
        return `${key} is set`
    }
    if (operator === 'is_not_set') {
        return `${key} is not set`
    }
    return `${key} ${OPERATOR_TEXT[operator] ?? operator} ${describeValue(property.value)}`
}

function describeCondition(condition: ReleaseCondition): string {
    const percent = condition.rollout_percentage ?? 100
    const properties = condition.properties ?? []
    const shown = properties.slice(0, MAX_PROPERTIES_SHOWN).map(describeProperty)
    const more = properties.length > MAX_PROPERTIES_SHOWN ? ` +${properties.length - MAX_PROPERTIES_SHOWN} more` : ''
    const audience = shown.length > 0 ? `where ${shown.join(' and ')}${more}` : 'of everyone'
    const variant = condition.variant ? ` → ${condition.variant}` : ''
    return `${percent}% ${audience}${variant}`
}

/**
 * For example `75% where $browser = Chrome; 100% where plan = pro | variants: control 50%, test 50%`.
 * A flag with no release conditions reads `no release conditions` (it matches no one).
 */
export function summarizeRollout(filters: unknown): string {
    if (!filters || typeof filters !== 'object') {
        return 'unknown'
    }
    const { groups, multivariate, aggregation_group_type_index } = filters as FlagFilters
    const conditions = (groups ?? []).map(describeCondition)
    const parts = [conditions.length > 0 ? conditions.join('; ') : 'no release conditions']
    const variants = multivariate?.variants ?? []
    if (variants.length > 0) {
        parts.push(`variants: ${variants.map((v) => `${v.key} ${v.rollout_percentage ?? 0}%`).join(', ')}`)
    }
    if (aggregation_group_type_index !== null && aggregation_group_type_index !== undefined) {
        parts.push(`by group type ${aggregation_group_type_index}`)
    }
    return parts.join(' | ')
}

/**
 * Replaces each row's `filters` with its `rollout` summary, keeping the row's other fields. A row
 * without `filters` is left as it is.
 */
export function withRolloutSummaries<T>(result: T): T {
    if (!result || typeof result !== 'object' || !Array.isArray((result as { results?: unknown }).results)) {
        return result
    }
    const page = result as T & { results: Record<string, unknown>[] }
    return {
        ...page,
        results: page.results.map((row) => {
            if (!row || typeof row !== 'object' || !('filters' in row)) {
                return row
            }
            const { filters, _posthogUrl, ...rest } = row
            return {
                ...rest,
                rollout: summarizeRollout(filters),
                ...(_posthogUrl !== undefined ? { _posthogUrl } : {}),
            }
        }),
    }
}
