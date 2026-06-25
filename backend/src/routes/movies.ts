import { Hono } from 'hono'
import { getMovieDetails, getTrendingMovies, searchMovie } from '../lib/tmdb'
import { summarizeReviews } from '../lib/summary'

const moviesRoute = new Hono()

moviesRoute.get('/trending', async (c) => {
    try {
        const trendingMovies = await getTrendingMovies()

        if (!trendingMovies) {
            return c.json({ error: 'Failed to fetch trending movies' }, 500)
        }

        return c.json(trendingMovies)
    } catch (error) {
        console.error('Error fetching trending movies:', error)
        return c.json({ error: 'Failed to fetch trending movies' }, 500)
    }
})

moviesRoute.get('/search', async (c) => {
    try {
        const query = c.req.query('q')

        if (!query) {
            return c.json({ error: 'Query parameter is required' }, 400)
        }

        const searchResults = await searchMovie(query)

        if (!searchResults) {
            return c.json({ error: 'Failed to fetch search results' }, 500)
        }

        return c.json(searchResults)
    } catch (error) {
        console.error('Error searching movies:', error)
        return c.json({ error: 'Failed to fetch search results' }, 500)
    }
})

moviesRoute.get('/:id', async (c) => {
    try {
        const movieId = c.req.param('id')

        if (!movieId) return c.json({ error: 'Movie ID is required' }, 400)

        const movieDetails = await getMovieDetails(movieId)

        if (!movieDetails) return c.json({ error: 'Failed to fetch movie details' }, 500)

        return c.json(movieDetails)
    } catch (error) {
        console.error('Error fetching movie details:', error)
        return c.json({ error: 'Failed to fetch movie details' }, 500)
    }
})

// Spoiler-free AI summary of a movie's audience reviews (for the detail screen).
moviesRoute.get('/:id/summary', async (c) => {
    try {
        const movieId = Number(c.req.param('id'))

        if (!Number.isInteger(movieId) || movieId <= 0) {
            return c.json({ error: 'A valid movie ID is required' }, 400)
        }

        const summary = await summarizeReviews(movieId)

        return c.json(summary)
    } catch (error) {
        console.error('Error summarizing reviews:', error)
        return c.json({ error: 'Failed to summarize reviews' }, 500)
    }
})

export default moviesRoute
