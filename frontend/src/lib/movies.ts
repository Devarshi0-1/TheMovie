import { MovieResultSchema, type MovieResult } from '@themovie/schemas'
import { z } from 'zod'

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

// A small, schema-valid sample so the scaffold landing page renders real,
// validated data with no backend wired up yet (Phase 7.2 swaps this for live
// `GET /api/v1/movies/...` calls through TanStack Query).
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
