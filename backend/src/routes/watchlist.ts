import { Hono } from 'hono'
import { addToWatchlist, getWatchlist, isInWatchlist, removeFromWatchlist } from '../lib/watchlist'
import { MovieIdSchema, WatchlistAddSchema } from '@themovie/schemas'
import { requireAuth, type AuthVariables } from '../middleware/auth'

const watchlistRoute = new Hono<{ Variables: AuthVariables }>()

// Every watchlist route is authenticated; the shared guard stashes the user id.
watchlistRoute.use('*', requireAuth)

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
    const id = MovieIdSchema.safeParse(c.req.param('movieId'))
    if (!id.success) return c.json({ error: 'A valid movie ID is required' }, 400)

    const { removed } = await removeFromWatchlist(c.get('userId'), id.data)
    return c.json({ removed, movieId: id.data })
})

// O(1) membership check for "is this on my watchlist?".
watchlistRoute.get('/:movieId/status', async (c) => {
    const id = MovieIdSchema.safeParse(c.req.param('movieId'))
    if (!id.success) return c.json({ error: 'A valid movie ID is required' }, 400)

    return c.json({ inWatchlist: await isInWatchlist(c.get('userId'), id.data) })
})

export default watchlistRoute
