import { describe, expect, it } from 'bun:test'
import { withTimeout } from './withTimeout'

describe('withTimeout', () => {
    it('resolves with the value when work finishes before the timeout (feature)', async () => {
        const out = await withTimeout(Promise.resolve(42), 1000)
        expect(out).toBe(42)
    })

    it('rejects with the message when work outlives the timeout (regression: no hang)', async () => {
        // A never-settling promise stands in for a Redis command issued while the
        // server is down. withTimeout must reject fast so the caller's fail-open
        // path runs instead of hanging for the whole outage.
        const start = performance.now()
        const hang = new Promise<number>(() => {}) // never settles
        await expect(withTimeout(hang, 50, 'redis timed out')).rejects.toThrow('redis timed out')
        expect(performance.now() - start).toBeLessThan(500)
    })

    it('propagates a rejection that beats the timeout (edge)', async () => {
        await expect(withTimeout(Promise.reject(new Error('boom')), 1000)).rejects.toThrow('boom')
    })

    it('does not throw an unhandled rejection when work rejects after the timeout won (edge)', async () => {
        // The timeout fires first; the underlying promise rejects later. The
        // late rejection must stay handled (no unhandledRejection crash).
        let lateReject: (e: Error) => void = () => {}
        const late = new Promise<number>((_, rej) => {
            lateReject = rej
        })
        await expect(withTimeout(late, 20, 'first')).rejects.toThrow('first')
        lateReject(new Error('late')) // settle after the timeout already won
        await new Promise((r) => setTimeout(r, 10)) // let microtasks flush
        expect(true).toBe(true) // reaching here without an unhandled rejection is the assertion
    })
})
