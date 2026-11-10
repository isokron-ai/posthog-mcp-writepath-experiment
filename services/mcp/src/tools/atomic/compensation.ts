/**
 * Compensating rollback for a multi-step write over separate REST calls.
 *
 * The REST API has no transaction that spans a dashboard and its insights, so "atomic" here means:
 * every step that creates or changes something records how to undo it, and when a later step
 * fails, the recorded undos run newest first. Each undo is attempted even if an earlier one fails,
 * and the report lists what was undone and what could not be, so the agent can tell the user
 * exactly what, if anything, was left behind.
 *
 * Undo is the API's own delete, which for dashboards and insights is a soft delete. Between the
 * first write and the rollback, other readers can see the partial result.
 */
import { errorMessage } from './errors'

export interface UndoStep {
    /** What the step created or changed, e.g. `insight 94`. */
    target: string
    /** How it is undone, e.g. `soft-deleted`. */
    action: string
    undo: () => Promise<unknown>
}

export interface RollbackEntry {
    target: string
    action: string
    status: 'undone' | 'failed'
    error?: string
}

export interface RollbackReport {
    entries: RollbackEntry[]
    complete: boolean
}

export class CompensationLog {
    private readonly steps: UndoStep[] = []

    record(step: UndoStep): void {
        this.steps.push(step)
    }

    get length(): number {
        return this.steps.length
    }

    /** Runs every recorded undo, newest first. Never throws. */
    async rollback(): Promise<RollbackReport> {
        const entries: RollbackEntry[] = []
        for (const step of [...this.steps].reverse()) {
            try {
                await step.undo()
                entries.push({ target: step.target, action: step.action, status: 'undone' })
            } catch (error) {
                entries.push({ target: step.target, action: step.action, status: 'failed', error: errorMessage(error) })
            }
        }
        this.steps.length = 0
        return { entries, complete: entries.every((entry) => entry.status === 'undone') }
    }
}

/** One paragraph for the agent: what was undone, and what is left with how to remove it. */
export function describeRollback(report: RollbackReport): string {
    if (report.entries.length === 0) {
        return 'Nothing had been written yet, so nothing was rolled back.'
    }
    const undone = report.entries.filter((entry) => entry.status === 'undone')
    const failed = report.entries.filter((entry) => entry.status === 'failed')
    const parts: string[] = []
    if (undone.length > 0) {
        parts.push(`Rolled back: ${undone.map((entry) => `${entry.target} ${entry.action}`).join('; ')}.`)
    }
    if (failed.length > 0) {
        parts.push(
            `ROLLBACK INCOMPLETE, these are left behind and must be removed by hand: ` +
                failed.map((entry) => `${entry.target} (could not be ${entry.action}: ${entry.error})`).join('; ') +
                '.'
        )
    } else {
        parts.push('Nothing from this call remains (rolled-back objects are soft-deleted, as the delete tools do).')
    }
    return parts.join(' ')
}
