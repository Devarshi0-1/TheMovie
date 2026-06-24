import { Hono } from 'hono'
import { cors } from 'hono/cors'
import { auth } from './lib/auth'
import moviesRoute from './routes/movies'

const app = new Hono()

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

app.get('/ping', (c) => c.text('pong'))

app.get('/test', (c) => {
    return c.json({ message: 'Hello Hono!' })
})

export default {
    port: 3000,
    fetch: app.fetch,
}
