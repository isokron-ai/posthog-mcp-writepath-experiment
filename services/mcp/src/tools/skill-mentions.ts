/**
 * Tool descriptions and `_agentNote`s tell the agent to load a named PostHog skill
 * ("Load the building-a-dashboard skill before you create or change a dashboard").
 * When this connection has no `learn` command there is no way to load one, so an agent
 * that follows the text stalls or guesses. These rewrites drop the skill step and keep
 * whatever else the sentence asked for.
 *
 * Only a kebab-case skill name followed by "skill" counts, so prose about the agent
 * skills store (`skill-get`, "a custom scout skill") is left alone.
 */

/** A skill named the way the catalog names them: `building-a-dashboard skill`. */
const SKILL = String.raw`\x60?(?!built-in\b)(?<![\w-])[a-z0-9]+(?:-[a-z0-9]+)+\x60?\s+skills?\b`
const SKILL_MENTION = new RegExp(SKILL)

/** A sentence that only says what the skill just dropped covers ("It covers when to …"). */
const SKILL_FOLLOW_UP = /^\s*(?:It|This skill|The skill)\s+(?:covers|explains|describes|carries|has)\b/

/** Clause rewrites, tried before whole sentences are dropped. Whitespace is `\s+`
 *  because the RULES blocks wrap mid-sentence. */
const CLAUSE_REWRITES: ReadonlyArray<readonly [RegExp, string | ((...groups: string[]) => string)]> = [
    // "(the investigate-metric skill describes how)": an aside about the skill.
    [new RegExp(String.raw`\s*\((?:see\s+)?the\s+${SKILL}[^)]*\)`, 'g'), ''],
    // "(design JSON for PostHog's visual email editor — schema in the designing-email-templates skill)"
    // "references — load the finding-experiments skill for guidance on …": the whole aside goes.
    [new RegExp(String.raw`\s+[—–]\s+[^.;()—–]*?${SKILL}[^.;()]*`, 'g'), ''],
    // "…until status is Completed, then follow the downloading-batch-export-files skill to …"
    [new RegExp(String.raw`,\s+then\s+(?:follow|load|read|use)\s+the\s+${SKILL}[^.]*`, 'gi'), ''],
    // "use the `authoring-error-tracking-alerts` skill (or the `error-tracking-alerts-create` tool)"
    [
        new RegExp(String.raw`\buse\s+the\s+${SKILL}\s+\(or\s+the\s+(\S+)\s+tool\)`, 'gi'),
        (_m, tool) => `use the ${tool} tool`,
    ],
    // "Load the configuring-experiment-analytics skill before constructing the query, and use read-data-schema …"
    [
        new RegExp(String.raw`\b(?:load|read|use)\s+the\s+${SKILL}[^.,]*,\s+and\s+(\w)`, 'gi'),
        (_m, first) => first!.toUpperCase(),
    ],
    // "…(e.g. "25%"), load the configuring-experiment-rollout skill and ask the user…"
    [new RegExp(String.raw`\b(?:load|read|use)\s+the\s+${SKILL}\s+and\s+`, 'gi'), ''],
    // "If you don't have the ID, load the finding-experiments skill to resolve the user's reference first."
    [new RegExp(String.raw`(,\s+)load\s+the\s+${SKILL}\s+to\s+`, 'gi'), '$1'],
    // "If adding or changing metrics, load the configuring-experiment-analytics skill first. Call …"
    [new RegExp(String.raw`[^.\n]*?,\s+load\s+the\s+${SKILL}\s+first\.\s*`, 'g'), ''],
]

/** Splits text into sentences, keeping each one's trailing whitespace so the text
 *  reassembles exactly. "e.g." does not end a sentence. */
function sentences(text: string): string[] {
    const parts: string[] = []
    const boundary = /(?<!\be\.g|\bi\.e)[.!?](?=\s|$)\s*|\n[ \t]*\n\s*/g
    let start = 0
    for (let match = boundary.exec(text); match; match = boundary.exec(text)) {
        const end = match.index + match[0].length
        parts.push(text.slice(start, end))
        start = end
    }
    if (start < text.length) {
        parts.push(text.slice(start))
    }
    return parts
}

/** Renumbers a `1.` `2.` … list after an item was removed, and drops an item left empty. */
function renumberLists(text: string): string {
    const lines = text.split('\n')
    let next = 1
    let inList = false
    const out: string[] = []
    for (const line of lines) {
        const item = /^(\d+)\.(\s*)(.*)$/.exec(line)
        if (item) {
            if (!item[3]!.trim()) {
                continue
            }
            if (!inList) {
                next = 1
                inList = true
            }
            out.push(`${next}.${item[2] || ' '}${item[3]}`)
            next += 1
            continue
        }
        // A blank line or an indented continuation keeps the list open; prose closes it.
        if (inList && line.trim() !== '' && !/^\s/.test(line)) {
            inList = false
        }
        out.push(line)
    }
    return out.join('\n')
}

/** Removes the instructions to load a named skill from tool text, for a connection
 *  where skills cannot be loaded. Text that names no skill comes back unchanged. */
export function stripSkillInstructions(text: string): string {
    if (!SKILL_MENTION.test(text)) {
        return text
    }
    let rewritten = text
    for (const [pattern, replacement] of CLAUSE_REWRITES) {
        rewritten = rewritten.replace(pattern, replacement as string)
    }
    // Whatever still names a skill is a sentence about loading it: drop the sentence,
    // and a following one that only describes what the skill covers.
    const kept: string[] = []
    let droppedPrevious = false
    for (const sentence of sentences(rewritten)) {
        if (SKILL_MENTION.test(sentence) || (droppedPrevious && SKILL_FOLLOW_UP.test(sentence))) {
            droppedPrevious = true
            // Keep a paragraph break or line break that ended the dropped sentence.
            const trailing = /\s*$/.exec(sentence)?.[0] ?? ''
            if (trailing.includes('\n')) {
                kept.push(trailing)
            }
            continue
        }
        droppedPrevious = false
        kept.push(sentence)
    }
    rewritten = kept.join('')
    rewritten = renumberLists(rewritten)
    return rewritten
        .replace(/[ \t]+\n/g, '\n')
        .replace(/\n{3,}/g, '\n\n')
        .trim()
}
