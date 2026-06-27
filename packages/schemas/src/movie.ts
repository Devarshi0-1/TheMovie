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

/**
 * A movie id from a path param (a string), coerced + validated as a positive
 * integer. One definition for every `/:id` / `/:movieId` route so the rule isn't
 * re-hand-rolled per handler.
 */
export const MovieIdSchema = z.coerce.number().int().positive()

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

// Which embedding(s) the semantic search ranks against. 'plot' searches the
// title/overview/genre vector (what a film is about); 'reception' searches the
// audience-review-summary vector (how audiences received it — "genuinely scary",
// "divisive ending"); 'both' fuses the two rankings (the safe default).
export const SemanticSearchModeSchema = z
    .enum(['plot', 'reception', 'both'])
    .default('both')
    .describe(
        "Which signal to rank against: 'plot' (what the film is about), 'reception' (how audiences received it — emotional impact, praise/criticism), or 'both' (fuse them). Prefer 'reception' or 'both' for queries about audience experience.",
    )
export type SemanticSearchMode = z.infer<typeof SemanticSearchModeSchema>

export const SemanticSearchInputSchema = z.object({
    query: z
        .string()
        .min(1)
        .describe(
            'A conceptual or thematic description of the movie, e.g. "hero later becomes the villain", "slow-burn dread like Hereditary".',
        ),
    limit: z.number().int().min(1).max(20).default(8).describe('Max results to return.'),
    mode: SemanticSearchModeSchema,
})
export type SemanticSearchInput = z.infer<typeof SemanticSearchInputSchema>

export const FetchFromTmdbInputSchema = z.object({
    query: z.string().min(1).optional().describe('Title/keywords to search TMDB for.'),
    // Deliberately NOT `.positive()`: gpt-5 routinely fills this optional field
    // with a `0` placeholder alongside a real `query`. Rejecting 0 at the schema
    // would fail the whole tool call; instead fetchFromTmdb treats a non-positive
    // id as "absent" so the query path wins (see retrieval.ts).
    tmdbId: z.number().int().optional().describe('A specific TMDB movie id to fetch.'),
    limit: z.number().int().min(1).max(10).default(3).describe('Max results when searching.'),
})
export type FetchFromTmdbInput = z.infer<typeof FetchFromTmdbInputSchema>

export const MovieDetailsInputSchema = z.object({
    // Required id → validate positivity at the boundary; a 0/negative is a bug
    // (it 404s against TMDB), so reject it here rather than fetching movie id 0.
    tmdbId: z.number().int().positive().describe('The TMDB movie id to fetch full details for.'),
})
export type MovieDetailsInput = z.infer<typeof MovieDetailsInputSchema>

export const TrendingInputSchema = z.object({
    limit: z.number().int().min(1).max(20).default(10).describe('Max trending movies to return.'),
})
export type TrendingInput = z.infer<typeof TrendingInputSchema>

export const ReviewSummaryInputSchema = z.object({
    tmdbId: z
        .number()
        .int()
        .positive()
        .describe('The TMDB movie id whose audience reviews to summarize.'),
})
export type ReviewSummaryInput = z.infer<typeof ReviewSummaryInputSchema>

// Structured output of the review-summarization model call. Kept deliberately
// small and spoiler-free; the same shape is returned for the no-reviews case.
export const ReviewSummarySchema = z.object({
    vibe: z
        .string()
        .describe(
            'One short, spoiler-free sentence capturing the overall audience consensus/mood.',
        ),
    pros: z
        .array(z.string())
        .describe('Spoiler-free positives audiences mention (up to 5; empty if none).'),
    cons: z
        .array(z.string())
        .describe('Spoiler-free criticisms audiences mention (up to 5; empty if none).'),
})
export type ReviewSummary = z.infer<typeof ReviewSummarySchema>
