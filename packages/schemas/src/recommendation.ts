import { z } from 'zod'
import { MediaTypeSchema } from './movie'

// Personalized recommendation output (Phase 5.2). The agent ranks candidate
// titles (assembled from pgvector kNN over the user's watched movies AND shows —
// Phase 10.4) and gives each a short "because you watched X" reason.

export const RecommendationSchema = z.object({
    tmdbId: z.number().int().describe('The TMDB id of a candidate title (must be one provided).'),
    title: z.string().describe('The candidate movie/show title.'),
    // TMDB ids are namespaced by media type, so a recommendation echoes the
    // candidate's discriminator; defaults to 'movie' for movie-only callers.
    mediaType: MediaTypeSchema.default('movie').describe(
        "The candidate's media type — copy it from the candidate ('movie' or 'tv').",
    ),
    reason: z
        .string()
        .describe('One spoiler-free sentence on why it fits, referencing a title they watched.'),
})
export type Recommendation = z.infer<typeof RecommendationSchema>

// generateObject needs an object schema; wrap the ranked list.
export const RecommendationsSchema = z.object({
    recommendations: z.array(RecommendationSchema),
})
export type Recommendations = z.infer<typeof RecommendationsSchema>
