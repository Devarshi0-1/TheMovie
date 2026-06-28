import { z } from 'zod'
import { MediaTypeSchema } from './movie'

// Shared watchlist schemas — REST request/response validation, the agent tool
// input, and (later) the frontend. Lifts to `packages/schemas/` in Phase 7.1.
//
// `movieId` holds a TMDB id; since TMDB namespaces ids by media type (movie 1396
// ≠ tv 1396), every entry also carries a `mediaType` discriminator. It defaults
// to 'movie' on input so existing movie clients keep working unchanged (Phase
// 10.3).

/** Body for adding a movie/show to the watchlist. */
export const WatchlistAddSchema = z.object({
    movieId: z.number().int().positive(),
    title: z.string().min(1),
    posterPath: z.string().nullable().optional(),
    mediaType: MediaTypeSchema.default('movie'),
})
export type WatchlistAdd = z.infer<typeof WatchlistAddSchema>

/** A stored watchlist entry returned to clients / the agent. */
export const WatchlistEntrySchema = z.object({
    movieId: z.number().int(),
    title: z.string(),
    posterPath: z.string().nullable(),
    mediaType: MediaTypeSchema,
    createdAt: z.string(),
})
export type WatchlistEntry = z.infer<typeof WatchlistEntrySchema>

// ── REST response shapes ─────────────────────────────────────────────────────
// Returned by the watchlist endpoints and validated on the frontend, so the
// contract lives in one place rather than being re-derived per consumer.

/** `GET /watchlist/:id/status` — whether the movie is on the user's list. */
export const WatchlistStatusSchema = z.object({ inWatchlist: z.boolean() })
export type WatchlistStatus = z.infer<typeof WatchlistStatusSchema>

/** `POST /watchlist` — the idempotent add result. */
export const WatchlistAddResultSchema = z.object({
    added: z.boolean(),
    movieId: z.number().int(),
    mediaType: MediaTypeSchema,
})
export type WatchlistAddResult = z.infer<typeof WatchlistAddResultSchema>

/** `DELETE /watchlist/:id` — the idempotent remove result. */
export const WatchlistRemoveResultSchema = z.object({
    removed: z.boolean(),
    movieId: z.number().int(),
    mediaType: MediaTypeSchema,
})
export type WatchlistRemoveResult = z.infer<typeof WatchlistRemoveResultSchema>

/** One movie or show in a `manage_watchlist` proposal. */
export const ManageWatchlistMovieSchema = z.object({
    movieId: z.number().int().positive().describe('The TMDB movie/show id to add/remove.'),
    title: z
        .string()
        .min(1)
        .optional()
        .describe('The movie/show title (required when adding so it can be displayed).'),
    posterPath: z.string().nullable().optional().describe('Optional poster path when adding.'),
    // TMDB namespaces ids by media type, so each item carries its own
    // discriminator; defaults to 'movie' so movie-only proposals stay unchanged.
    mediaType: MediaTypeSchema.default('movie').describe(
        "Set to 'tv' when this entry is a TV show, otherwise 'movie' (the default).",
    ),
})
export type ManageWatchlistMovie = z.infer<typeof ManageWatchlistMovieSchema>

/**
 * Input for the conversational `manage_watchlist` agent tool. Batched: ONE call
 * carries every movie to change, so the user confirms a multi-movie change once
 * instead of approving each film individually.
 */
export const ManageWatchlistInputSchema = z.object({
    action: z.enum(['add', 'remove']).describe('Whether to add or remove the movies.'),
    movies: z
        .array(ManageWatchlistMovieSchema)
        .min(1)
        .describe(
            'Every movie to add or remove in this single confirmation. Include ALL of them ' +
                'here — never call the tool once per movie.',
        ),
})
export type ManageWatchlistInput = z.infer<typeof ManageWatchlistInputSchema>
