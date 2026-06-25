import { RedisClient } from 'bun'

// A single shared Redis client for the whole backend (cache, rate-limit store,
// watchlist membership, review/summary caches).
//
// `maxRetries` very high + bounded `connectionTimeout`: a high cap lets Bun keep
// reconnecting across an outage instead of giving up after its default 10
// attempts, while the bounded connection timeout means a command issued while
// Redis is down REJECTS (in ~connectionTimeout, after a couple of internal
// retries) instead of hanging for the whole outage — so the rate limiter's
// fail-open and any un-timed cache read surface quickly. The offline queue stays
// enabled, so a normal first command still waits for the lazy connect.
const REDIS_OPTIONS = {
    maxRetries: 2_147_483_647,
    connectionTimeout: 2000,
} as const

const createClient = () => new RedisClient(process.env.REDIS_URL, REDIS_OPTIONS)

/** True for Bun RedisClient errors that mean the connection itself is gone. */
export function isRedisConnectionError(err: unknown): boolean {
    const code = (err as { code?: string } | null)?.code ?? ''
    if (code.startsWith('ERR_REDIS_CONNECTION')) return true
    const message = String((err as { message?: string } | null)?.message ?? '')
    return /connection (has )?(failed|closed|timed out|timeout)/i.test(message)
}

/**
 * Self-healing Redis client. Bun's RedisClient does NOT reliably auto-reconnect
 * after an outage: once the connection drops it stays wedged in
 * `ERR_REDIS_CONNECTION_CLOSED` even with a huge `maxRetries`, and `connect()` on
 * the stuck instance does not recover it — but a FRESH client connects fine
 * (verified live). So when a command fails with a connection-level error we
 * discard the wedged client, create a new one, and retry the command once. This
 * makes every Redis-backed feature (cache, rate limiter, watchlist) recover
 * automatically after a blip instead of staying down until the process restarts.
 *
 * Factory-injected so the resilience is unit-testable without a live Redis.
 */
export function createResilientRedis(create: () => RedisClient): RedisClient {
    let client = create()
    return new Proxy({} as RedisClient, {
        get(_target, prop) {
            const current = client
            const value = (current as unknown as Record<PropertyKey, unknown>)[prop]
            if (typeof value !== 'function') return value
            const invoke = (c: RedisClient) =>
                (c as unknown as Record<PropertyKey, (...a: unknown[]) => unknown>)[prop]
            return (...args: unknown[]) => {
                let result: unknown
                try {
                    result = invoke(current).apply(current, args)
                } catch (err) {
                    if (!isRedisConnectionError(err)) throw err
                    result = Promise.reject(err)
                }
                if (!(result instanceof Promise)) return result
                return result.catch((err: unknown) => {
                    if (!isRedisConnectionError(err)) throw err
                    // Replace the wedged client (once, even under concurrent
                    // failures) and retry the command on the fresh connection.
                    try {
                        current.close()
                    } catch {
                        // already closed — nothing to do
                    }
                    if (client === current) client = create()
                    return invoke(client).apply(client, args)
                })
            }
        },
    })
}

export const redis = createResilientRedis(createClient)
