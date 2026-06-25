import { redis } from './redis'
import type { paths } from './../../tmdb'

// Use the global `fetch` (Bun provides it) rather than importing it from 'bun',
// and the `./redis` re-export rather than 'bun' directly — both so tests can
// stub the network and cache without mocking the whole 'bun' module.

const TMDB_BASE_URL = 'https://api.themoviedb.org/3'
const TIL_CACHE = 3600

async function fetchFromTMDB<T>(endpoint: string): Promise<T> {
    // Read at call time (not module load) so the key can be provided after
    // import — e.g. via dotenv, or set in tests — rather than captured as
    // `undefined` when the module is first evaluated.
    const apiKey = process.env.TMDB_READ_ACCESS_API_KEY
    if (!apiKey) {
        throw new Error('TMDB_READ_ACCESS_API_KEY is not defined')
    }

    const response = await fetch(`${TMDB_BASE_URL}${endpoint}`, {
        method: 'GET',
        headers: {
            accept: 'application/json',
            Authorization: `Bearer ${apiKey}`,
        },
    })

    if (!response.ok) {
        throw new Error(`Failed to fetch from TMDB, ${response.statusText}`)
    }

    return response.json() as Promise<T>
}

// Cache injected behind a function type so tests pass a fake instead of mocking
// the shared `./redis` module (a global module mock leaks across test files).
export interface TmdbCache {
    get(key: string): Promise<string | null>
    set(key: string, value: string, ttlSeconds: number): Promise<void>
}

const redisCache: TmdbCache = {
    get: (key) => redis.get(key),
    set: async (key, value, ttlSeconds) => {
        await redis.set(key, value, 'EX', ttlSeconds)
    },
}

// Get-or-fetch: return the cached JSON, otherwise fetch, cache (with TTL), return.
const cached = async <T>(
    cache: TmdbCache,
    cacheKey: string,
    fetcher: () => Promise<T>,
): Promise<T> => {
    const hit = await cache.get(cacheKey)
    if (hit) return JSON.parse(hit) as T

    const data = await fetcher()
    await cache.set(cacheKey, JSON.stringify(data), TIL_CACHE)
    return data
}

type TrendingMoviesResponse =
    paths['/3/trending/movie/{time_window}']['get']['responses']['200']['content']['application/json']

type TrendingMovies = NonNullable<TrendingMoviesResponse['results']>

// Returns the trending movies array on BOTH cache hit and miss (the cache
// stores the same `results` array we return, so the shape never differs).
export const getTrendingMovies = (cache: TmdbCache = redisCache): Promise<TrendingMovies> =>
    cached(cache, 'movies:trending:day', async () => {
        const response = await fetchFromTMDB<TrendingMoviesResponse>(
            '/trending/movie/day?language=en-US',
        )
        return response.results ?? []
    })

type SearchMovieResponse =
    paths['/3/search/movie']['get']['responses']['200']['content']['application/json']

type SearchMovies = NonNullable<SearchMovieResponse['results']>

// Returns the search results array on BOTH cache hit and miss (the cache stores
// the same `results` array we return, so the shape never differs). Mirrors the
// getTrendingMovies fix from Phase 0.
export const searchMovie = (
    query: string,
    cache: TmdbCache = redisCache,
): Promise<SearchMovies> => {
    const normalizedQuery = query.trim().toLowerCase()
    return cached(cache, `search:${normalizedQuery}`, async () => {
        const response = await fetchFromTMDB<SearchMovieResponse>(
            `/search/movie?query=${normalizedQuery}&include_adult=false&language=en-US&page=1`,
        )
        return response.results ?? []
    })
}

type MovieDetailsResponse =
    paths['/3/movie/{movie_id}']['get']['responses']['200']['content']['application/json']

export const getMovieDetails = (movieId: string, cache: TmdbCache = redisCache) =>
    cached(cache, `movie:${movieId}:details`, () =>
        fetchFromTMDB<MovieDetailsResponse>(`/movie/${movieId}?language=en-US`),
    )

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

export const discoverMoviePage = async (
    page: number,
    cache: TmdbCache = redisCache,
): Promise<MovieListItem[]> => {
    const data = await cached(cache, `discover:popularity:${page}`, () =>
        fetchFromTMDB<DiscoverMovieResponse>(
            `/discover/movie?include_adult=false&language=en-US&sort_by=popularity.desc&page=${page}`,
        ),
    )
    return data.results ?? []
}

export const getNowPlayingPage = async (
    page: number,
    cache: TmdbCache = redisCache,
): Promise<MovieListItem[]> => {
    const data = await cached(cache, `now_playing:${page}`, () =>
        fetchFromTMDB<NowPlayingResponse>(`/movie/now_playing?language=en-US&page=${page}`),
    )
    return data.results ?? []
}

export const getMovieForIngest = (
    movieId: number,
    cache: TmdbCache = redisCache,
): Promise<MovieForIngest> =>
    cached(cache, `movie:${movieId}:ingest`, () =>
        fetchFromTMDB<MovieForIngest>(
            `/movie/${movieId}?language=en-US&append_to_response=keywords`,
        ),
    )

type MovieReviewsResponse =
    paths['/3/movie/{movie_id}/reviews']['get']['responses']['200']['content']['application/json']

// Returns just the review bodies (the text we summarize). Cached for an hour;
// reviews accrue slowly, so a hit serving the same array on both paths is fine.
export const getMovieReviews = async (
    movieId: number,
    cache: TmdbCache = redisCache,
): Promise<string[]> => {
    const data = await cached(cache, `movie:${movieId}:reviews`, () =>
        fetchFromTMDB<MovieReviewsResponse>(`/movie/${movieId}/reviews?language=en-US&page=1`),
    )
    return (data.results ?? [])
        .map((r) => r.content)
        .filter((c): c is string => typeof c === 'string' && c.trim().length > 0)
}
