import { z } from 'zod'

// Shared watchlist schemas — REST request/response validation, the agent tool
// input, and (later) the frontend. Lifts to `packages/schemas/` in Phase 7.1.

/** Body for adding a movie to the watchlist. */
export const WatchlistAddSchema = z.object({
    movieId: z.number().int().positive(),
    title: z.string().min(1),
    posterPath: z.string().nullable().optional(),
})
export type WatchlistAdd = z.infer<typeof WatchlistAddSchema>

/** A stored watchlist entry returned to clients / the agent. */
export const WatchlistEntrySchema = z.object({
    movieId: z.number().int(),
    title: z.string(),
    posterPath: z.string().nullable(),
    createdAt: z.string(),
})
export type WatchlistEntry = z.infer<typeof WatchlistEntrySchema>

/** Input for the conversational `manage_watchlist` agent tool. */
export const ManageWatchlistInputSchema = z.object({
    action: z.enum(['add', 'remove']).describe('Whether to add or remove the movie.'),
    movieId: z.number().int().positive().describe('The TMDB movie id to add/remove.'),
    title: z
        .string()
        .min(1)
        .optional()
        .describe('The movie title (required when adding so it can be displayed).'),
    posterPath: z.string().nullable().optional().describe('Optional poster path when adding.'),
})
export type ManageWatchlistInput = z.infer<typeof ManageWatchlistInputSchema>
