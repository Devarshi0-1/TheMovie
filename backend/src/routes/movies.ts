import { Hono } from 'hono'
import { MovieIdSchema } from '@themovie/schemas'
import { getMovieDetails, getMovieExtras, getTrendingMovies, searchMovie } from '../lib/tmdb'
import {
    DEFAULT_WATCH_REGION,
    toMovieDetailView,
    toMovieExtrasView,
    toMovieResults,
} from '../lib/movieView'
import { summarizeReviews } from '../lib/summary'
import { suggestMovies } from '../lib/suggest'

// These endpoints proxy TMDB but speak the shared camelCase contract — the
// frontend receives `MovieResult` / `MovieDetailView` and never sees TMDB's raw
// snake_case (DL-10). Mapping happens here via `movieView`, the single place the
// TMDB → display translation lives.

const moviesRoute = new Hono()

moviesRoute.get('/trending', async (c) => {
    try {
        const trendingMovies = await getTrendingMovies()

        if (!trendingMovies) {
            return c.json({ error: 'Failed to fetch trending movies' }, 500)
        }

        return c.json(toMovieResults(trendingMovies))
    } catch (error) {
        console.error('Error fetching trending movies:', error)
        return c.json({ error: 'Failed to fetch trending movies' }, 500)
    }
})

moviesRoute.get('/search', async (c) => {
    try {
        const query = c.req.query('q')?.trim()

        // Validate the search input at the boundary: present and bounded length.
        if (!query) {
            return c.json({ error: 'Query parameter "q" is required' }, 400)
        }
        if (query.length > 200) {
            return c.json({ error: 'Query is too long (max 200 characters)' }, 400)
        }

        const searchResults = await searchMovie(query)

        if (!searchResults) {
            return c.json({ error: 'Failed to fetch search results' }, 500)
        }

        return c.json(toMovieResults(searchResults))
    } catch (error) {
        console.error('Error searching movies:', error)
        return c.json({ error: 'Failed to fetch search results' }, 500)
    }
})

// Typeahead suggestions for the search box: local catalog + TMDB, deduped.
// A blank query returns an empty list (200), not a 400 — the box queries as the
// user types and an empty box simply has nothing to suggest.
moviesRoute.get('/suggest', async (c) => {
    try {
        const query = c.req.query('q')?.trim()
        if (!query) return c.json([])
        if (query.length > 200) {
            return c.json({ error: 'Query is too long (max 200 characters)' }, 400)
        }

        return c.json(await suggestMovies(query))
    } catch (error) {
        console.error('Error fetching suggestions:', error)
        return c.json({ error: 'Failed to fetch suggestions' }, 500)
    }
})

moviesRoute.get('/:id', async (c) => {
    try {
        const id = MovieIdSchema.safeParse(c.req.param('id'))
        if (!id.success) {
            return c.json({ error: 'A valid movie ID is required' }, 400)
        }

        const movieDetails = await getMovieDetails(String(id.data))

        if (!movieDetails) return c.json({ error: 'Failed to fetch movie details' }, 500)

        return c.json(toMovieDetailView(movieDetails, id.data))
    } catch (error) {
        console.error('Error fetching movie details:', error)
        return c.json({ error: 'Failed to fetch movie details' }, 500)
    }
})

// Detail-screen enrichment: cast, director, trailer, where-to-watch, and
// "more like this". One TMDB append_to_response call behind this route. The
// `region` query (default US) selects which country's watch providers to return.
moviesRoute.get('/:id/extras', async (c) => {
    try {
        const id = MovieIdSchema.safeParse(c.req.param('id'))
        if (!id.success) {
            return c.json({ error: 'A valid movie ID is required' }, 400)
        }

        // Normalize to a 2-letter ISO country code; fall back to the default.
        const rawRegion = c.req.query('region')?.trim().toUpperCase()
        const region = rawRegion && /^[A-Z]{2}$/.test(rawRegion) ? rawRegion : DEFAULT_WATCH_REGION

        const extras = await getMovieExtras(String(id.data))

        return c.json(toMovieExtrasView(extras, region))
    } catch (error) {
        console.error('Error fetching movie extras:', error)
        return c.json({ error: 'Failed to fetch movie extras' }, 500)
    }
})

// Spoiler-free AI summary of a movie's audience reviews (for the detail screen).
moviesRoute.get('/:id/summary', async (c) => {
    try {
        const id = MovieIdSchema.safeParse(c.req.param('id'))
        if (!id.success) {
            return c.json({ error: 'A valid movie ID is required' }, 400)
        }

        const summary = await summarizeReviews(id.data)

        return c.json(summary)
    } catch (error) {
        console.error('Error summarizing reviews:', error)
        return c.json({ error: 'Failed to summarize reviews' }, 500)
    }
})

export default moviesRoute
