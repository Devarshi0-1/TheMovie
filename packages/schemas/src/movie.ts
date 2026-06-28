import { z } from 'zod'

// Shared movie-result + retrieval-tool-input schemas. Defined in the backend
// for now; lifts to `packages/schemas/` in Phase 7.1 alongside the intent
// schema. One definition drives tool input validation (AI SDK), API responses,
// and (later) the frontend.

/** Distinguishes a movie from a TV show on the otherwise-shared display shape. */
export const MediaTypeSchema = z.enum(['movie', 'tv'])
export type MediaType = z.infer<typeof MediaTypeSchema>

/**
 * The compact movie shape the retrieval tools return to the agent and that the
 * list/search endpoints return to the grid. `voteAverage` (TMDB's 0–10 rating)
 * and `backdropPath` are **optional**: the TMDB list mapper populates them so
 * cards can show a rating, but the DB-backed agent retrieval paths omit them
 * (the LLM has no use for a rating, and the rows aren't selected for it).
 *
 * `mediaType` is **optional** and defaults to a movie when absent (the agent /
 * DB paths never set it); the TV endpoints set it to `'tv'` so the frontend can
 * route a card to the right detail page (`/movie/:id` vs `/tv/:id`). For TV the
 * shared fields are filled from the show's analogues — `title`←name,
 * `releaseDate`←first_air_date — so one card/detail UI serves both.
 */
export const MovieResultSchema = z.object({
    tmdbId: z.number().int(),
    title: z.string(),
    overview: z.string().nullable(),
    releaseDate: z.string().nullable(),
    genres: z.array(z.string()),
    posterPath: z.string().nullable(),
    voteAverage: z.number().nullable().optional(),
    backdropPath: z.string().nullable().optional(),
    mediaType: MediaTypeSchema.optional(),
})
export type MovieResult = z.infer<typeof MovieResultSchema>

/** A semantic-search hit, with cosine similarity in [0, 1] (1 = identical). */
export const ScoredMovieResultSchema = MovieResultSchema.extend({
    similarity: z.number(),
})
export type ScoredMovieResult = z.infer<typeof ScoredMovieResultSchema>

/**
 * Cosine-similarity floor below which a semantic (pgvector kNN) hit is treated
 * as junk rather than a real match. kNN always returns the nearest K rows even
 * when "nearest" is poor, so a thin or off-topic catalog would otherwise surface
 * irrelevant titles. Shared so the backend (drops sub-floor hits from retrieval,
 * which also makes the agent escalate when nothing clears it) and the frontend
 * (never renders a sub-floor result as a suggestion card) use one number.
 * Deliberately conservative — it removes clear noise, not borderline matches;
 * "titles like <a specific show/film>" is better served by the curated TMDB
 * recommendation tools than by raising this floor.
 */
export const SEMANTIC_MATCH_FLOOR = 0.2

/**
 * The multi-suggest payload: typeahead matches split into Movies and TV Shows
 * groups (the response shape of `GET /api/v1/search/suggest`). Each group is an
 * independent, already-deduped, already-capped `MovieResult[]` carrying its own
 * `mediaType`, so the search UI can render two labelled sections and route each
 * card to `/movie/:id` or `/tv/:id`.
 */
export const GroupedSuggestionsSchema = z.object({
    movies: z.array(MovieResultSchema),
    tv: z.array(MovieResultSchema),
})
export type GroupedSuggestions = z.infer<typeof GroupedSuggestionsSchema>

/** Full movie details (superset of MovieResult) for the details tool. */
export const MovieDetailsResultSchema = MovieResultSchema.extend({
    tagline: z.string().nullable(),
    runtime: z.number().nullable(),
    voteAverage: z.number().nullable(),
})
export type MovieDetailsResult = z.infer<typeof MovieDetailsResultSchema>

/**
 * The detail-screen view model: movie details plus a backdrop for the hero
 * image. This is the response shape of `GET /api/v1/movies/:id` — the backend
 * maps TMDB's raw payload onto it so the frontend never sees snake_case. (The
 * agent's `get_movie_details` tool stays on `MovieDetailsResult`, which has no
 * use for a backdrop.)
 */
export const MovieDetailViewSchema = MovieDetailsResultSchema.extend({
    backdropPath: z.string().nullable(),
})
export type MovieDetailView = z.infer<typeof MovieDetailViewSchema>

/**
 * A movie id from a path param (a string), coerced + validated as a positive
 * integer. One definition for every `/:id` / `/:movieId` route so the rule isn't
 * re-hand-rolled per handler.
 */
export const MovieIdSchema = z.coerce.number().int().positive()

// ── Movie extras (cast, trailer, where-to-watch, recommendations) ────────────
// The detail screen's enrichment payload (`GET /api/v1/movies/:id/extras`). One
// TMDB call (append_to_response) feeds all four; the backend maps the raw
// snake_case onto these so the frontend only validates.

/** A top-billed cast member. `profilePath` is a TMDB image path (or null). */
export const CastMemberSchema = z.object({
    id: z.number().int(),
    name: z.string(),
    character: z.string().nullable(),
    profilePath: z.string().nullable(),
})
export type CastMember = z.infer<typeof CastMemberSchema>

/** A trailer/teaser video — always a YouTube `key` the client embeds. */
export const MovieVideoSchema = z.object({
    key: z.string(),
    name: z.string(),
    site: z.string(),
    type: z.string(),
})
export type MovieVideo = z.infer<typeof MovieVideoSchema>

/** A streaming/rent/buy provider (JustWatch data via TMDB). */
export const WatchProviderSchema = z.object({
    id: z.number().int(),
    name: z.string(),
    logoPath: z.string().nullable(),
})
export type WatchProvider = z.infer<typeof WatchProviderSchema>

/** Where-to-watch for one region, split by offer type. */
export const WatchProvidersSchema = z.object({
    region: z.string(),
    link: z.string().nullable(),
    flatrate: z.array(WatchProviderSchema),
    rent: z.array(WatchProviderSchema),
    buy: z.array(WatchProviderSchema),
})
export type WatchProviders = z.infer<typeof WatchProvidersSchema>

/** The aggregate extras payload for the detail screen. Any field can be empty/null. */
export const MovieExtrasSchema = z.object({
    cast: z.array(CastMemberSchema),
    director: z.string().nullable(),
    trailer: MovieVideoSchema.nullable(),
    watchProviders: WatchProvidersSchema.nullable(),
    recommendations: z.array(MovieResultSchema),
})
export type MovieExtras = z.infer<typeof MovieExtrasSchema>

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

export const FindMoviesByPersonInputSchema = z.object({
    name: z
        .string()
        .min(1)
        .describe('A person’s name — an actor or director, e.g. "Christopher Nolan", "Zendaya".'),
    limit: z.number().int().min(1).max(20).default(10).describe('Max movies to return.'),
})
export type FindMoviesByPersonInput = z.infer<typeof FindMoviesByPersonInputSchema>

export const WatchProvidersInputSchema = z.object({
    tmdbId: z
        .number()
        .int()
        .positive()
        .describe('The TMDB movie id to look up streaming/rent/buy options for.'),
    region: z
        .string()
        .length(2)
        .optional()
        .describe('ISO 3166-1 country code, e.g. "US", "GB". Defaults to US.'),
})
export type WatchProvidersInput = z.infer<typeof WatchProvidersInputSchema>

export const SimilarMoviesInputSchema = z.object({
    tmdbId: z
        .number()
        .int()
        .positive()
        .describe('The TMDB movie id to find similar / recommended movies for.'),
    limit: z.number().int().min(1).max(20).default(10).describe('Max movies to return.'),
})
export type SimilarMoviesInput = z.infer<typeof SimilarMoviesInputSchema>

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
