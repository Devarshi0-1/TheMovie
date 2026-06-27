import { queryOptions } from '@tanstack/react-query'
import {
    MovieDetailViewSchema,
    MovieExtrasSchema,
    MovieResultSchema,
    ReviewSummarySchema,
    type MovieDetailView,
    type MovieExtras,
    type MovieResult,
    type ReviewSummary,
} from '@themovie/schemas'
import { z } from 'zod'
import { apiFetch } from './api'

// The frontend validates every movie payload it receives against the SAME Zod
// schema the backend uses for API responses and AI tool I/O. One definition in
// `@themovie/schemas` → end-to-end type safety. This module is the single place
// the rest of the app reaches for movie parsing + display helpers.

export const MovieListSchema = z.array(MovieResultSchema)

/** Validate an unknown payload as a single movie. Throws on mismatch. */
export function parseMovie(input: unknown): MovieResult {
    return MovieResultSchema.parse(input)
}

/** Validate an unknown payload as a list of movies. Throws on mismatch. */
export function parseMovies(input: unknown): MovieResult[] {
    return MovieListSchema.parse(input)
}

export type ParseResult = { ok: true; movie: MovieResult } | { ok: false; error: string }

/**
 * Non-throwing variant for UI boundaries that must degrade gracefully rather
 * than crash a render when the server returns something unexpected.
 */
export function safeParseMovie(input: unknown): ParseResult {
    const result = MovieResultSchema.safeParse(input)
    if (result.success) return { ok: true, movie: result.data }
    const error = result.error.issues
        .map((issue) => `${issue.path.join('.') || '(root)'}: ${issue.message}`)
        .join('; ')
    return { ok: false, error }
}

/** The release year for display, or an em dash when the date is missing. */
export function releaseYear(movie: MovieResult): string {
    if (!movie.releaseDate) return '—'
    return movie.releaseDate.slice(0, 4)
}

// ── Live movie queries (TanStack Query) ─────────────────────────────────────
// The movie endpoints now return the shared camelCase shapes (the backend maps
// TMDB → `MovieResult` / `MovieDetailView`), so every queryFn just validates the
// response against the shared schema. Trending is SSR-prefetched in the
// discovery route loader; the rest resolve on demand.

export async function fetchTrending(): Promise<MovieResult[]> {
    return parseMovies(await apiFetch('/api/v1/movies/trending'))
}

export const trendingMoviesQueryOptions = queryOptions({
    queryKey: ['movies', 'trending'] as const,
    queryFn: fetchTrending,
})

export async function searchMovies(query: string): Promise<MovieResult[]> {
    return parseMovies(await apiFetch(`/api/v1/movies/search?q=${encodeURIComponent(query)}`))
}

export function searchMoviesQueryOptions(query: string) {
    const q = query.trim()
    return queryOptions({
        queryKey: ['movies', 'search', q] as const,
        queryFn: () => searchMovies(q),
        // No query → no request; the discovery grid falls back to trending.
        enabled: q.length > 0,
    })
}

export async function fetchMovieDetails(id: number): Promise<MovieDetailView> {
    return MovieDetailViewSchema.parse(await apiFetch(`/api/v1/movies/${id}`))
}

export function movieDetailsQueryOptions(id: number) {
    return queryOptions({
        queryKey: ['movies', 'details', id] as const,
        queryFn: () => fetchMovieDetails(id),
        // Movie details are effectively immutable; don't refetch on revisit.
        staleTime: Infinity,
    })
}

export async function fetchMovieExtras(id: number): Promise<MovieExtras> {
    return MovieExtrasSchema.parse(await apiFetch(`/api/v1/movies/${id}/extras`))
}

export function movieExtrasQueryOptions(id: number) {
    return queryOptions({
        queryKey: ['movies', 'extras', id] as const,
        queryFn: () => fetchMovieExtras(id),
        // Cast/trailer/providers are near-immutable and cached server-side; the
        // detail page degrades gracefully if they fail, so don't refetch eagerly.
        staleTime: 60 * 60_000,
    })
}

export async function fetchMovieSummary(id: number): Promise<ReviewSummary> {
    return ReviewSummarySchema.parse(await apiFetch(`/api/v1/movies/${id}/summary`))
}

export function movieSummaryQueryOptions(id: number) {
    return queryOptions({
        queryKey: ['movies', 'summary', id] as const,
        queryFn: () => fetchMovieSummary(id),
        // Summaries are an LLM call cached server-side for days; don't refetch eagerly.
        staleTime: 60 * 60_000,
    })
}

// A small, schema-valid sample retained for tests and as a typed fixture.
export const SAMPLE_FEATURED: MovieResult[] = parseMovies([
    {
        tmdbId: 27205,
        title: 'Inception',
        overview:
            'A thief who steals corporate secrets through dream-sharing technology is given the inverse task of planting an idea into the mind of a C.E.O.',
        releaseDate: '2010-07-16',
        genres: ['Action', 'Science Fiction', 'Adventure'],
        posterPath: '/oYuLEt3zVCKq57qu2F8dT7NIa6f.jpg',
    },
    {
        tmdbId: 49026,
        title: 'The Dark Knight Rises',
        overview:
            'Eight years after the Joker’s reign of anarchy, Batman is forced from his exile to save Gotham City from the brutal guerrilla terrorist Bane.',
        releaseDate: '2012-07-16',
        genres: ['Action', 'Crime', 'Drama', 'Thriller'],
        posterPath: '/85cWkCVftiVs0BVey6pxX8uNmLt.jpg',
    },
    {
        tmdbId: 157336,
        title: 'Interstellar',
        overview:
            'The adventures of a group of explorers who make use of a newly discovered wormhole to surpass the limitations on human space travel.',
        releaseDate: '2014-11-05',
        genres: ['Adventure', 'Drama', 'Science Fiction'],
        posterPath: '/gEU2QniE6E77NI6lCU6MxlNBvIx.jpg',
    },
])
