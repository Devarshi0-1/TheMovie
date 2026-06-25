import { redis } from './redis'
import type { paths } from './../../tmdb'

// Use the global `fetch` (Bun provides it) rather than importing it from 'bun',
// and the `./redis` re-export rather than 'bun' directly — both so tests can
// stub the network and cache without mocking the whole 'bun' module.

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
    paths['/3/trending/movie/{time_window}']['get']['responses']['200']['content']['application/json']

type TrendingMovies = NonNullable<TrendingMoviesResponse['results']>

// Returns the trending movies array on BOTH cache hit and miss (the cache
// stores the same `results` array we return, so the shape never differs).
export const getTrendingMovies = async (): Promise<TrendingMovies> => {
    const cachedKey = 'movies:trending:day'

    const cachedData = await redis.get(cachedKey)

    if (cachedData) {
        console.log('⚡ HIT: Serving Trending Movies from Redis')
        return JSON.parse(cachedData) as TrendingMovies
    }

    console.log('🐢 MISS: Fetching from TMDB API')

    const trendingMovies = await fetchFromTMDB<TrendingMoviesResponse>(
        '/trending/movie/day?language=en-US',
    )

    const results = trendingMovies.results ?? []

    await redis.set(cachedKey, JSON.stringify(results))
    await redis.expire(cachedKey, TIL_CACHE)

    return results
}

type SearchMovieResponse =
    paths['/3/search/movie']['get']['responses']['200']['content']['application/json']

type SearchMovies = NonNullable<SearchMovieResponse['results']>

// Returns the search results array on BOTH cache hit and miss (the cache stores
// the same `results` array we return, so the shape never differs). Mirrors the
// getTrendingMovies fix from Phase 0.
export const searchMovie = async (query: string): Promise<SearchMovies> => {
    const normalizedQuery = query.trim().toLowerCase()

    const cachedKey = `search:${normalizedQuery}`

    const cachedData = await redis.get(cachedKey)

    if (cachedData) {
        console.log('⚡ HIT: Serving Search Results from Redis')
        return JSON.parse(cachedData) as SearchMovies
    }

    console.log(`🐢 MISS: Searching TMDB for "${query}"`)

    const searchResult = await fetchFromTMDB<SearchMovieResponse>(
        `/search/movie?query=${normalizedQuery}&include_adult=false&language=en-US&page=1`,
    )

    const results = searchResult.results ?? []

    await redis.set(cachedKey, JSON.stringify(results))

    await redis.expire(cachedKey, TIL_CACHE)

    return results
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

// ── Ingestion catalog endpoints (Phase 3.3) ──────────────────────────────────
// Paginated catalog feeds the ingestion pipeline reads to discover movies to
// embed. Backfill seeds from `/discover/movie` (popularity-ordered); the
// incremental mode pulls fresh releases from `/movie/now_playing`.

type DiscoverMovieResponse =
    paths['/3/discover/movie']['get']['responses']['200']['content']['application/json']
type NowPlayingResponse =
    paths['/3/movie/now_playing']['get']['responses']['200']['content']['application/json']

export type MovieListItem = NonNullable<DiscoverMovieResponse['results']>[number]

// Detail call enriched with keywords in a single request (append_to_response).
// Genres arrive as `{ id, name }[]` here (the list endpoints only give numeric
// `genre_ids`), and keywords come nested under `keywords.keywords`.
export type MovieForIngest = MovieDetailsResponse & {
    keywords?: { keywords?: { id?: number; name?: string }[] }
}

const cacheList = async <T>(cacheKey: string, fetcher: () => Promise<T>): Promise<T> => {
    const cachedData = await redis.get(cacheKey)
    if (cachedData) return JSON.parse(cachedData) as T

    const data = await fetcher()
    await redis.set(cacheKey, JSON.stringify(data))
    await redis.expire(cacheKey, TIL_CACHE)
    return data
}

export const discoverMoviePage = async (page: number): Promise<MovieListItem[]> => {
    const data = await cacheList(`discover:popularity:${page}`, () =>
        fetchFromTMDB<DiscoverMovieResponse>(
            `/discover/movie?include_adult=false&language=en-US&sort_by=popularity.desc&page=${page}`,
        ),
    )
    return data.results ?? []
}

export const getNowPlayingPage = async (page: number): Promise<MovieListItem[]> => {
    const data = await cacheList(`now_playing:${page}`, () =>
        fetchFromTMDB<NowPlayingResponse>(`/movie/now_playing?language=en-US&page=${page}`),
    )
    return data.results ?? []
}

export const getMovieForIngest = async (movieId: number): Promise<MovieForIngest> =>
    cacheList(`movie:${movieId}:ingest`, () =>
        fetchFromTMDB<MovieForIngest>(
            `/movie/${movieId}?language=en-US&append_to_response=keywords`,
        ),
    )

type MovieReviewsResponse =
    paths['/3/movie/{movie_id}/reviews']['get']['responses']['200']['content']['application/json']

// Returns just the review bodies (the text we summarize). Cached for an hour;
// reviews accrue slowly, so a hit serving the same array on both paths is fine.
export const getMovieReviews = async (movieId: number): Promise<string[]> => {
    const data = await cacheList(`movie:${movieId}:reviews`, () =>
        fetchFromTMDB<MovieReviewsResponse>(`/movie/${movieId}/reviews?language=en-US&page=1`),
    )
    return (data.results ?? [])
        .map((r) => r.content)
        .filter((c): c is string => typeof c === 'string' && c.trim().length > 0)
}
