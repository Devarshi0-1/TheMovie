import { Hono } from 'hono'
import { auth } from '../lib/auth'
import { addToWatchlist, getWatchlist, isInWatchlist, removeFromWatchlist } from '../lib/watchlist'
import { WatchlistAddSchema } from '../schemas/watchlist'

const watchlistRoute = new Hono<{ Variables: { userId: string } }>()

// Every watchlist route is authenticated; stash the user id for the handlers.
watchlistRoute.use('*', async (c, next) => {
    const session = await auth.api.getSession({ headers: c.req.raw.headers })
    if (!session) return c.json({ error: 'Unauthorized' }, 401)
    c.set('userId', session.user.id)
    await next()
})

// List the current user's watchlist.
watchlistRoute.get('/', async (c) => {
    return c.json(await getWatchlist(c.get('userId')))
})

// Add a movie (idempotent: 201 when newly added, 200 if already present).
watchlistRoute.post('/', async (c) => {
    const body = await c.req.json().catch(() => null)
    const parsed = WatchlistAddSchema.safeParse(body)
    if (!parsed.success) {
        return c.json({ error: 'Invalid request body', issues: parsed.error.issues }, 400)
    }

    const { added } = await addToWatchlist(c.get('userId'), parsed.data)
    return c.json({ added, movieId: parsed.data.movieId }, added ? 201 : 200)
})

// Remove a movie (idempotent — always 200, `removed` says whether it was there).
watchlistRoute.delete('/:movieId', async (c) => {
    const movieId = Number(c.req.param('movieId'))
    if (!Number.isInteger(movieId) || movieId <= 0) {
        return c.json({ error: 'A valid movie ID is required' }, 400)
    }

    const { removed } = await removeFromWatchlist(c.get('userId'), movieId)
    return c.json({ removed, movieId })
})

// O(1) membership check for "is this on my watchlist?".
watchlistRoute.get('/:movieId/status', async (c) => {
    const movieId = Number(c.req.param('movieId'))
    if (!Number.isInteger(movieId) || movieId <= 0) {
        return c.json({ error: 'A valid movie ID is required' }, 400)
    }

    return c.json({ inWatchlist: await isInWatchlist(c.get('userId'), movieId) })
})

export default watchlistRoute
