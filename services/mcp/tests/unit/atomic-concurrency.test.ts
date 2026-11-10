import { describe, expect, it } from 'vitest'

import { KeyedMutex, mapWithConcurrency } from '@/tools/atomic/concurrency'

describe('KeyedMutex and mapWithConcurrency', () => {
    it('serializes one key, runs different keys in parallel, and cleans up', async () => {
        const mutex = new KeyedMutex()
        const order: string[] = []
        const task = (label: string, ms: number) => async () => {
            order.push(`${label}:start`)
            await new Promise((resolve) => setTimeout(resolve, ms))
            order.push(`${label}:end`)
        }
        await Promise.all([
            mutex.runExclusive('a', task('a1', 5)),
            mutex.runExclusive('a', task('a2', 1)),
            mutex.runExclusive('b', task('b1', 1)),
        ])
        expect(order.indexOf('a1:end')).toBeLessThan(order.indexOf('a2:start'))
        expect(order.indexOf('b1:start')).toBeLessThan(order.indexOf('a1:end'))
        expect(mutex.size).toBe(0)
    })

    it('releases the lock when a task throws', async () => {
        const mutex = new KeyedMutex()
        await expect(mutex.runExclusive('a', async () => Promise.reject(new Error('boom')))).rejects.toThrow('boom')
        await expect(mutex.runExclusive('a', async () => 'ok')).resolves.toBe('ok')
    })

    it('keeps order, bounds concurrency and stops starting work on request', async () => {
        let inFlight = 0
        let peak = 0
        const results = await mapWithConcurrency([1, 2, 3, 4, 5, 6, 7, 8], 3, async (n) => {
            inFlight++
            peak = Math.max(peak, inFlight)
            await new Promise((resolve) => setTimeout(resolve, 2))
            inFlight--
            return n * 2
        })
        expect(results).toEqual([2, 4, 6, 8, 10, 12, 14, 16])
        expect(peak).toBe(3)

        let stop = false
        const partial = await mapWithConcurrency(
            [1, 2, 3, 4],
            1,
            async (n) => {
                if (n === 2) {
                    stop = true
                }
                return n
            },
            () => stop
        )
        expect(partial).toEqual([1, 2, undefined, undefined])
    })
})
