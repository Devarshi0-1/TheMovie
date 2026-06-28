import { redis } from './redis'
import type { paths } from './../../tmdb'

// Use the global `fetch` (Bun provides it) rather than importing it from 'bun',
// and the `./redis` re-export rather than 'bun' directly — both so tests can
// stub the network and cache without mocking the whole 'bun' module.

const TMDB_BASE_URL = 'https://api.themoviedb.org/3'
const TIL_CACHE = 3600

// TMDB's edge intermittently resets connections from some networks (`fetch`
// rejects, e.g. ECONNRESET) and occasionally returns transient 5xx/429s. Retry
// those a few times with exponential backoff so one flaky attempt doesn't fail
// the request; the Redis cache layer above then reuses the eventual hit. Other
// 4xx (bad request, 404) are NOT retried — a retry can't fix them.
const TMDB_MAX_RETRIES = 3
const TMDB_RETRY_BASE_MS = 200

// Real backoff sleep; injectable so tests exercise the retry loop without waiting.
const realSleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms))

export interface FetchRetryOptions {
    maxRetries?: number
    baseDelayMs?: number
    sleep?: (ms: number) => Promise<void>
}

// Worth retrying: transient server errors (5xx) and rate limits (429).
const isRetryableStatus = (status: number): boolean => status >= 500 || status === 429

export async function fetchFromTMDB<T>(
    endpoint: string,
    options: FetchRetryOptions = {},
): Promise<T> {
    // Read at call time (not module load) so the key can be provided after
    // import — e.g. via dotenv, or set in tests — rather than captured as
    // `undefined` when the module is first evaluated.
    const apiKey = process.env.TMDB_READ_ACCESS_API_KEY
    if (!apiKey) {
        throw new Error('TMDB_READ_ACCESS_API_KEY is not defined')
    }

    const maxRetries = options.maxRetries ?? TMDB_MAX_RETRIES
    const baseDelayMs = options.baseDelayMs ?? TMDB_RETRY_BASE_MS
    const sleep = options.sleep ?? realSleep

    let lastError: unknown
    for (let attempt = 0; attempt <= maxRetries; attempt++) {
        let response: Response
        try {
            response = await fetch(`${TMDB_BASE_URL}${endpoint}`, {
                method: 'GET',
                headers: {
                    accept: 'application/json',
                    Authorization: `Bearer ${apiKey}`,
                },
            })
        } catch (err) {
            // Network-level failure (e.g. ECONNRESET): `fetch` rejected before a
            // response arrived. Back off and retry; rethrow once the budget runs out.
            lastError = err
            if (attempt < maxRetries) {
                await sleep(baseDelayMs * 2 ** attempt)
                continue
            }
            throw err
        }

        if (response.ok) {
            return response.json() as Promise<T>
        }

        // Retry transient server errors / rate limits; surface other 4xx now.
        if (isRetryableStatus(response.status) && attempt < maxRetries) {
            lastError = new Error(`TMDB ${response.status} ${response.statusText}`)
            await sleep(baseDelayMs * 2 ** attempt)
            continue
        }

        throw new Error(`Failed to fetch from TMDB, ${response.statusText}`)
    }

    // The loop always returns or throws above; this only guards a misconfigured
    // negative maxRetries and keeps the type checker happy.
    throw (lastError as Error | undefined) ?? new Error('Failed to fetch from TMDB')
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

// Detail-screen enrichment: cast/crew, videos, recommendations, and where-to-watch
// in ONE TMDB request via append_to_response (cheaper than four round-trips, one
// cache entry). The combined payload is mapped to `MovieExtras` by `movieView`.
export type MovieExtrasResponse = MovieDetailsResponse & {
    credits?: {
        cast?: {
            id?: number
            name?: string
            character?: string | null
            profile_path?: string | null
        }[]
        crew?: { name?: string; job?: string }[]
    }
    videos?: {
        results?: {
            key?: string
            name?: string
            site?: string
            type?: string
            official?: boolean
        }[]
    }
    recommendations?: { results?: MovieListItem[] }
    'watch/providers'?: {
        results?: Record<
            string,
            {
                link?: string | null
                flatrate?: {
                    provider_id?: number
                    provider_name?: string
                    logo_path?: string | null
                }[]
                rent?: { provider_id?: number; provider_name?: string; logo_path?: string | null }[]
                buy?: { provider_id?: number; provider_name?: string; logo_path?: string | null }[]
            }
        >
    }
}

export const getMovieExtras = (
    movieId: string,
    cache: TmdbCache = redisCache,
): Promise<MovieExtrasResponse> =>
    cached(cache, `movie:${movieId}:extras`, () =>
        fetchFromTMDB<MovieExtrasResponse>(
            `/movie/${movieId}?language=en-US&append_to_response=credits,videos,recommendations,watch/providers`,
        ),
    )

// ── TV shows ─────────────────────────────────────────────────────────────────
// TV mirrors the movie endpoints (trending / search / details / extras) but on
// TMDB's `/tv/*` routes. Served purely as a TMDB proxy — TV is NOT ingested or
// embedded (that's the costly path), so there's no DB/agent involvement here.
// Shapes are kept local + loose (the mappers in movieView read defensively),
// rather than threading the huge generated `paths` types through.

export interface TvListItem {
    id?: number
    name?: string | null
    overview?: string | null
    first_air_date?: string | null
    poster_path?: string | null
    backdrop_path?: string | null
    genre_ids?: number[] | null
    vote_average?: number | null
}

export interface TvDetailsResponse {
    id?: number
    name?: string | null
    overview?: string | null
    first_air_date?: string | null
    poster_path?: string | null
    backdrop_path?: string | null
    genres?: { id?: number; name?: string }[] | null
    tagline?: string | null
    vote_average?: number | null
    episode_run_time?: number[] | null
    number_of_seasons?: number | null
    number_of_episodes?: number | null
}

export type TvExtrasResponse = TvDetailsResponse & {
    credits?: {
        cast?: {
            id?: number
            name?: string
            character?: string | null
            profile_path?: string | null
        }[]
        crew?: { name?: string; job?: string }[]
    }
    videos?: {
        results?: {
            key?: string
            name?: string
            site?: string
            type?: string
            official?: boolean
        }[]
    }
    recommendations?: { results?: TvListItem[] }
    'watch/providers'?: {
        results?: Record<
            string,
            {
                link?: string | null
                flatrate?: {
                    provider_id?: number
                    provider_name?: string
                    logo_path?: string | null
                }[]
                rent?: { provider_id?: number; provider_name?: string; logo_path?: string | null }[]
                buy?: { provider_id?: number; provider_name?: string; logo_path?: string | null }[]
            }
        >
    }
}

export const getTrendingTv = (cache: TmdbCache = redisCache): Promise<TvListItem[]> =>
    cached(cache, 'tv:trending:day', async () => {
        const response = await fetchFromTMDB<{ results?: TvListItem[] }>(
            '/trending/tv/day?language=en-US',
        )
        return response.results ?? []
    })

export const searchTv = (query: string, cache: TmdbCache = redisCache): Promise<TvListItem[]> => {
    const normalizedQuery = query.trim().toLowerCase()
    return cached(cache, `tv:search:${normalizedQuery}`, async () => {
        const response = await fetchFromTMDB<{ results?: TvListItem[] }>(
            `/search/tv?query=${encodeURIComponent(normalizedQuery)}&include_adult=false&language=en-US&page=1`,
        )
        return response.results ?? []
    })
}

export const getTvDetails = (
    tvId: string,
    cache: TmdbCache = redisCache,
): Promise<TvDetailsResponse> =>
    cached(cache, `tv:${tvId}:details`, () =>
        fetchFromTMDB<TvDetailsResponse>(`/tv/${tvId}?language=en-US`),
    )

export const getTvExtras = (
    tvId: string,
    cache: TmdbCache = redisCache,
): Promise<TvExtrasResponse> =>
    cached(cache, `tv:${tvId}:extras`, () =>
        fetchFromTMDB<TvExtrasResponse>(
            `/tv/${tvId}?language=en-US&append_to_response=credits,videos,recommendations,watch/providers`,
        ),
    )

// ── TV ingestion (Phase 10 — TV as first-class) ──────────────────────────────
// The TV mirror of the movie ingest fetchers. `/discover/tv` (popularity-ordered)
// seeds the catalog; `/tv/popular` is the "fresh" incremental feed (TV has no
// "now playing"); the detail call appends keywords in one request. Genres arrive
// as `{ id, name }[]` here, and keywords nest under `keywords.results` on the TV
// endpoint (movies use `keywords.keywords`). These feed the ingestion pipeline,
// not the live proxy — so unlike the proxy reads above, they ARE persisted.

export type TvForIngest = TvDetailsResponse & {
    keywords?: { results?: { id?: number; name?: string }[] }
}

export const discoverTvPage = async (
    page: number,
    cache: TmdbCache = redisCache,
): Promise<TvListItem[]> => {
    const data = await cached(cache, `discover:tv:popularity:${page}`, () =>
        fetchFromTMDB<{ results?: TvListItem[] }>(
            `/discover/tv?include_adult=false&language=en-US&sort_by=popularity.desc&page=${page}`,
        ),
    )
    return data.results ?? []
}

export const getPopularTvPage = async (
    page: number,
    cache: TmdbCache = redisCache,
): Promise<TvListItem[]> => {
    const data = await cached(cache, `tv:popular:${page}`, () =>
        fetchFromTMDB<{ results?: TvListItem[] }>(`/tv/popular?language=en-US&page=${page}`),
    )
    return data.results ?? []
}

export const getTvForIngest = (tvId: number, cache: TmdbCache = redisCache): Promise<TvForIngest> =>
    cached(cache, `tv:${tvId}:ingest`, () =>
        fetchFromTMDB<TvForIngest>(`/tv/${tvId}?language=en-US&append_to_response=keywords`),
    )

// ── Person lookups (Phase 9 — "movies starring X") ───────────────────────────
// Find a person by name, then pull their movie filmography. Powers the agent's
// find_movies_by_person tool. Both are cached like everything else.

type SearchPersonResponse =
    paths['/3/search/person']['get']['responses']['200']['content']['application/json']
type PersonMovieCreditsResponse =
    paths['/3/person/{person_id}/movie_credits']['get']['responses']['200']['content']['application/json']

export type PersonSearchResult = NonNullable<SearchPersonResponse['results']>[number]
export type PersonMovieCredits = PersonMovieCreditsResponse

export const searchPerson = (
    query: string,
    cache: TmdbCache = redisCache,
): Promise<PersonSearchResult[]> =>
    cached(cache, `person:search:${query.trim().toLowerCase()}`, async () => {
        const response = await fetchFromTMDB<SearchPersonResponse>(
            `/search/person?query=${encodeURIComponent(query)}&include_adult=false&language=en-US&page=1`,
        )
        return response.results ?? []
    })

export const getPersonMovieCredits = (
    personId: number,
    cache: TmdbCache = redisCache,
): Promise<PersonMovieCredits> =>
    cached(cache, `person:${personId}:movie_credits`, () =>
        fetchFromTMDB<PersonMovieCreditsResponse>(
            `/person/${personId}/movie_credits?language=en-US`,
        ),
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

// Browse movies of a single genre, popularity-ordered (powers the Discover
// genre filter). A TMDB-proxy read like trending/search — no ingestion.
export const discoverMoviesByGenre = async (
    genreId: number,
    cache: TmdbCache = redisCache,
): Promise<MovieListItem[]> => {
    const data = await cached(cache, `discover:genre:${genreId}`, () =>
        fetchFromTMDB<DiscoverMovieResponse>(
            `/discover/movie?include_adult=false&language=en-US&sort_by=popularity.desc&with_genres=${genreId}&page=1`,
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

/**
 * Review bodies (the text we summarize) plus `totalResults` — TMDB's count of
 * ALL reviews for the movie, not just this page. The count is the refresh job's
 * change trigger: if it hasn't moved since the last summary, the reviews are
 * effectively unchanged and we skip re-summarizing (a cost rule). One cached
 * call serves both — reviews accrue slowly, so the hour TTL is plenty.
 */
export const getMovieReviewMeta = async (
    movieId: number,
    cache: TmdbCache = redisCache,
): Promise<{ totalResults: number; reviews: string[] }> => {
    const data = await cached(cache, `movie:${movieId}:reviews`, () =>
        fetchFromTMDB<MovieReviewsResponse>(`/movie/${movieId}/reviews?language=en-US&page=1`),
    )
    const reviews = (data.results ?? [])
        .map((r) => r.content)
        .filter((c): c is string => typeof c === 'string' && c.trim().length > 0)
    return { totalResults: data.total_results ?? reviews.length, reviews }
}

// Returns just the review bodies (the text we summarize).
export const getMovieReviews = async (
    movieId: number,
    cache: TmdbCache = redisCache,
): Promise<string[]> => (await getMovieReviewMeta(movieId, cache)).reviews
