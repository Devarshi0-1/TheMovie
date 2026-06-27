import { Hono } from 'hono'
import { recommendForUser } from '../lib/recommendations'
import { requireAuth, type AuthVariables } from '../middleware/auth'

const recommendationsRoute = new Hono<{ Variables: AuthVariables }>()

// Personalized "because you watched X" recommendations for the current user.
recommendationsRoute.get('/', requireAuth, async (c) => {
    return c.json(await recommendForUser(c.get('userId')))
})

export default recommendationsRoute
