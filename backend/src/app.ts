import { sql } from 'drizzle-orm'
import { Hono } from 'hono'
import { cors } from 'hono/cors'
import { secureHeaders } from 'hono/secure-headers'
import { auth, trustedOrigins } from './lib/auth'
import { redis } from './lib/redis'
import { withTimeout } from './lib/withTimeout'
import { db } from './db'
import { rateLimit } from './middleware/rateLimit'
import chatRoute from './routes/chat'
import jobsRoute from './routes/jobs'
import moviesRoute from './routes/movies'
import tvRoute from './routes/tv'
import recommendationsRoute from './routes/recommendations'
import reviewsRoute from './routes/reviews'
import searchRoute from './routes/search'
import watchlistRoute from './routes/watchlist'

export const app = new Hono()

// Security headers on every response (nosniff, frame-deny, referrer policy, …).
app.use('*', secureHeaders())

// CORS restricted to the known frontend origins (never `*` with credentials).
// Shares the `trustedOrigins` list with BetterAuth so the two can't drift.
const allowedOrigins = trustedOrigins
app.use(
    '/*',
    cors({
        origin: (origin) => (allowedOrigins.includes(origin) ? origin : allowedOrigins[0]),
        allowHeaders: ['Content-Type', 'Authorization'],
        allowMethods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS'],
        // Expose X-Conversation-Id so the chat client can read the id the server
        // used and persist it for cross-session resume.
        exposeHeaders: ['Content-Type', 'X-Conversation-Id'],
        maxAge: 600,
        credentials: true,
    }),
)

// Rate limits (Redis-backed; fail-open). Tighter on the expensive AI chat
// endpoint and on auth (brute-force) than on general API traffic.
// Auth is the brute-force surface — fail CLOSED if the limiter store is down,
// so a Redis outage can't silently disable login throttling.
app.use(
    '/api/auth/*',
    rateLimit({ prefix: 'auth', limit: 30, windowSeconds: 300, failClosed: true }),
)
app.use('/api/v1/*', rateLimit({ prefix: 'api', limit: 120, windowSeconds: 60 }))
app.use('/api/v1/chat/*', rateLimit({ prefix: 'chat', limit: 15, windowSeconds: 60 }))

app.on(['POST', 'GET'], '/api/auth/*', (c) => {
    return auth.handler(c.req.raw)
})

app.get('/api/me', async (c) => {
    const session = await auth.api.getSession({ headers: c.req.raw.headers })

    if (!session) {
        return c.json({ error: 'Unauthorized' }, 401)
    }

    return c.json({
        message: 'You are logged in!',
        user: session.user,
    })
})

app.route('/api/v1/movies', moviesRoute)
app.route('/api/v1/tv', tvRoute)
app.route('/api/v1/search', searchRoute)
app.route('/api/v1/chat', chatRoute)
app.route('/api/v1/watchlist', watchlistRoute)
app.route('/api/v1/reviews', reviewsRoute)
app.route('/api/v1/recommendations', recommendationsRoute)
// Secret-guarded job triggers for an external scheduler (see routes/jobs.ts).
app.route('/api/v1/jobs', jobsRoute)

// Bound each dependency probe (via the shared `withTimeout`) so an unreachable
// service reports `down` quickly instead of hanging on a connection attempt.
const HEALTH_TIMEOUT_MS = 1500

app.get('/health', async (c) => {
    const [dbResult, redisResult] = await Promise.allSettled([
        withTimeout(db.execute(sql`select 1`), HEALTH_TIMEOUT_MS, 'db health check timed out'),
        withTimeout(redis.ping(), HEALTH_TIMEOUT_MS, 'redis health check timed out'),
    ])

    if (dbResult.status === 'rejected') {
        console.error('Health check: Postgres ping failed', dbResult.reason)
    }
    if (redisResult.status === 'rejected') {
        console.error('Health check: Redis ping failed', redisResult.reason)
    }

    const checks: { db: 'up' | 'down'; redis: 'up' | 'down' } = {
        db: dbResult.status === 'fulfilled' ? 'up' : 'down',
        redis: redisResult.status === 'fulfilled' ? 'up' : 'down',
    }

    const healthy = checks.db === 'up' && checks.redis === 'up'

    return c.json({ status: healthy ? 'ok' : 'degraded', checks }, healthy ? 200 : 503)
})

app.get('/ping', (c) => c.text('pong'))

app.get('/test', (c) => {
    return c.json({ message: 'Hello Hono!' })
})

// Unknown path → JSON 404 (consistent with the route error envelope), not
// Hono's bare plaintext default.
app.notFound((c) => c.json({ error: 'Not Found' }, 404))

// Any unhandled throw → logged once here and returned as a JSON 500, so routes
// without their own try/catch don't leak Hono's plaintext default.
app.onError((err, c) => {
    console.error('Unhandled error:', err)
    return c.json({ error: 'Internal Server Error' }, 500)
})
