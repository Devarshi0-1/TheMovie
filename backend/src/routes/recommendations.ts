import { Hono } from 'hono'
import { auth } from '../lib/auth'
import { recommendForUser } from '../lib/recommendations'

const recommendationsRoute = new Hono()

// Personalized "because you watched X" recommendations for the current user.
recommendationsRoute.get('/', async (c) => {
    const session = await auth.api.getSession({ headers: c.req.raw.headers })
    if (!session) return c.json({ error: 'Unauthorized' }, 401)

    return c.json(await recommendForUser(session.user.id))
})

export default recommendationsRoute
