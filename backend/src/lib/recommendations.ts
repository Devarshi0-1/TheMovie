import { openai } from '@ai-sdk/openai'
import { generateObject } from 'ai'
import { and, cosineDistance, eq, isNotNull, notInArray, sql } from 'drizzle-orm'
import { db } from '../db'
import { movies, tvShows } from '../db/schema'
import { getWatchlist } from './watchlist'
import { logUsage, normalizeUsage } from './usage'
import { RecommendationsSchema, type MediaType, type Recommendation } from '@themovie/schemas'

// "Because you watched X" recommendations: take the user's watched titles —
// movies AND TV shows (Phase 10.4) — find the nearest titles by embedding
// (pgvector kNN) per seed within that seed's own catalog, merge into a candidate
// set, then have the agent rank + explain. Bounded task → cheap model.
export const RECOMMENDATION_MODEL = 'gpt-5-nano'

const MAX_SEEDS = 5 // most recent watched titles to seed from
const PER_SEED_K = 10 // nearest neighbours per seed
const MAX_CANDIDATES = 20 // candidates handed to the ranker
const MAX_RECOMMENDATIONS = 10

interface Seed {
    tmdbId: number
    title: string
    mediaType: MediaType
}

interface NeighbourCandidate {
    tmdbId: number
    title: string
    overview: string | null
    similarity: number
    mediaType: MediaType
}

/** A candidate plus the watched title it was drawn from (for the explanation). */
export interface RankCandidate extends NeighbourCandidate {
    sourceTitle: string
}

/** TMDB namespaces ids by media type, so candidates are deduped on both. */
const candidateKey = (mediaType: MediaType, tmdbId: number) => `${mediaType}:${tmdbId}`

const REC_SYSTEM_PROMPT = `You are a movie & TV recommender. The user has watched the listed titles. From the CANDIDATE titles — each tagged with its mediaType ("movie" or "tv"), the watched title it's similar to ("sourceTitle"), and a similarity score — pick the best matches and rank them best-first.

Rules:
- Only recommend titles from the provided candidates; never invent titles or ids.
- Copy each pick's mediaType straight from its candidate — do not change it.
- For each pick, write ONE short, spoiler-free sentence explaining the fit, referencing the watched title (e.g. "Because you watched X, …").
- Prefer variety over near-duplicates. Return at most 10.
- Respond only via the structured schema.`

export interface RecommendationDeps {
    getWatchlist(userId: string): Promise<Seed[]>
    /** Nearest neighbours of a seed within its OWN catalog (movies or tv_shows). */
    similarToSeed(
        tmdbId: number,
        mediaType: MediaType,
        limit: number,
        excludeTmdbIds: number[],
    ): Promise<NeighbourCandidate[]>
    rank(watchedTitles: string[], candidates: RankCandidate[]): Promise<Recommendation[]>
}

function defaultDeps(): RecommendationDeps {
    return {
        async getWatchlist(userId) {
            const entries = await getWatchlist(userId)
            // Seed from BOTH movies and shows; each seeds neighbours within its
            // own catalog (Phase 10.4 — TV is now first-class for recommendations).
            return entries.map((e) => ({
                tmdbId: e.movieId,
                title: e.title,
                mediaType: e.mediaType,
            }))
        },

        async similarToSeed(tmdbId, mediaType, limit, excludeTmdbIds) {
            // The seed and its neighbours live in the matching catalog so a TV
            // seed yields shows and a movie seed yields films. `tv_shows` mirrors
            // `movies`' embedding column 1:1, so the queries are identical.
            const table = (mediaType === 'tv' ? tvShows : movies) as typeof movies

            // The seed must be in the local catalog with an embedding to anchor kNN.
            const [seed] = await db
                .select({ embedding: table.embedding })
                .from(table)
                .where(eq(table.tmdbId, tmdbId))
                .limit(1)
            if (!seed?.embedding) return []

            const distance = cosineDistance(table.embedding, seed.embedding)
            const exclude = [...new Set([tmdbId, ...excludeTmdbIds])]
            const rows = await db
                .select({
                    tmdbId: table.tmdbId,
                    title: table.title,
                    overview: table.overview,
                    similarity: sql<number>`1 - (${distance})`,
                })
                .from(table)
                .where(and(isNotNull(table.embedding), notInArray(table.tmdbId, exclude)))
                .orderBy(distance)
                .limit(limit)
            return rows.map((r) => ({ ...r, mediaType }))
        },

        async rank(watchedTitles, candidates) {
            const { object, usage } = await generateObject({
                model: openai(RECOMMENDATION_MODEL),
                schema: RecommendationsSchema,
                schemaName: 'Recommendations',
                schemaDescription:
                    'Ranked, explained movie/TV recommendations from the candidates.',
                system: REC_SYSTEM_PROMPT,
                prompt: JSON.stringify({
                    watched: watchedTitles,
                    candidates: candidates.map((c) => ({
                        tmdbId: c.tmdbId,
                        title: c.title,
                        mediaType: c.mediaType,
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

    // Exclude already-watched titles per media type (a movie id and a show id
    // can collide, so they mustn't cross-exclude).
    const watchedByMedia: Record<MediaType, number[]> = { movie: [], tv: [] }
    for (const w of watchlist) watchedByMedia[w.mediaType].push(w.tmdbId)

    const seeds = watchlist.slice(0, MAX_SEEDS)

    const perSeed = await Promise.all(
        seeds.map((seed) =>
            deps
                .similarToSeed(
                    seed.tmdbId,
                    seed.mediaType,
                    PER_SEED_K,
                    watchedByMedia[seed.mediaType],
                )
                .then((neighbours) => ({ seed, neighbours })),
        ),
    )

    // Merge across seeds: dedupe by (mediaType, id), keep the highest similarity
    // (and the watched title that produced it, for the "because you watched X"
    // reason).
    const byKey = new Map<string, RankCandidate>()
    for (const { seed, neighbours } of perSeed) {
        for (const n of neighbours) {
            const key = candidateKey(n.mediaType, n.tmdbId)
            const existing = byKey.get(key)
            if (!existing || n.similarity > existing.similarity) {
                byKey.set(key, { ...n, sourceTitle: seed.title })
            }
        }
    }

    const candidates = [...byKey.values()]
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
