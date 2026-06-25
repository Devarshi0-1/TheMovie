import { z } from 'zod'

// Shared review schemas — REST request/response + (later) the frontend form.
// Lifts to `packages/schemas/` in Phase 7.1.

/** Body for creating/updating a user's review of a movie. */
export const ReviewInputSchema = z.object({
    movieId: z.number().int().positive(),
    rating: z.number().int().min(1).max(10).nullable().optional(),
    content: z.string().min(1).max(5000),
})
export type ReviewInput = z.infer<typeof ReviewInputSchema>

/** A stored review returned to clients. */
export const ReviewEntrySchema = z.object({
    id: z.string(),
    userId: z.string(),
    movieId: z.number().int(),
    rating: z.number().int().nullable(),
    content: z.string(),
    createdAt: z.string(),
})
export type ReviewEntry = z.infer<typeof ReviewEntrySchema>
