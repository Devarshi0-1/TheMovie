import { RedisClient } from 'bun'

// A single shared Redis client for the whole backend (cache, rate-limit store,
// watchlist membership, review/summary caches).
//
// We construct an explicit client instead of using Bun's global `redis` so we
// can raise `maxRetries`. Bun's default is 10 reconnection attempts, which a
// short outage exhausts within seconds — after which `autoReconnect` gives up
// permanently and every Redis-backed read stays wedged until the process
// restarts (a transient blip becomes a hard outage). A very high cap keeps the
// client reconnecting across an outage; the retry counter resets on each
// successful connect. Connection is lazy (on first command), same as the global.
export const redis = new RedisClient(process.env.REDIS_URL, {
    maxRetries: 2_147_483_647,
})
