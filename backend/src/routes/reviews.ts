import { Hono } from 'hono'
import { getRecentReviews, upsertReview } from '../lib/reviews'
import { MovieIdSchema, ReviewInputSchema } from '@themovie/schemas'
import { requireAuth, type AuthVariables } from '../middleware/auth'

const reviewsRoute = new Hono<{ Variables: AuthVariables }>()

// Create or update the current user's review of a movie (authenticated).
reviewsRoute.post('/', requireAuth, async (c) => {
    const body = await c.req.json().catch(() => null)
    const parsed = ReviewInputSchema.safeParse(body)
    if (!parsed.success) {
        return c.json({ error: 'Invalid request body', issues: parsed.error.issues }, 400)
    }

    const entry = await upsertReview(c.get('userId'), parsed.data)
    return c.json(entry, 201)
})

// Recent reviews for a movie (public).
reviewsRoute.get('/movie/:movieId', async (c) => {
    const id = MovieIdSchema.safeParse(c.req.param('movieId'))
    if (!id.success) return c.json({ error: 'A valid movie ID is required' }, 400)

    return c.json(await getRecentReviews(id.data))
})

export default reviewsRoute
