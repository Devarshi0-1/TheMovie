import { redis } from '../lib/redis'
import { refreshSummaries, type RefreshStats } from './refresh-summaries'

// In-process scheduler for the tiered summary refresh. Starting it from the
// backend entrypoint means the job runs automatically wherever the server is
// deployed — no external cron, no separate worker. It's OFF by default and
// enabled per-environment via SUMMARY_REFRESH_INTERVAL_HOURS.
//
// A Redis lock (SET NX EX) makes it safe behind a load balancer: even with N
// instances, only the one that acquires the per-interval lock runs, so the
// refresh never fans out N× or overlaps itself.

const HOUR_MS = 3_600_000
const LOCK_KEY = 'scheduler:summary-refresh:lock'
const MIN_LOCK_TTL_SECONDS = 300

export interface SchedulerConfig {
    /** Hours between runs. 0 (the default) disables the scheduler entirely. */
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

interface IntervalHandle {
    unref?: () => void
}

/** IO seams, injected so scheduling logic is testable without Redis / real timers. */
export interface SchedulerDeps {
    /** Acquire the cross-instance run lock (SET NX EX). True ⇒ this instance runs. */
    acquireLock: (ttlSeconds: number) => Promise<boolean>
    run: () => Promise<RefreshStats>
    setInterval: (fn: () => void, ms: number) => IntervalHandle
    clearInterval: (handle: IntervalHandle) => void
}

function defaultDeps(): SchedulerDeps {
    return {
        async acquireLock(ttlSeconds) {
            // Raw `SET key token EX ttl NX` via send() — Bun's typed set() overloads
            // don't cover the NX+EX combo. Returns 'OK' on acquire, null when the
            // lock is already held (by this or another instance).
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
        setInterval: (fn, ms) => globalThis.setInterval(fn, ms) as unknown as IntervalHandle,
        clearInterval: (handle) => globalThis.clearInterval(handle as unknown as number),
    }
}

/**
 * One scheduled tick: take the cross-instance lock and, if we got it, run the
 * refresh. The lock TTL ≈ the interval, so exactly ONE instance runs per interval
 * and a slow run can't overlap the next tick. Never throws — failures are logged.
 */
export async function runScheduledRefresh(
    intervalHours: number,
    deps: SchedulerDeps,
): Promise<'ran' | 'skipped' | 'failed'> {
    // A touch under the interval so the next tick can re-acquire, floored so a
    // short interval still blocks overlap.
    const ttl = Math.max(MIN_LOCK_TTL_SECONDS, Math.floor(intervalHours * 3600) - 60)

    let acquired: boolean
    try {
        acquired = await deps.acquireLock(ttl)
    } catch (err) {
        console.error('❌ Summary-refresh scheduler: lock check failed:', err)
        return 'failed'
    }
    if (!acquired) return 'skipped' // another instance owns this interval

    try {
        const stats = await deps.run()
        console.log('🕒 Scheduled summary refresh:', stats)
        return 'ran'
    } catch (err) {
        console.error('❌ Scheduled summary refresh failed:', err)
        return 'failed'
    }
}

/**
 * Start the in-process summary-refresh scheduler. Disabled (returns null) unless
 * SUMMARY_REFRESH_INTERVAL_HOURS > 0. Deploys with the backend — no external cron.
 */
export function startSummaryRefreshScheduler(
    config: SchedulerConfig = readSchedulerConfig(),
    deps: SchedulerDeps = defaultDeps(),
): { stop: () => void } | null {
    if (config.intervalHours <= 0) {
        console.log(
            '🕒 Summary-refresh scheduler disabled (set SUMMARY_REFRESH_INTERVAL_HOURS > 0 to enable).',
        )
        return null
    }

    if (config.runOnBoot) void runScheduledRefresh(config.intervalHours, deps)

    const handle = deps.setInterval(
        () => void runScheduledRefresh(config.intervalHours, deps),
        config.intervalHours * HOUR_MS,
    )
    // Don't keep the process alive solely for this timer.
    handle.unref?.()

    console.log(
        `🕒 Summary-refresh scheduler started: every ${config.intervalHours}h` +
            `${config.runOnBoot ? ' (and once now)' : ''}.`,
    )
    return { stop: () => deps.clearInterval(handle) }
}
