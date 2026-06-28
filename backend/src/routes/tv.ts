import { Hono } from 'hono'
import { MovieIdSchema } from '@themovie/schemas'
import { getTrendingTv, getTvDetails, getTvExtras, searchTv } from '../lib/tmdb'
import { DEFAULT_WATCH_REGION, toTvDetailView, toTvExtrasView, toTvResults } from '../lib/movieView'

// TV endpoints mirror the movie endpoints but proxy TMDB's `/tv/*` routes and map
// onto the SAME shared shapes (with mediaType: 'tv'), so the frontend reuses one
// card/detail UI. TV is NOT ingested/embedded — there's no DB/agent involvement,
// so no semantic search or summaries here (deliberate cost choice).

const tvRoute = new Hono()

tvRoute.get('/trending', async (c) => {
    try {
        const trending = await getTrendingTv()
        return c.json(toTvResults(trending))
    } catch (error) {
        console.error('Error fetching trending TV:', error)
        return c.json({ error: 'Failed to fetch trending TV shows' }, 500)
    }
})

tvRoute.get('/search', async (c) => {
    try {
        const query = c.req.query('q')?.trim()
        if (!query) {
            return c.json({ error: 'Query parameter "q" is required' }, 400)
        }
        if (query.length > 200) {
            return c.json({ error: 'Query is too long (max 200 characters)' }, 400)
        }

        const results = await searchTv(query)
        return c.json(toTvResults(results))
    } catch (error) {
        console.error('Error searching TV:', error)
        return c.json({ error: 'Failed to fetch TV search results' }, 500)
    }
})

tvRoute.get('/:id', async (c) => {
    try {
        const id = MovieIdSchema.safeParse(c.req.param('id'))
        if (!id.success) {
            return c.json({ error: 'A valid TV id is required' }, 400)
        }

        const details = await getTvDetails(String(id.data))
        return c.json(toTvDetailView(details, id.data))
    } catch (error) {
        console.error('Error fetching TV details:', error)
        return c.json({ error: 'Failed to fetch TV details' }, 500)
    }
})

// Detail-screen enrichment: cast, creator/director, trailer, where-to-watch, and
// "more like this". One TMDB append_to_response call behind this route.
tvRoute.get('/:id/extras', async (c) => {
    try {
        const id = MovieIdSchema.safeParse(c.req.param('id'))
        if (!id.success) {
            return c.json({ error: 'A valid TV id is required' }, 400)
        }

        const rawRegion = c.req.query('region')?.trim().toUpperCase()
        const region = rawRegion && /^[A-Z]{2}$/.test(rawRegion) ? rawRegion : DEFAULT_WATCH_REGION

        const extras = await getTvExtras(String(id.data))
        return c.json(toTvExtrasView(extras, region))
    } catch (error) {
        console.error('Error fetching TV extras:', error)
        return c.json({ error: 'Failed to fetch TV extras' }, 500)
    }
})

export default tvRoute
