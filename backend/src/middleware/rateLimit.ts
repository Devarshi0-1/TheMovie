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
    /** Derive the client identity; defaults to the forwarded client IP. */
    identify?: (c: Context) => string
    store?: RateLimitStore
}

// Behind a proxy the real client IP is the first entry of X-Forwarded-For.
// Without it (direct/local), everyone shares the 'anonymous' bucket — safe
// (over-strict) rather than unbounded.
function defaultIdentify(c: Context): string {
    const forwarded = c.req.header('x-forwarded-for')
    return forwarded?.split(',')[0]?.trim() || 'anonymous'
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
    } = opts

    return async (c, next) => {
        const key = `ratelimit:${prefix}:${identify(c)}`

        let count: number
        try {
            count = await store.hit(key, windowSeconds)
        } catch (err) {
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
