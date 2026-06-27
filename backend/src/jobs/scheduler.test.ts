import { describe, expect, it } from 'bun:test'
import {
    clampDelay,
    lockTtlForInterval,
    readSchedulerConfig,
    runLockedRefresh,
    startSummaryRefreshScheduler,
    triggerSummaryRefresh,
    ENDPOINT_LOCK_TTL_SECONDS,
    type SchedulerDeps,
} from './scheduler'
import type { RefreshStats } from './refresh-summaries'

const STATS: RefreshStats = { due: 0, regenerated: 0, skippedUnchanged: 0, noReviews: 0, failed: 0 }
const MAX_TIMEOUT_MS = 2_147_483_647

const fakeDeps = (over: Partial<SchedulerDeps> = {}) => {
    const calls = {
        acquire: [] as number[],
        runs: 0,
        timers: [] as { ms: number; fire: () => void }[],
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
        setTimeout(fn, ms) {
            calls.timers.push({ ms, fire: fn })
            return { unref: () => {} }
        },
        clearTimeout() {
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

// ── pure helpers ─────────────────────────────────────────────────────────────
describe('lockTtlForInterval', () => {
    it('is just under the interval, floored at 5 min (edge: overlap guard)', () => {
        expect(lockTtlForInterval(24)).toBe(24 * 3600 - 60)
        expect(lockTtlForInterval(0.01)).toBe(300) // tiny interval → floor
    })
})

describe('clampDelay', () => {
    it('caps at the 32-bit timer max so long periods do not overflow (edge: the setInterval bug)', () => {
        expect(clampDelay(5_000)).toBe(5_000)
        expect(clampDelay(40 * 24 * 3_600_000)).toBe(MAX_TIMEOUT_MS) // 40 days → capped
        expect(clampDelay(-10)).toBe(0)
    })
})

// ── runLockedRefresh (lock-gated) ────────────────────────────────────────────
describe('runLockedRefresh', () => {
    it('runs and returns stats when it acquires the lock (feature)', async () => {
        const { deps, calls } = fakeDeps()
        const outcome = await runLockedRefresh(deps, 1800)
        expect(outcome).toEqual({ status: 'ran', stats: STATS })
        expect(calls.runs).toBe(1)
        expect(calls.acquire).toEqual([1800])
    })

    it('skips (does NOT run) when another caller holds the lock (feature: single-flight)', async () => {
        const { deps, calls } = fakeDeps({ acquireLock: async () => false })
        expect(await runLockedRefresh(deps, 1800)).toEqual({ status: 'skipped' })
        expect(calls.runs).toBe(0)
    })

    it('returns failed (never throws) when the refresh throws (edge: resilience)', async () => {
        const { deps } = fakeDeps({
            async run() {
                throw new Error('refresh boom')
            },
        })
        expect(await runLockedRefresh(deps, 1800)).toEqual({
            status: 'failed',
            error: 'refresh boom',
        })
    })

    it('returns failed when the lock check itself errors, without running (edge: Redis down)', async () => {
        const { deps, calls } = fakeDeps({
            async acquireLock() {
                throw new Error('redis down')
            },
        })
        expect(await runLockedRefresh(deps, 1800)).toEqual({
            status: 'failed',
            error: 'redis down',
        })
        expect(calls.runs).toBe(0)
    })
})

describe('triggerSummaryRefresh', () => {
    it('runs through the lock with the endpoint TTL (feature)', async () => {
        const { deps, calls } = fakeDeps()
        const outcome = await triggerSummaryRefresh(deps)
        expect(outcome.status).toBe('ran')
        expect(calls.acquire).toEqual([ENDPOINT_LOCK_TTL_SECONDS])
    })
})

// ── startSummaryRefreshScheduler (in-process timer) ──────────────────────────
describe('startSummaryRefreshScheduler', () => {
    it('does nothing and returns null when disabled (edge: off by default)', () => {
        const { deps, calls } = fakeDeps()
        const handle = startSummaryRefreshScheduler({ intervalHours: 0, runOnBoot: false }, deps)
        expect(handle).toBeNull()
        expect(calls.timers).toHaveLength(0)
    })

    it('arms a timer at the interval and returns a stop handle (feature)', () => {
        const { deps, calls } = fakeDeps()
        const handle = startSummaryRefreshScheduler({ intervalHours: 6, runOnBoot: false }, deps)
        expect(calls.timers[0].ms).toBe(6 * 3_600_000)
        handle?.stop()
        expect(calls.cleared).toBe(1)
    })

    it('clamps a multi-week interval to the 32-bit max on the first arm (edge: overflow)', () => {
        const { deps, calls } = fakeDeps()
        startSummaryRefreshScheduler({ intervalHours: 24 * 40, runOnBoot: false }, deps) // 40 days
        expect(calls.timers[0].ms).toBe(MAX_TIMEOUT_MS)
    })

    it('runs on each fire and re-arms (no pile-up) (feature: self-reschedule)', async () => {
        const { deps, calls } = fakeDeps()
        startSummaryRefreshScheduler({ intervalHours: 6, runOnBoot: false }, deps)
        expect(calls.runs).toBe(0) // nothing yet
        calls.timers[0].fire() // simulate the timer firing
        await new Promise((r) => setTimeout(r, 0))
        expect(calls.runs).toBe(1)
        expect(calls.timers).toHaveLength(2) // re-armed for the next period
    })

    it('runs once immediately when runOnBoot is set (feature: post-deploy freshness)', async () => {
        const { deps, calls } = fakeDeps()
        startSummaryRefreshScheduler({ intervalHours: 6, runOnBoot: true }, deps)
        await new Promise((r) => setTimeout(r, 0))
        expect(calls.runs).toBe(1)
    })

    it('stops firing after stop() (edge)', async () => {
        const { deps, calls } = fakeDeps()
        const handle = startSummaryRefreshScheduler({ intervalHours: 6, runOnBoot: false }, deps)
        handle?.stop()
        calls.timers[0].fire() // fires after stop → guarded no-op
        await new Promise((r) => setTimeout(r, 0))
        expect(calls.runs).toBe(0)
    })
})
