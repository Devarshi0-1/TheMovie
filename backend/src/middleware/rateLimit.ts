import type { Context, MiddlewareHandler } from 'hono'
import { redis } from '../lib/redis'
import { withTimeout } from '../lib/withTimeout'

// Fixed-window rate limiting via Redis INCR + EXPIRE (the cheap, atomic-enough
// pattern named in the roadmap): the first hit in a window sets the TTL, and the
// counter resets when the key expires. Keyed per client + route bucket.

export interface RateLimitStore {
    /** Increment the window counter for `key` and return the new count. */
    hit(key: string, windowSeconds: number): Promise<number>
}

// This runs on every rate-limited request (the global hot path), so a Redis
// outage must fail OPEN *fast*. The client already bounds a hung command (see
// lib/redis `connectionTimeout`), but ~2s on every request is too slow here, so
// we additionally race each command against a short timeout — the rejection
// trips the middleware's fail-open catch in well under a second.
const STORE_TIMEOUT_MS = 750

export const redisRateLimitStore: RateLimitStore = {
    async hit(key, windowSeconds) {
        const count = await withTimeout(redis.incr(key), STORE_TIMEOUT_MS, 'redis incr timed out')
        // Only the first request in the window arms the expiry.
        if (count === 1) {
            await withTimeout(
                redis.expire(key, windowSeconds),
                STORE_TIMEOUT_MS,
                'redis expire timed out',
            )
        }
        return count
    },
}

export interface RateLimitOptions {
    /** Max requests allowed per window. */
    limit: number
    windowSeconds: number
    /** Bucket name so different routes count independently (e.g. 'chat'). */
    prefix: string
    /** Derive the client identity; defaults to the trusted client IP. */
    identify?: (c: Context) => string
    store?: RateLimitStore
    /**
     * When the store is unreachable: `false` (default) allows the request (the
     * general API stays up); `true` rejects with 503 (use for the auth bucket so
     * brute-force throttling can't be disabled by taking Redis down).
     */
    failClosed?: boolean
}

// The client IP from X-Forwarded-For. The LEFTMOST entries are client-supplied
// and trivially spoofable; the entry appended by your nearest trusted proxy is
// at the RIGHT. `TRUSTED_PROXY_HOPS` (default 1) is how many proxies sit in
// front — we read that many from the right. No XFF (direct/local) → everyone
// shares the 'anonymous' bucket (over-strict, never unbounded).
function defaultIdentify(c: Context): string {
    const forwarded = c.req.header('x-forwarded-for')
    if (!forwarded) return 'anonymous'
    const parts = forwarded
        .split(',')
        .map((p) => p.trim())
        .filter(Boolean)
    const hops = Math.max(1, Number(process.env.TRUSTED_PROXY_HOPS ?? '1') || 1)
    return parts[parts.length - hops] ?? parts[parts.length - 1] ?? 'anonymous'
}

/**
 * Hono middleware that rejects requests once a client exceeds `limit` per
 * window. Fails OPEN: if the store (Redis) is unreachable, requests are allowed
 * rather than the whole API going down with the limiter.
 */
export function rateLimit(opts: RateLimitOptions): MiddlewareHandler {
    const {
        limit,
        windowSeconds,
        prefix,
        identify = defaultIdentify,
        store = redisRateLimitStore,
        failClosed = false,
    } = opts

    return async (c, next) => {
        const key = `ratelimit:${prefix}:${identify(c)}`

        let count: number
        try {
            count = await store.hit(key, windowSeconds)
        } catch (err) {
            if (failClosed) {
                console.error('⚠️ Rate limiter store unavailable; rejecting (fail-closed):', err)
                c.header('Retry-After', String(windowSeconds))
                return c.json({ error: 'Service temporarily unavailable.' }, 503)
            }
            console.warn('⚠️ Rate limiter store unavailable; allowing request:', err)
            return next()
        }

        c.header('X-RateLimit-Limit', String(limit))
        c.header('X-RateLimit-Remaining', String(Math.max(0, limit - count)))

        if (count > limit) {
            c.header('Retry-After', String(windowSeconds))
            return c.json({ error: 'Too many requests. Please slow down.' }, 429)
        }

        return next()
    }
}
