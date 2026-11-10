/**
 * Concurrency primitives for the atomic-write and batch tools.
 *
 * - `KeyedMutex` serializes work on one key (one object) inside this server process. Two partial
 *   updates of the same insight sent through this process therefore run one after the other, and
 *   the second reads the first one's result. It does not reach other processes or the PostHog UI;
 *   the version check in versionGuard.ts covers those.
 * - `mapWithConcurrency` fans work out with a fixed number of requests in flight, so a batch does
 *   not burst the API. Rate limiting itself stays with ApiClient, which retries a 429 after the
 *   API's Retry-After.
 */

export class KeyedMutex {
    private readonly tails = new Map<string, Promise<void>>()

    /** Runs `task` once every earlier task on `key` has settled. Different keys run in parallel. */
    async runExclusive<T>(key: string, task: () => Promise<T>): Promise<T> {
        const previous = this.tails.get(key) ?? Promise.resolve()
        let release!: () => void
        const current = new Promise<void>((resolve) => {
            release = resolve
        })
        const tail = previous.then(() => current)
        this.tails.set(key, tail)
        await previous
        try {
            return await task()
        } finally {
            release()
            // Drop the entry once nothing is queued behind this task, so the map does not grow.
            if (this.tails.get(key) === tail) {
                this.tails.delete(key)
            }
        }
    }

    /** Number of keys with a task running or queued. For tests. */
    get size(): number {
        return this.tails.size
    }
}

/** One mutex per server process, shared by every tool that does a read-merge-write. */
export const objectLocks = new KeyedMutex()

/**
 * Maps `items` through `worker` with at most `limit` calls in flight, keeping input order in the
 * output. `shouldStop` is checked before each new item starts; once it returns true, the remaining
 * items are not started and come back as `undefined`.
 */
export async function mapWithConcurrency<T, R>(
    items: readonly T[],
    limit: number,
    worker: (item: T, index: number) => Promise<R>,
    shouldStop: () => boolean = () => false
): Promise<(R | undefined)[]> {
    const results: (R | undefined)[] = new Array(items.length).fill(undefined)
    let next = 0
    const lanes = Array.from({ length: Math.max(1, Math.min(limit, items.length)) }, async () => {
        while (next < items.length && !shouldStop()) {
            const index = next++
            results[index] = await worker(items[index]!, index)
        }
    })
    await Promise.all(lanes)
    return results
}
