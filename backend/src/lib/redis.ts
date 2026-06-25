import { RedisClient } from 'bun'

// A single shared Redis client for the whole backend (cache, rate-limit store,
// watchlist membership, review/summary caches).
//
// We construct an explicit client instead of using Bun's global `redis` so we
// can tune reconnection + per-command failure behavior. Two knobs work together:
//
// - `maxRetries` very high: Bun's default is 10 reconnection attempts, which a
//   short outage exhausts within seconds — after which `autoReconnect` gives up
//   permanently and every Redis-backed read stays wedged until the process
//   restarts (a transient blip becomes a hard outage). A very high cap keeps the
//   client reconnecting across an outage; the counter resets on each connect.
//
// - `connectionTimeout` bounded: WITHOUT this, a command issued while Redis is
//   down waits on the (effectively infinite) reconnect loop and hangs for the
//   whole outage — silently breaking the rate limiter's fail-open and any
//   un-timed cache read. Bounding the connection attempt makes such commands
//   REJECT (after a couple of internal retries) so callers' catch/fail-open
//   paths fire. The offline queue stays enabled, so a normal first command
//   still waits for the lazy connect and succeeds.
export const redis = new RedisClient(process.env.REDIS_URL, {
    maxRetries: 2_147_483_647,
    connectionTimeout: 2000,
})
