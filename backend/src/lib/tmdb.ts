import { fetch, redis } from 'bun'
import type { paths } from './../../tmdb'

const TMDB_API_KEY = process.env.TMDB_READ_ACCESS_API_KEY
const TMDB_BASE_URL = 'https://api.themoviedb.org/3'
const TIL_CACHE = 3600

async function fetchFromTMDB<T>(endpoint: string): Promise<T> {
    if (!TMDB_API_KEY) {
        throw new Error('TMDB_API_KEY is not defined')
    }

    const response = await fetch(`${TMDB_BASE_URL}${endpoint}`, {
        method: 'GET',
        headers: {
            accept: 'application/json',
            Authorization: `Bearer ${TMDB_API_KEY}`,
        },
    })

    if (!response.ok) {
        throw new Error(`Failed to fetch from TMDB, ${response.statusText}`)
    }

    return response.json() as Promise<T>
}

type TrendingMoviesResponse =
    paths['/3/trending/all/{time_window}']['get']['responses']['200']['content']['application/json']

export const getTrendingMovies = async () => {
    const cachedKey = 'movies:trending:day'

    const cachedData = await redis.get(cachedKey)

    if (cachedData) {
        console.log('⚡ HIT: Serving Trending Movies from Redis')
        return JSON.parse(cachedData) as TrendingMoviesResponse
    }

    console.log('🐢 MISS: Fetching from TMDB API')

    const trendingMovies = await fetchFromTMDB<TrendingMoviesResponse>(
        '/trending/movie/day?language=en-US',
    )

    await redis.set(cachedKey, JSON.stringify(trendingMovies))

    await redis.expire(cachedKey, TIL_CACHE)

    return trendingMovies.results
}

type SearchMovieResponse =
    paths['/3/search/movie']['get']['responses']['200']['content']['application/json']

export const searchMovie = async (query: string) => {
    const normalizedQuery = query.trim().toLowerCase()

    const cachedKey = `search:${normalizedQuery}`

    const cachedData = await redis.get(cachedKey)

    if (cachedData) {
        console.log('⚡ HIT: Serving Search Results from Redis')
        return JSON.parse(cachedData) as SearchMovieResponse
    }

    console.log(`🐢 MISS: Searching TMDB for "${query}"`)

    const searchResult = await fetchFromTMDB<SearchMovieResponse>(
        `/search/movie?query=${normalizedQuery}&include_adult=false&language=en-US&page=1`,
    )

    await redis.set(cachedKey, JSON.stringify(searchResult))

    await redis.expire(cachedKey, TIL_CACHE)

    return searchResult.results
}

type MovieDetailsResponse =
    paths['/3/movie/{movie_id}']['get']['responses']['200']['content']['application/json']


export const getMovieDetails = async (movieId: string) => {
    const cachedKey = `movie:${movieId}:details`

    const cachedData = await redis.get(cachedKey)

    if (cachedData) {
        console.log('⚡ HIT: Serving Movie Details from Redis')
        return JSON.parse(cachedData) as MovieDetailsResponse
    }

    console.log(`🐢 MISS: Fetching Movie Details from TMDB API for movieId: ${movieId}`)

    const movieDetails = await fetchFromTMDB<MovieDetailsResponse>(
        `/movie/${movieId}?language=en-US`,
    )

    await redis.set(cachedKey, JSON.stringify(movieDetails))

    await redis.expire(cachedKey, TIL_CACHE)

    return movieDetails
}