import { Hono } from 'hono'
import { suggestAll } from '../lib/suggest'

// Cross-media search endpoints. `/suggest` returns typeahead matches grouped into
// Movies and TV Shows in a single call, so the navbar search + discover box can
// render both sections without two round-trips. Each group is independently
// blended (local catalog + cached TMDB), deduped, and capped (see lib/suggest).

const searchRoute = new Hono()

// Grouped typeahead: { movies, tv }. A blank query returns empty groups (200),
// not a 400 — the box queries as the user types and an empty box has nothing to
// suggest.
searchRoute.get('/suggest', async (c) => {
    try {
        const query = c.req.query('q')?.trim()
        if (!query) return c.json({ movies: [], tv: [] })
        if (query.length > 200) {
            return c.json({ error: 'Query is too long (max 200 characters)' }, 400)
        }

        return c.json(await suggestAll(query))
    } catch (error) {
        console.error('Error fetching grouped suggestions:', error)
        return c.json({ error: 'Failed to fetch suggestions' }, 500)
    }
})

export default searchRoute
