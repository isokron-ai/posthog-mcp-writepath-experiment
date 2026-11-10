/**
 * Errors for the atomic-write and batch tools.
 *
 * Both classes extend PostHogApiError so handleToolError returns their message to the agent as is.
 * A 4xx status keeps them out of exception capture: a conflict or a refused write is an expected
 * outcome the agent recovers from, not a server bug.
 */
import { PostHogApiError, PostHogValidationError } from '@/lib/errors'

/**
 * The object changed between the read and the write, so nothing was written. The agent should
 * read the object again and retry against the new version.
 */
export class WriteConflictError extends PostHogApiError {
    constructor(
        message: string,
        public readonly details: { kind: string; id: string | number; before?: unknown; now?: unknown }
    ) {
        super({
            status: 409,
            statusText: 'Conflict',
            body: '',
            url: '',
            method: 'PATCH',
            message,
        })
        this.name = 'WriteConflictError'
    }
}

/**
 * A multi-step write failed part-way. The message says which step failed, what was rolled back,
 * and anything left behind. The status is the failed step's own status (500 when it had none).
 */
export class AtomicWriteError extends PostHogApiError {
    constructor(message: string, cause: unknown) {
        super({
            status: errorStatus(cause) ?? 500,
            statusText: 'Atomic write failed',
            body: '',
            url: '',
            method: 'POST',
            message,
        })
        this.name = 'AtomicWriteError'
    }
}

export function errorStatus(error: unknown): number | undefined {
    if (error instanceof PostHogApiError) {
        return error.status
    }
    if (error instanceof PostHogValidationError) {
        return 400
    }
    return undefined
}

/** One line for a per-item result or a rollback report. */
export function errorMessage(error: unknown): string {
    const text = error instanceof Error ? error.message : String(error)
    return text.length > 500 ? `${text.slice(0, 500)}…` : text
}

/** True when the API said the object does not exist (or is soft-deleted, which reads as 404). */
export function isNotFound(error: unknown): boolean {
    return error instanceof PostHogApiError && error.status === 404
}
