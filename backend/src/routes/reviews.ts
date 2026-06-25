import { Hono } from 'hono'
import { auth } from '../lib/auth'
import { getRecentReviews, upsertReview } from '../lib/reviews'
import { ReviewInputSchema } from '../schemas/review'

const reviewsRoute = new Hono<{ Variables: { userId: string } }>()

// Create or update the current user's review of a movie (authenticated).
reviewsRoute.post('/', async (c) => {
    const session = await auth.api.getSession({ headers: c.req.raw.headers })
    if (!session) return c.json({ error: 'Unauthorized' }, 401)

    const body = await c.req.json().catch(() => null)
    const parsed = ReviewInputSchema.safeParse(body)
    if (!parsed.success) {
        return c.json({ error: 'Invalid request body', issues: parsed.error.issues }, 400)
    }

    const entry = await upsertReview(session.user.id, parsed.data)
    return c.json(entry, 201)
})

// Recent reviews for a movie (public).
reviewsRoute.get('/movie/:movieId', async (c) => {
    const movieId = Number(c.req.param('movieId'))
    if (!Number.isInteger(movieId) || movieId <= 0) {
        return c.json({ error: 'A valid movie ID is required' }, 400)
    }

    return c.json(await getRecentReviews(movieId))
})

export default reviewsRoute
