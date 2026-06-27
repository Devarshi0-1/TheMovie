import { timingSafeEqual } from 'node:crypto'
import { Hono } from 'hono'
import { triggerSummaryRefresh, type RefreshOutcome } from '../jobs/scheduler'

// Machine-to-machine trigger endpoints for background jobs. A durable external
// scheduler (platform cron / Cloud Scheduler / K8s CronJob / GitHub Actions)
// POSTs here on a real cron schedule — so runs survive restarts and fire on
// wall-clock time, which an in-process timer can't guarantee. Guarded by a shared
// secret; disabled entirely unless JOB_TRIGGER_SECRET is set.

/** Constant-time secret check (avoids leaking the secret via comparison timing). */
function secretMatches(provided: string, expected: string): boolean {
    const a = Buffer.from(provided)
    const b = Buffer.from(expected)
    // timingSafeEqual throws on length mismatch; a length difference is itself a
    // (minor) signal, but short-circuiting here is standard and avoids the throw.
    if (a.length !== b.length) return false
    return timingSafeEqual(a, b)
}

/** Pull the token from `X-Job-Secret` or an `Authorization: Bearer <token>`. */
function presentedSecret(headerGet: (name: string) => string | undefined): string | null {
    const direct = headerGet('X-Job-Secret')
    if (direct) return direct
    const auth = headerGet('Authorization') ?? ''
    const match = auth.match(/^Bearer\s+(.+)$/i)
    return match?.[1] ?? null
}

/**
 * Build the jobs router. `trigger` is injected so the route's auth gate is
 * testable without touching Redis / OpenAI / the DB.
 */
export function createJobsRoute(
    trigger: () => Promise<RefreshOutcome> = triggerSummaryRefresh,
): Hono {
    const route = new Hono()

    // POST /refresh-summaries — kick off a tiered summary refresh. Returns the
    // run stats (200), `skipped` when another run already holds the lock (200),
    // or 500 on failure.
    route.post('/refresh-summaries', async (c) => {
        const secret = process.env.JOB_TRIGGER_SECRET
        const provided = presentedSecret((name) => c.req.header(name))
        // Uniform 401 whether triggers are unconfigured OR the secret is wrong —
        // the response must not reveal whether the endpoint is enabled. (BSEC-7.)
        if (!secret || !provided || !secretMatches(provided, secret)) {
            return c.json({ error: 'Unauthorized' }, 401)
        }

        const outcome = await trigger()
        return c.json(outcome, outcome.status === 'failed' ? 500 : 200)
    })

    return route
}

export default createJobsRoute()
