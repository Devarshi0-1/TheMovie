import { createMiddleware } from 'hono/factory'
import { auth } from '../lib/auth'

/** Typed context set by `requireAuth` so handlers read `c.get('userId')`. */
export type AuthVariables = { userId: string }

/**
 * Reject unauthenticated requests with a 401 once, and stash the user id in the
 * typed context — so protected routes don't each re-implement the getSession
 * check. Apply with `app.use('*', requireAuth)` on a `Hono<{ Variables: AuthVariables }>`.
 */
export const requireAuth = createMiddleware<{ Variables: AuthVariables }>(async (c, next) => {
    const session = await auth.api.getSession({ headers: c.req.raw.headers })
    if (!session) return c.json({ error: 'Unauthorized' }, 401)
    c.set('userId', session.user.id)
    await next()
})
