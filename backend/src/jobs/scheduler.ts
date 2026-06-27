import { redis } from '../lib/redis'
import { refreshSummaries, type RefreshStats } from './refresh-summaries'

// Scheduling for the tiered summary refresh, two ways that share one lock-gated
// runner:
//   1. An EXTERNAL trigger endpoint (the robust production path) — a durable
//      scheduler (platform cron / Cloud Scheduler / K8s CronJob / CI) hits the
//      HTTP endpoint, so runs survive restarts and fire on wall-clock time.
//   2. An optional IN-PROCESS timer for simple always-on single-instance deploys.
//
// Both go through `runLockedRefresh`, so a Redis lock (SET NX EX) guarantees
// single-flight even if the timer and an external trigger fire at once, or two
// instances run behind a load balancer.

const HOUR_MS = 3_600_000
const LOCK_KEY = 'scheduler:summary-refresh:lock'
const MIN_LOCK_TTL_SECONDS = 300
// setTimeout/setInterval delays are stored as a 32-bit int (ms); a larger delay
// silently overflows and fires almost immediately. Cap each timer at this and
// CHAIN for longer periods so e.g. a multi-week interval can't melt down.
const MAX_TIMEOUT_MS = 2_147_483_647
/**
 * Lock TTL for an externally-triggered (HTTP) run — fixed, generous for one run.
 * The lock is held (never explicitly released) for its full TTL, so two external
 * triggers closer together than this return `skipped`. This is the single-flight
 * guarantee, but it also fixes the *minimum* external-trigger cadence at 30 min:
 * point the production cron at ≥30 min, or lower this TTL to allow finer-grained
 * runs. (See BJOB-2.)
 */
export const ENDPOINT_LOCK_TTL_SECONDS = 1800

export interface SchedulerConfig {
    /** Hours between in-process runs. 0 (default) disables the in-process timer. */
    intervalHours: number
    /** Also run once shortly after boot (useful right after a deploy). */
    runOnBoot: boolean
}

export function readSchedulerConfig(
    env: Record<string, string | undefined> = process.env,
): SchedulerConfig {
    const raw = Number(env.SUMMARY_REFRESH_INTERVAL_HOURS)
    return {
        intervalHours: Number.isFinite(raw) && raw > 0 ? raw : 0,
        runOnBoot: env.SUMMARY_REFRESH_ON_BOOT === 'true',
    }
}

export type RefreshOutcome =
    | { status: 'ran'; stats: RefreshStats }
    | { status: 'skipped' }
    | { status: 'failed'; error: string }

interface TimeoutHandle {
    unref?: () => void
}

/** IO seams, injected so scheduling logic is testable without Redis / real timers. */
export interface SchedulerDeps {
    /** Acquire the cross-instance run lock (SET NX EX). True ⇒ this caller runs. */
    acquireLock: (ttlSeconds: number) => Promise<boolean>
    run: () => Promise<RefreshStats>
    setTimeout: (fn: () => void, ms: number) => TimeoutHandle
    clearTimeout: (handle: TimeoutHandle) => void
}

export function defaultSchedulerDeps(): SchedulerDeps {
    return {
        async acquireLock(ttlSeconds) {
            // Raw `SET key token EX ttl NX` via send() — Bun's typed set() overloads
            // don't cover the NX+EX combo. 'OK' on acquire, null when held elsewhere.
            const res = await redis.send('SET', [
                LOCK_KEY,
                String(Date.now()),
                'EX',
                String(ttlSeconds),
                'NX',
            ])
            return res === 'OK'
        },
        run: () => refreshSummaries(),
        setTimeout: (fn, ms) => globalThis.setTimeout(fn, ms) as unknown as TimeoutHandle,
        clearTimeout: (handle) => globalThis.clearTimeout(handle as unknown as number),
    }
}

/**
 * One lock-gated run: take the cross-instance lock and, if we got it, run the
 * refresh. Never throws — the outcome is returned. Shared by the HTTP trigger and
 * the in-process timer so both are single-flight against each other.
 */
export async function runLockedRefresh(
    deps: SchedulerDeps,
    lockTtlSeconds: number,
): Promise<RefreshOutcome> {
    let acquired: boolean
    try {
        acquired = await deps.acquireLock(lockTtlSeconds)
    } catch (err) {
        console.error('❌ Summary-refresh: lock check failed:', err)
        return { status: 'failed', error: errMessage(err) }
    }
    if (!acquired) return { status: 'skipped' } // another run holds the lock

    try {
        const stats = await deps.run()
        console.log('🕒 Summary refresh ran:', stats)
        return { status: 'ran', stats }
    } catch (err) {
        console.error('❌ Summary refresh failed:', err)
        return { status: 'failed', error: errMessage(err) }
    }
}

function errMessage(err: unknown): string {
    return err instanceof Error ? err.message : String(err)
}

/** Trigger a run through the default deps — the HTTP endpoint's entry point. */
export function triggerSummaryRefresh(
    deps: SchedulerDeps = defaultSchedulerDeps(),
): Promise<RefreshOutcome> {
    return runLockedRefresh(deps, ENDPOINT_LOCK_TTL_SECONDS)
}

/** Per-interval lock TTL: just under the interval so the next tick re-acquires, floored. */
export function lockTtlForInterval(intervalHours: number): number {
    return Math.max(MIN_LOCK_TTL_SECONDS, Math.floor(intervalHours * 3600) - 60)
}

/** Clamp a timer delay to the 32-bit max so long periods can't overflow/fire early. */
export function clampDelay(ms: number): number {
    return Math.min(Math.max(0, ms), MAX_TIMEOUT_MS)
}

/**
 * Start the optional in-process scheduler. Disabled (returns null) unless
 * SUMMARY_REFRESH_INTERVAL_HOURS > 0. Uses a SELF-RESCHEDULING setTimeout (not
 * setInterval): it recomputes the next delay each cycle — so a slow run can't
 * pile up ticks — and chains sub-`MAX_TIMEOUT_MS` sleeps so long periods don't
 * overflow the 32-bit timer. For production prefer the external trigger endpoint;
 * this is a convenience for a single always-on instance.
 */
export function startSummaryRefreshScheduler(
    config: SchedulerConfig = readSchedulerConfig(),
    deps: SchedulerDeps = defaultSchedulerDeps(),
): { stop: () => void } | null {
    if (config.intervalHours <= 0) {
        console.log(
            '🕒 In-process summary-refresh scheduler disabled (set SUMMARY_REFRESH_INTERVAL_HOURS > 0; for production prefer the /api/v1/jobs trigger + a real cron).',
        )
        return null
    }

    const periodMs = config.intervalHours * HOUR_MS
    const ttl = lockTtlForInterval(config.intervalHours)

    let stopped = false
    let handle: TimeoutHandle | null = null
    let remaining = periodMs

    const arm = (ms: number) => {
        handle = deps.setTimeout(() => {
            if (stopped) return
            remaining -= ms
            if (remaining > 0) {
                // Still mid-period (a long interval chained across capped sleeps).
                arm(clampDelay(remaining))
                return
            }
            remaining = periodMs
            void runLockedRefresh(deps, ttl)
            arm(clampDelay(remaining))
        }, ms)
        handle.unref?.()
    }

    if (config.runOnBoot) void runLockedRefresh(deps, ttl)
    arm(clampDelay(periodMs))

    console.log(
        `🕒 In-process summary-refresh scheduler started: every ${config.intervalHours}h` +
            `${config.runOnBoot ? ' (and once now)' : ''}.`,
    )
    return {
        stop: () => {
            stopped = true
            if (handle) deps.clearTimeout(handle)
        },
    }
}
