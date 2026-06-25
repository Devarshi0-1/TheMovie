import { z } from 'zod'

// Personalized recommendation output (Phase 5.2). The agent ranks candidate
// movies (assembled from pgvector kNN over the user's watched movies) and gives
// each a short "because you watched X" reason.

export const RecommendationSchema = z.object({
    tmdbId: z.number().int().describe('The TMDB id of a candidate movie (must be one provided).'),
    title: z.string().describe('The candidate movie title.'),
    reason: z
        .string()
        .describe('One spoiler-free sentence on why it fits, referencing a movie they watched.'),
})
export type Recommendation = z.infer<typeof RecommendationSchema>

// generateObject needs an object schema; wrap the ranked list.
export const RecommendationsSchema = z.object({
    recommendations: z.array(RecommendationSchema),
})
export type Recommendations = z.infer<typeof RecommendationsSchema>
