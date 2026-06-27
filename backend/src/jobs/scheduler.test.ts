import { describe, expect, it } from 'bun:test'
import {
    readSchedulerConfig,
    runScheduledRefresh,
    startSummaryRefreshScheduler,
    type SchedulerDeps,
} from './scheduler'
import type { RefreshStats } from './refresh-summaries'

const STATS: RefreshStats = { due: 0, regenerated: 0, skippedUnchanged: 0, noReviews: 0, failed: 0 }

const fakeDeps = (over: Partial<SchedulerDeps> = {}) => {
    const calls = {
        acquire: [] as number[],
        runs: 0,
        scheduled: [] as number[],
        cleared: 0,
    }
    const deps: SchedulerDeps = {
        async acquireLock(ttl) {
            calls.acquire.push(ttl)
            return true
        },
        async run() {
            calls.runs++
            return STATS
        },
        setInterval(_fn, ms) {
            calls.scheduled.push(ms)
            return { unref: () => {} }
        },
        clearInterval() {
            calls.cleared++
        },
        ...over,
    }
    return { deps, calls }
}

// ── readSchedulerConfig ──────────────────────────────────────────────────────
describe('readSchedulerConfig', () => {
    it('is disabled (interval 0) when unset, zero, negative, or garbage (edge: safe default)', () => {
        expect(readSchedulerConfig({}).intervalHours).toBe(0)
        expect(readSchedulerConfig({ SUMMARY_REFRESH_INTERVAL_HOURS: '0' }).intervalHours).toBe(0)
        expect(readSchedulerConfig({ SUMMARY_REFRESH_INTERVAL_HOURS: '-3' }).intervalHours).toBe(0)
        expect(readSchedulerConfig({ SUMMARY_REFRESH_INTERVAL_HOURS: 'abc' }).intervalHours).toBe(0)
    })

    it('reads a positive interval and the run-on-boot flag (feature)', () => {
        const cfg = readSchedulerConfig({
            SUMMARY_REFRESH_INTERVAL_HOURS: '24',
            SUMMARY_REFRESH_ON_BOOT: 'true',
        })
        expect(cfg).toEqual({ intervalHours: 24, runOnBoot: true })
    })

    it('run-on-boot is true ONLY for the literal "true" (edge)', () => {
        expect(readSchedulerConfig({ SUMMARY_REFRESH_ON_BOOT: 'yes' }).runOnBoot).toBe(false)
        expect(readSchedulerConfig({}).runOnBoot).toBe(false)
    })
})

// ── runScheduledRefresh (lock-gated) ─────────────────────────────────────────
describe('runScheduledRefresh', () => {
    it('runs the refresh when it acquires the lock (feature)', async () => {
        const { deps, calls } = fakeDeps()
        expect(await runScheduledRefresh(24, deps)).toBe('ran')
        expect(calls.runs).toBe(1)
    })

    it('skips (does NOT run) when another instance holds the lock (feature: single-flight)', async () => {
        const { deps, calls } = fakeDeps({ acquireLock: async () => false })
        expect(await runScheduledRefresh(24, deps)).toBe('skipped')
        expect(calls.runs).toBe(0)
    })

    it('uses a lock TTL just under the interval, floored at 5 min (edge)', async () => {
        const { deps, calls } = fakeDeps()
        await runScheduledRefresh(24, deps) // 24h → 86400 - 60
        expect(calls.acquire[0]).toBe(24 * 3600 - 60)

        const { deps: d2, calls: c2 } = fakeDeps()
        await runScheduledRefresh(0.01, d2) // tiny interval → floored to 300s
        expect(c2.acquire[0]).toBe(300)
    })

    it('returns "failed" (never throws) when the refresh throws (edge: resilience)', async () => {
        const { deps } = fakeDeps({
            async run() {
                throw new Error('refresh boom')
            },
        })
        expect(await runScheduledRefresh(24, deps)).toBe('failed')
    })

    it('returns "failed" when the lock check itself errors (edge: Redis down)', async () => {
        const { deps, calls } = fakeDeps({
            async acquireLock() {
                throw new Error('redis down')
            },
        })
        expect(await runScheduledRefresh(24, deps)).toBe('failed')
        expect(calls.runs).toBe(0) // never attempted the run
    })
})

// ── startSummaryRefreshScheduler ─────────────────────────────────────────────
describe('startSummaryRefreshScheduler', () => {
    it('does nothing and returns null when disabled (edge: off by default)', () => {
        const { deps, calls } = fakeDeps()
        const handle = startSummaryRefreshScheduler({ intervalHours: 0, runOnBoot: false }, deps)
        expect(handle).toBeNull()
        expect(calls.scheduled).toHaveLength(0)
    })

    it('schedules at the configured interval and returns a stop handle (feature)', () => {
        const { deps, calls } = fakeDeps()
        const handle = startSummaryRefreshScheduler({ intervalHours: 6, runOnBoot: false }, deps)
        expect(calls.scheduled).toEqual([6 * 3_600_000]) // ms
        handle?.stop()
        expect(calls.cleared).toBe(1)
    })

    it('runs once immediately when runOnBoot is set (feature: post-deploy freshness)', async () => {
        const { deps, calls } = fakeDeps()
        startSummaryRefreshScheduler({ intervalHours: 6, runOnBoot: true }, deps)
        // The boot run is fire-and-forget; flush the microtask queue.
        await new Promise((r) => setTimeout(r, 0))
        expect(calls.runs).toBe(1)
    })

    it('does NOT run on boot when runOnBoot is false (edge)', async () => {
        const { deps, calls } = fakeDeps()
        startSummaryRefreshScheduler({ intervalHours: 6, runOnBoot: false }, deps)
        await new Promise((r) => setTimeout(r, 0))
        expect(calls.runs).toBe(0)
    })
})
