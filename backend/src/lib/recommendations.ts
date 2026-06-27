import { openai } from '@ai-sdk/openai'
import { generateObject } from 'ai'
import { and, cosineDistance, eq, isNotNull, notInArray, sql } from 'drizzle-orm'
import { db } from '../db'
import { movies } from '../db/schema'
import { getWatchlist } from './watchlist'
import { logUsage, normalizeUsage } from './usage'
import { RecommendationsSchema, type Recommendation } from '@themovie/schemas'

// "Because you watched X" recommendations: take the user's watched movies, find
// the nearest movies by embedding (pgvector kNN) per seed, merge into a
// candidate set, then have the agent rank + explain. Bounded task → cheap model.
export const RECOMMENDATION_MODEL = 'gpt-5-nano'

const MAX_SEEDS = 5 // most recent watched movies to seed from
const PER_SEED_K = 10 // nearest neighbours per seed
const MAX_CANDIDATES = 20 // candidates handed to the ranker
const MAX_RECOMMENDATIONS = 10

interface Seed {
    tmdbId: number
    title: string
}

interface NeighbourCandidate {
    tmdbId: number
    title: string
    overview: string | null
    similarity: number
}

/** A candidate plus the watched movie it was drawn from (for the explanation). */
export interface RankCandidate extends NeighbourCandidate {
    sourceTitle: string
}

const REC_SYSTEM_PROMPT = `You are a movie recommender. The user has watched the listed movies. From the CANDIDATE movies — each tagged with the watched movie it's similar to ("sourceTitle") and a similarity score — pick the best matches and rank them best-first.

Rules:
- Only recommend movies from the provided candidates; never invent titles or ids.
- For each pick, write ONE short, spoiler-free sentence explaining the fit, referencing the watched movie (e.g. "Because you watched X, …").
- Prefer variety over near-duplicates. Return at most 10.
- Respond only via the structured schema.`

export interface RecommendationDeps {
    getWatchlist(userId: string): Promise<Seed[]>
    similarToMovie(
        tmdbId: number,
        limit: number,
        excludeTmdbIds: number[],
    ): Promise<NeighbourCandidate[]>
    rank(watchedTitles: string[], candidates: RankCandidate[]): Promise<Recommendation[]>
}

function defaultDeps(): RecommendationDeps {
    return {
        async getWatchlist(userId) {
            const entries = await getWatchlist(userId)
            return entries.map((e) => ({ tmdbId: e.movieId, title: e.title }))
        },

        async similarToMovie(tmdbId, limit, excludeTmdbIds) {
            // The seed must be in the local catalog with an embedding to anchor kNN.
            const [seed] = await db
                .select({ embedding: movies.embedding })
                .from(movies)
                .where(eq(movies.tmdbId, tmdbId))
                .limit(1)
            if (!seed?.embedding) return []

            const distance = cosineDistance(movies.embedding, seed.embedding)
            const exclude = [...new Set([tmdbId, ...excludeTmdbIds])]
            const rows = await db
                .select({
                    tmdbId: movies.tmdbId,
                    title: movies.title,
                    overview: movies.overview,
                    similarity: sql<number>`1 - (${distance})`,
                })
                .from(movies)
                .where(and(isNotNull(movies.embedding), notInArray(movies.tmdbId, exclude)))
                .orderBy(distance)
                .limit(limit)
            return rows
        },

        async rank(watchedTitles, candidates) {
            const { object, usage } = await generateObject({
                model: openai(RECOMMENDATION_MODEL),
                schema: RecommendationsSchema,
                schemaName: 'Recommendations',
                schemaDescription: 'Ranked, explained movie recommendations from the candidates.',
                system: REC_SYSTEM_PROMPT,
                prompt: JSON.stringify({
                    watched: watchedTitles,
                    candidates: candidates.map((c) => ({
                        tmdbId: c.tmdbId,
                        title: c.title,
                        sourceTitle: c.sourceTitle,
                        similarity: Number(c.similarity.toFixed(3)),
                        overview: c.overview?.slice(0, 240) ?? null,
                    })),
                }),
            })
            logUsage('recommendations', RECOMMENDATION_MODEL, normalizeUsage(usage), {
                candidates: candidates.length,
            })
            return object.recommendations
        },
    }
}

export interface RecommendationResult {
    recommendations: Recommendation[]
    basis: { watchedCount: number; candidateCount: number }
}

/**
 * Personalized recommendations for a user. Empty watchlist (or no embeddable
 * candidates) yields an empty list with the basis counts so callers can explain
 * why. The ranking step only runs when there are candidates (no wasted spend).
 */
export async function recommendForUser(
    userId: string,
    deps: RecommendationDeps = defaultDeps(),
): Promise<RecommendationResult> {
    const watchlist = await deps.getWatchlist(userId)
    if (watchlist.length === 0) {
        return { recommendations: [], basis: { watchedCount: 0, candidateCount: 0 } }
    }

    const watchedIds = watchlist.map((w) => w.tmdbId)
    const seeds = watchlist.slice(0, MAX_SEEDS)

    const perSeed = await Promise.all(
        seeds.map((seed) =>
            deps.similarToMovie(seed.tmdbId, PER_SEED_K, watchedIds).then((neighbours) => ({
                seed,
                neighbours,
            })),
        ),
    )

    // Merge across seeds: dedupe by movie, keep the highest similarity (and the
    // watched movie that produced it, for the "because you watched X" reason).
    const byTmdb = new Map<number, RankCandidate>()
    for (const { seed, neighbours } of perSeed) {
        for (const n of neighbours) {
            const existing = byTmdb.get(n.tmdbId)
            if (!existing || n.similarity > existing.similarity) {
                byTmdb.set(n.tmdbId, { ...n, sourceTitle: seed.title })
            }
        }
    }

    const candidates = [...byTmdb.values()]
        .sort((a, b) => b.similarity - a.similarity)
        .slice(0, MAX_CANDIDATES)

    if (candidates.length === 0) {
        return { recommendations: [], basis: { watchedCount: watchlist.length, candidateCount: 0 } }
    }

    const ranked = await deps.rank(
        watchlist.map((w) => w.title),
        candidates,
    )
    return {
        recommendations: ranked.slice(0, MAX_RECOMMENDATIONS),
        basis: { watchedCount: watchlist.length, candidateCount: candidates.length },
    }
}
