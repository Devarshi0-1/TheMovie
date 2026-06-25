import { redis } from 'bun'
import { sql } from 'drizzle-orm'
import { Hono } from 'hono'
import { cors } from 'hono/cors'
import { auth } from './lib/auth'
import { db } from './db'
import chatRoute from './routes/chat'
import moviesRoute from './routes/movies'
import watchlistRoute from './routes/watchlist'

export const app = new Hono()

app.use(
    '/*',
    cors({
        origin: process.env.FRONTEND_URL!,
        allowHeaders: ['Content-Type', 'Authorization'],
        allowMethods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS'],
        exposeHeaders: ['Content-Type'],
        maxAge: 600,
        credentials: true,
    }),
)

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
