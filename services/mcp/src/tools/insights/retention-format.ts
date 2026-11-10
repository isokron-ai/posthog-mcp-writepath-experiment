/**
 * Compact text for retention results, in the pipe-table style the backend formatter gives trends
 * and funnels. The backend returns no `formatted_results` for retention, so without this the model
 * read the raw rows: 29 cohorts × 8 cells each carrying a `null` aggregation value and a repeated
 * label, next to a URL-encoded copy of the query and the query itself (3,874 tokens on the friction
 * session, against 303 for trends).
 *
 * Only the text the model reads changes. The structured payload a UI app renders, and the JSON a
 * caller gets with `output_format: "json"`, keep every field.
 */

interface RetentionCell {
    count?: number | null
    aggregation_value?: number | null
    label?: string
}

interface RetentionRow {
    date?: string
    label?: string
    breakdown_value?: unknown
    values?: RetentionCell[]
}

const PERIOD_MS: Record<string, number> = {
    Hour: 60 * 60 * 1000,
    Day: 24 * 60 * 60 * 1000,
    Week: 7 * 24 * 60 * 60 * 1000,
}

function periodStart(cohortDate: Date, period: string, index: number): Date {
    if (period === 'Month') {
        const start = new Date(cohortDate)
        start.setUTCMonth(start.getUTCMonth() + index)
        return start
    }
    return new Date(cohortDate.getTime() + index * (PERIOD_MS[period] ?? PERIOD_MS.Day!))
}

function formatNumber(value: number): string {
    return Number.isInteger(value) ? String(value) : String(Math.round(value * 100) / 100)
}

function formatPercent(part: number, whole: number): string {
    if (whole <= 0) {
        return '-'
    }
    const percent = Math.round((part / whole) * 1000) / 10
    return `${percent}%`
}

function entityName(entity: unknown): string | undefined {
    if (!entity || typeof entity !== 'object') {
        return undefined
    }
    const record = entity as Record<string, unknown>
    const name = record.custom_name ?? record.name ?? record.event ?? record.id
    return name === undefined || name === null ? undefined : String(name)
}

function formatCohortDate(date: string | undefined, period: string): string {
    if (!date) {
        return '-'
    }
    return period === 'Hour' ? date.replace(/:00(\.000)?Z$/, 'Z').replace('T', ' ') : date.slice(0, 10)
}

function isRetentionRows(results: unknown): results is RetentionRow[] {
    return (
        Array.isArray(results) &&
        results.length > 0 &&
        results.every((row) => row !== null && typeof row === 'object' && Array.isArray((row as RetentionRow).values))
    )
}

/**
 * Renders retention rows as one line per cohort: its start, its size, then the count returning in
 * each later period. A period that has not started yet is left blank rather than shown as 0, and one
 * still in progress is marked `*`. A last `Retained` line gives each period's share over the cohorts
 * that completed it, the weighted mean PostHog shows under its retention table. Returns undefined
 * for anything that is not a list of retention rows, so the caller falls back to the default encoding.
 */
export function formatRetentionResults(
    results: unknown,
    query: Record<string, unknown> | undefined,
    now: Date = new Date()
): string | undefined {
    if (!isRetentionRows(results)) {
        return undefined
    }
    const filter = (query?.retentionFilter ?? {}) as Record<string, unknown>
    const period = typeof filter.period === 'string' ? filter.period : 'Day'
    const unit = period.toLowerCase()
    const cellsPerRow = Math.max(...results.map((row) => row.values!.length))
    const usesAggregation = results.some((row) =>
        row.values!.some((cell) => cell.aggregation_value !== null && cell.aggregation_value !== undefined)
    )
    const hasBreakdown = results.some((row) => row.breakdown_value !== null && row.breakdown_value !== undefined)
    const showMean = !usesAggregation && !hasBreakdown

    const header = [
        ...(hasBreakdown ? ['Breakdown'] : []),
        'Cohort',
        usesAggregation ? 'Value' : 'Size',
        ...Array.from({ length: cellsPerRow - 1 }, (_, index) => `${period} ${index + 1}`),
    ]
    const returned = new Array<number>(cellsPerRow).fill(0)
    const eligible = new Array<number>(cellsPerRow).fill(0)
    let sawFuture = false
    let sawPartial = false
    const lines = results.map((row) => {
        const cells = row.values!
        const value = (cell: RetentionCell | undefined): number =>
            Number((usesAggregation ? cell?.aggregation_value : cell?.count) ?? 0)
        const size = value(cells[0])
        const cohortDate = row.date ? new Date(row.date) : undefined
        const dated = !!cohortDate && !Number.isNaN(cohortDate.getTime())
        const later = Array.from({ length: cellsPerRow - 1 }, (_, offset) => {
            const index = offset + 1
            if (dated && periodStart(cohortDate!, period, index) > now) {
                sawFuture = true
                return ''
            }
            const cell = cells[index]
            if (!cell) {
                return ''
            }
            const amount = value(cell)
            if (dated && periodStart(cohortDate!, period, index + 1) > now) {
                sawPartial = true
                return `${formatNumber(amount)}*`
            }
            returned[index] = returned[index]! + amount
            eligible[index] = eligible[index]! + size
            return formatNumber(amount)
        })
        return [
            ...(hasBreakdown ? [String(row.breakdown_value ?? '-')] : []),
            formatCohortDate(row.date, period),
            formatNumber(size),
            ...later,
        ].join('|')
    })
    if (showMean) {
        const total = results.reduce((sum, row) => sum + Number(row.values![0]?.count ?? 0), 0)
        const shares = Array.from({ length: cellsPerRow - 1 }, (_, offset) =>
            eligible[offset + 1]! > 0 ? formatPercent(returned[offset + 1]!, eligible[offset + 1]!) : ''
        )
        lines.push(['Retained', formatNumber(total), ...shares].join('|'))
    }

    const target = entityName(filter.targetEntity)
    const returning = entityName(filter.returningEntity)
    const dateRange = (query?.dateRange ?? {}) as Record<string, unknown>
    const summary = [
        target ? `Cohorts: first ${target}` : undefined,
        returning ? `returning: ${returning}` : undefined,
        `period: ${period}`,
        typeof dateRange.date_from === 'string' ? `from ${dateRange.date_from}` : undefined,
        usesAggregation && typeof filter.aggregationType === 'string'
            ? `values are the ${filter.aggregationType}${typeof filter.aggregationProperty === 'string' ? ` of ${filter.aggregationProperty}` : ''}`
            : undefined,
    ].filter((part): part is string => !!part)

    const notes = [
        showMean
            ? `Cells count the people who returned in that ${unit}. Retained is the share of people, over the cohorts that completed that ${unit}.`
            : undefined,
        sawPartial ? `* marks a ${unit} still in progress.` : undefined,
        sawFuture ? `Blank: not started yet.` : undefined,
    ].filter((part): part is string => !!part)

    return [summary.join(', '), '', header.join('|'), ...lines, ...(notes.length ? ['', notes.join(' ')] : [])].join(
        '\n'
    )
}
