import { Hono } from 'hono'
import { getRecentReviews, upsertReview } from '../lib/reviews'
import { MediaTypeSchema, MovieIdSchema, ReviewInputSchema } from '@themovie/schemas'
import { requireAuth, type AuthVariables } from '../middleware/auth'

const reviewsRoute = new Hono<{ Variables: AuthVariables }>()

// Create or update the current user's review of a movie/show (authenticated).
// `mediaType` comes from the body (defaults to 'movie').
reviewsRoute.post('/', requireAuth, async (c) => {
    const body = await c.req.json().catch(() => null)
    const parsed = ReviewInputSchema.safeParse(body)
    if (!parsed.success) {
        return c.json({ error: 'Invalid request body', issues: parsed.error.issues }, 400)
    }

    const entry = await upsertReview(c.get('userId'), parsed.data)
    return c.json(entry, 201)
})

// Recent reviews for a movie/show (public). The media-type path segment doubles
// as the discriminator: `/movie/:id` (unchanged) and `/tv/:id`.
reviewsRoute.get('/:mediaType/:movieId', async (c) => {
    const mediaType = MediaTypeSchema.safeParse(c.req.param('mediaType'))
    if (!mediaType.success) return c.json({ error: 'mediaType must be "movie" or "tv"' }, 400)

    const id = MovieIdSchema.safeParse(c.req.param('movieId'))
    if (!id.success) return c.json({ error: 'A valid id is required' }, 400)

    return c.json(await getRecentReviews(id.data, mediaType.data))
})

export default reviewsRoute
