/** The runtime `Tool` and the catalog's `ScopeGatedTool` both satisfy this shape. */
export interface SearchableTool {
    name: string
    title: string
    description: string
    searchKeywords?: readonly string[]
}

const SEARCH_FIELD_WEIGHT = { name: 3, title: 2, keywords: 2, description: 1 } as const
export type SearchField = keyof typeof SEARCH_FIELD_WEIGHT

/** A token counts once, at its highest-weight field, so a name hit does not
 *  also score for a description mention. */
const ORDERED_FIELDS: readonly SearchField[] = ['name', 'title', 'keywords', 'description']

export interface RankedToolMatch {
    name: string
    tokensMatched: number
    score: number
    fields: SearchField[]
}

/** Regex metacharacters that mark a pattern as a deliberate regex rather than
 *  plain words. A pattern containing any of these routes to `searchToolsRegex`
 *  (preserving power-user patterns like `query-` or `feature-flag`); everything
 *  else routes to `searchToolsRanked`. */
const REGEX_METACHARACTER = /[-|()[\]\\.*+^$?]/

export function isRegexPattern(pattern: string): boolean {
    return REGEX_METACHARACTER.test(pattern)
}

/** The `exec search` predicate for regex patterns, ordered by the field that matched so a name
 *  hit comes before a description mention, the way `searchToolsRanked` already orders words.
 *  Ties keep catalog order. Throws if the pattern is not a valid regex, so callers surface their
 *  own error message. */
export function searchToolsRegex<T extends SearchableTool>(tools: readonly T[], pattern: string): T[] {
    const regex = new RegExp(pattern, 'i')
    const matched: { tool: T; rank: number }[] = []
    for (const tool of tools) {
        const rank = ORDERED_FIELDS.findIndex((field) =>
            field === 'keywords'
                ? (tool.searchKeywords ?? []).some((keyword) => regex.test(keyword))
                : regex.test(tool[field])
        )
        if (rank !== -1) {
            matched.push({ tool, rank })
        }
    }
    return matched.sort((a, b) => a.rank - b.rank).map((m) => m.tool)
}

/**
 * Verbs a tool name opens or closes with. The catalog mixes both orders
 * (`create-feature-flag` beside `experiment-create`), so an agent that learned one
 * pattern guesses the other.
 */
const NAME_VERBS = new Set([
    'create',
    'update',
    'delete',
    'get',
    'list',
    'retrieve',
    'destroy',
    'archive',
    'unarchive',
    'enable',
    'disable',
    'restore',
])

/** Verbs that name the same operation, either way round. `get-all` is how the
 *  older tools spell a list. */
const VERB_SYNONYMS: ReadonlyArray<readonly [string, string]> = [
    ['get-all', 'list'],
    ['get', 'retrieve'],
    ['delete', 'destroy'],
]

/** The same name with its verb moved to the other end: `create-feature-flag` and
 *  `feature-flag-create`. `get-all` moves as one verb. */
function reorderedNames(name: string): string[] {
    const tokens = name.split('-')
    if (tokens.length < 2) {
        return []
    }
    const out: string[] = []
    if (name.endsWith('-get-all') && tokens.length > 3) {
        out.push(`get-all-${tokens.slice(0, -2).join('-')}`)
    }
    if (name.startsWith('get-all-') && tokens.length > 3) {
        out.push(`${tokens.slice(2).join('-')}-get-all`)
    }
    const first = tokens[0]!
    const last = tokens[tokens.length - 1]!
    if (NAME_VERBS.has(first)) {
        out.push(`${tokens.slice(1).join('-')}-${first}`)
    }
    if (NAME_VERBS.has(last)) {
        out.push(`${last}-${tokens.slice(0, -1).join('-')}`)
    }
    return out
}

/** The same name with one verb swapped for a synonym. */
function synonymNames(name: string): string[] {
    const out: string[] = []
    for (const [a, b] of VERB_SYNONYMS) {
        for (const [from, to] of [
            [a, b],
            [b, a],
        ] as const) {
            if (name.endsWith(`-${from}`)) {
                out.push(`${name.slice(0, -from.length)}${to}`)
            }
            if (name.startsWith(`${from}-`)) {
                out.push(`${to}${name.slice(from.length)}`)
            }
        }
    }
    return out
}

/** The same name with one non-verb word switched between singular and plural:
 *  `actions-get-all` and `action-get-all`. */
function numberVariants(name: string): string[] {
    const tokens = name.split('-')
    const out: string[] = []
    tokens.forEach((token, index) => {
        if (NAME_VERBS.has(token) || token === 'all' || token.length < 3) {
            return
        }
        const switched = token.endsWith('s') ? token.slice(0, -1) : `${token}s`
        out.push([...tokens.slice(0, index), switched, ...tokens.slice(index + 1)].join('-'))
    })
    return out
}

/** Every alternate spelling an agent plausibly guesses for `name`, at most one
 *  reordering, one synonym and one singular/plural switch away. */
function alternateNames(name: string): Set<string> {
    const found = new Set<string>()
    const unordered = [name, ...synonymNames(name)]
    const shapes = new Set(unordered)
    // One reordering of each spelling; reordering twice only gives a spelling back.
    for (const shape of unordered) {
        for (const reordered of reorderedNames(shape)) {
            shapes.add(reordered)
        }
    }
    for (const shape of shapes) {
        found.add(shape)
        for (const variant of numberVariants(shape)) {
            found.add(variant)
        }
    }
    found.delete(name)
    return found
}

const aliasMapCache = new WeakMap<readonly unknown[], ReadonlyMap<string, string>>()

/**
 * Maps the names agents guess onto the real tool names, generated from the catalog
 * itself so it never goes stale: `feature-flag-create` → `create-feature-flag`,
 * `action-get-all` → `actions-get-all`, `action-list` → `actions-get-all`.
 *
 * Nothing is renamed. A real name always wins over an alias, and a spelling two tools
 * could answer to is left out, so an alias never guesses between tools.
 */
export function buildToolAliasMap(names: readonly string[]): ReadonlyMap<string, string> {
    const real = new Set(names)
    const aliases = new Map<string, string>()
    const ambiguous = new Set<string>()
    for (const name of names) {
        for (const alias of alternateNames(name)) {
            if (real.has(alias) || ambiguous.has(alias)) {
                continue
            }
            const existing = aliases.get(alias)
            if (existing !== undefined && existing !== name) {
                aliases.delete(alias)
                ambiguous.add(alias)
                continue
            }
            aliases.set(alias, name)
        }
    }
    return aliases
}

/** The real tool name an alias stands for, or undefined. Cached per tool list. */
export function resolveToolAlias(tools: readonly { name: string }[], name: string): string | undefined {
    let map = aliasMapCache.get(tools)
    if (!map) {
        map = buildToolAliasMap(tools.map((tool) => tool.name))
        aliasMapCache.set(tools, map)
    }
    return map.get(name)
}

/** Lowercase words of a tool name, with plurals and verb synonyms folded together. */
function nameTokens(name: string): Set<string> {
    const folded = name.toLowerCase().replace(/get-all/g, 'list')
    return new Set(
        folded
            .split(/[^a-z0-9]+/)
            .filter(Boolean)
            .map((token) => (token === 'retrieve' ? 'get' : token === 'destroy' ? 'delete' : token))
            .map((token) => (token.length > 3 && token.endsWith('s') ? token.slice(0, -1) : token))
    )
}

/** How much a one-edit typo of a word counts toward a name match, against 1 for the word itself. */
const NEAR_TOKEN_CREDIT = 0.75

/** True when two words of three or more letters differ by one insertion, deletion or substitution. */
function isOneEditApart(a: string, b: string): boolean {
    if (a === b || a.length < 3 || b.length < 3 || Math.abs(a.length - b.length) > 1) {
        return false
    }
    let i = 0
    let j = 0
    let edits = 0
    while (i < a.length && j < b.length) {
        if (a[i] === b[j]) {
            i += 1
            j += 1
            continue
        }
        edits += 1
        if (edits > 1) {
            return false
        }
        if (a.length > b.length) {
            i += 1
        } else if (b.length > a.length) {
            j += 1
        } else {
            i += 1
            j += 1
        }
    }
    return edits + (a.length - i) + (b.length - j) <= 1
}

/**
 * The real names closest to an unknown one, by the words they share (Jaccard over name
 * tokens, plural and verb-synonym insensitive). Lets the unknown-tool error name the
 * tool the agent meant instead of sending it to a `search` first.
 */
export function closestToolNames(name: string, names: readonly string[], limit = 3): string[] {
    const wanted = nameTokens(name)
    if (wanted.size === 0) {
        return []
    }
    const scored: { name: string; score: number; lengthGap: number }[] = []
    for (const candidate of names) {
        const tokens = nameTokens(candidate)
        let shared = 0
        for (const token of tokens) {
            if (wanted.has(token)) {
                shared += 1
            } else if ([...wanted].some((word) => isOneEditApart(word, token))) {
                // A typo (`lst` for `list`) still points at the word it misspells.
                shared += NEAR_TOKEN_CREDIT
            }
        }
        if (shared === 0) {
            continue
        }
        const score = shared / (wanted.size + tokens.size - shared)
        scored.push({ name: candidate, score, lengthGap: Math.abs(candidate.length - name.length) })
    }
    scored.sort((a, b) => b.score - a.score || a.lengthGap - b.lengthGap || a.name.localeCompare(b.name))
    return scored.slice(0, limit).map((entry) => entry.name)
}

/** Multi-word queries like "create dashboard insight" match nothing as a single
 *  regex, so rank tools by the query tokens they contain instead. */
export function searchToolsRanked<T extends SearchableTool>(tools: readonly T[], query: string): RankedToolMatch[] {
    const tokens = [...new Set(query.toLowerCase().split(/\s+/).filter(Boolean))]
    if (tokens.length === 0) {
        return []
    }
    const scored: RankedToolMatch[] = []
    for (const t of tools) {
        const haystack: Record<SearchField, string> = {
            name: t.name.toLowerCase(),
            title: t.title.toLowerCase(),
            keywords: (t.searchKeywords ?? []).join(' ').toLowerCase(),
            description: t.description.toLowerCase(),
        }
        let tokensMatched = 0
        let score = 0
        const fields = new Set<SearchField>()
        for (const token of tokens) {
            const field = ORDERED_FIELDS.find((f) => haystack[f].includes(token))
            if (field) {
                tokensMatched += 1
                score += SEARCH_FIELD_WEIGHT[field]
                fields.add(field)
            }
        }
        if (tokensMatched > 0) {
            scored.push({ name: t.name, tokensMatched, score, fields: [...fields] })
        }
    }
    // Name is the last key so equal matches keep a stable order.
    scored.sort((a, b) => b.score - a.score || b.tokensMatched - a.tokensMatched || a.name.localeCompare(b.name))
    return scored
}
