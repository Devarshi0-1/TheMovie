import { z } from 'zod'

// Shared movie-result + retrieval-tool-input schemas. Defined in the backend
// for now; lifts to `packages/schemas/` in Phase 7.1 alongside the intent
// schema. One definition drives tool input validation (AI SDK), API responses,
// and (later) the frontend.

/** The compact movie shape the retrieval tools return to the agent. */
export const MovieResultSchema = z.object({
    tmdbId: z.number().int(),
    title: z.string(),
    overview: z.string().nullable(),
    releaseDate: z.string().nullable(),
    genres: z.array(z.string()),
    posterPath: z.string().nullable(),
})
export type MovieResult = z.infer<typeof MovieResultSchema>

/** A semantic-search hit, with cosine similarity in [0, 1] (1 = identical). */
export const ScoredMovieResultSchema = MovieResultSchema.extend({
    similarity: z.number(),
})
export type ScoredMovieResult = z.infer<typeof ScoredMovieResultSchema>

/** Full movie details (superset of MovieResult) for the details tool. */
export const MovieDetailsResultSchema = MovieResultSchema.extend({
    tagline: z.string().nullable(),
    runtime: z.number().nullable(),
    voteAverage: z.number().nullable(),
})
export type MovieDetailsResult = z.infer<typeof MovieDetailsResultSchema>

// ── Tool input schemas ───────────────────────────────────────────────────────
// Bounded `limit`s cap fan-out/cost; `.default()` lets the agent omit them.

export const SqlSearchInputSchema = z.object({
    title: z.string().min(1).optional().describe('Exact or partial movie title to match.'),
    genre: z
        .string()
        .min(1)
        .optional()
        .describe('A single genre name, e.g. "Science Fiction", "Horror".'),
    year: z.number().int().min(1880).max(2100).optional().describe('Release year, e.g. 2010.'),
    limit: z.number().int().min(1).max(20).default(10).describe('Max results to return.'),
})
export type SqlSearchInput = z.infer<typeof SqlSearchInputSchema>

export const SemanticSearchInputSchema = z.object({
    query: z
        .string()
        .min(1)
        .describe(
            'A conceptual or thematic description of the movie, e.g. "hero later becomes the villain", "slow-burn dread like Hereditary".',
        ),
    limit: z.number().int().min(1).max(20).default(8).describe('Max results to return.'),
})
export type SemanticSearchInput = z.infer<typeof SemanticSearchInputSchema>

export const FetchFromTmdbInputSchema = z.object({
    query: z.string().min(1).optional().describe('Title/keywords to search TMDB for.'),
    tmdbId: z.number().int().optional().describe('A specific TMDB movie id to fetch.'),
    limit: z.number().int().min(1).max(10).default(3).describe('Max results when searching.'),
})
export type FetchFromTmdbInput = z.infer<typeof FetchFromTmdbInputSchema>

export const MovieDetailsInputSchema = z.object({
    tmdbId: z.number().int().describe('The TMDB movie id to fetch full details for.'),
})
export type MovieDetailsInput = z.infer<typeof MovieDetailsInputSchema>

export const TrendingInputSchema = z.object({
    limit: z.number().int().min(1).max(20).default(10).describe('Max trending movies to return.'),
})
export type TrendingInput = z.infer<typeof TrendingInputSchema>
