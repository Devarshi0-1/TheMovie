import { redis } from 'bun'
import { sql } from 'drizzle-orm'
import { Hono } from 'hono'
import { cors } from 'hono/cors'
import { secureHeaders } from 'hono/secure-headers'
import { auth } from './lib/auth'
import { db } from './db'
import { rateLimit } from './middleware/rateLimit'
import chatRoute from './routes/chat'
import moviesRoute from './routes/movies'
import recommendationsRoute from './routes/recommendations'
import reviewsRoute from './routes/reviews'
import watchlistRoute from './routes/watchlist'

export const app = new Hono()

// Security headers on every response (nosniff, frame-deny, referrer policy, …).
app.use('*', secureHeaders())

// CORS restricted to the known frontend origins (never `*` with credentials).
const allowedOrigins = [process.env.FRONTEND_URL, 'http://localhost:3000'].filter(
    (o): o is string => Boolean(o),
)
app.use(
    '/*',
    cors({
        origin: (origin) => (allowedOrigins.includes(origin) ? origin : allowedOrigins[0]),
        allowHeaders: ['Content-Type', 'Authorization'],
        allowMethods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS'],
        exposeHeaders: ['Content-Type'],
        maxAge: 600,
        credentials: true,
    }),
)

// Rate limits (Redis-backed; fail-open). Tighter on the expensive AI chat
// endpoint and on auth (brute-force) than on general API traffic.
app.use('/api/auth/*', rateLimit({ prefix: 'auth', limit: 30, windowSeconds: 300 }))
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
app.route('/api/v1/chat', chatRoute)
app.route('/api/v1/watchlist', watchlistRoute)
app.route('/api/v1/reviews', reviewsRoute)
app.route('/api/v1/recommendations', recommendationsRoute)

// Bound each dependency probe so an unreachable service reports `down`
// quickly instead of hanging on a connection attempt. The rejection handler
// on `work` ensures a late failure (after the timeout already won) stays
// handled rather than surfacing as an unhandled rejection.
const HEALTH_TIMEOUT_MS = 1500

const probe = (work: Promise<unknown>, ms: number): Promise<void> =>
    new Promise<void>((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error('health check timed out')), ms)
        work.then(
            () => {
                clearTimeout(timer)
                resolve()
            },
            (err) => {
                clearTimeout(timer)
                reject(err)
            },
        )
    })

app.get('/health', async (c) => {
    const [dbResult, redisResult] = await Promise.allSettled([
        probe(db.execute(sql`select 1`), HEALTH_TIMEOUT_MS),
        probe(redis.ping(), HEALTH_TIMEOUT_MS),
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
