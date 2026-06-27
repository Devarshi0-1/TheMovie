import { openai } from '@ai-sdk/openai'
import { generateObject } from 'ai'
import { eq } from 'drizzle-orm'
import { db } from '../db'
import { movies } from '../db/schema'
import { redis } from './redis'
import { getMovieReviews } from './tmdb'
import { composeSummaryEmbeddingText, contentHashFor, embedText } from './embeddings'
import { logUsage, normalizeUsage } from './usage'
import { ReviewSummarySchema, type ReviewSummary } from '@themovie/schemas'

// Bounded summarization runs on the cheap model (a cost rule). Postgres is the
// durable source of truth for the summary + its reception embedding; Redis is a
// hot cache in front of it so we never re-summarize unchanged reviews (CLAUDE.md).
export const SUMMARY_MODEL = 'gpt-5-nano'

// Redis is a hot cache backed by PG, not the system of record: a real summary is
// durable in PG, so its Redis entry only needs to stay warm. The no-reviews
// placeholder is Redis-ONLY (never persisted) with a short TTL, so a movie that
// later accrues reviews gets summarized soon after — PG has no TTL and would
// otherwise pin the placeholder forever.
const SUMMARY_TTL_SECONDS = 60 * 60 * 24 * 7
const EMPTY_TTL_SECONDS = 60 * 60 * 6

// Cap what we send to the model: a handful of reviews, bounded total length.
const MAX_REVIEWS = 8
const REVIEW_CHAR_BUDGET = 12_000

const cacheKey = (movieId: number) => `movie:${movieId}:summary`

const EMPTY_SUMMARY: ReviewSummary = {
    vibe: 'No audience reviews yet.',
    pros: [],
    cons: [],
}

// Stable system prompt kept first so OpenAI prompt caching applies; only the
// per-movie review text (appended after) is volatile.
const SYSTEM_PROMPT = `You summarize audience movie reviews into a concise, SPOILER-FREE overview. Rules:
- Never reveal plot twists, endings, deaths, or surprises — keep it spoiler-free.
- Base everything ONLY on the provided reviews; do not invent praise or criticism.
- vibe: one short sentence capturing the overall consensus/mood.
- pros / cons: short bullet phrases audiences actually mention (each at most ~10 words). Leave a list empty if there's nothing to say.
- Be neutral and concise. Respond only via the structured schema.`

function composeReviewText(reviews: string[]): string {
    const text = reviews
        .slice(0, MAX_REVIEWS)
        .map((r, i) => `Review ${i + 1}:\n${r.trim()}`)
        .join('\n\n')
    return text.length > REVIEW_CHAR_BUDGET ? text.slice(0, REVIEW_CHAR_BUDGET) : text
}

/** What gets persisted to PG when a real summary is generated. */
export interface StoredSummaryRecord {
    summary: ReviewSummary
    // The reception vector (Option B). Null when the summary text is empty.
    embedding: number[] | null
    // SHA-256 of the summarized review text — the refresh job's change trigger.
    hash: string
    // How many review bodies fed the summary — the refresh job's delta check.
    reviewCount: number
}

/** IO seams, injected so the service is testable without TMDB / OpenAI / DB / Redis. */
export interface SummaryDeps {
    fetchReviews: (movieId: number) => Promise<string[]>
    summarize: (reviewsText: string) => Promise<ReviewSummary>
    embedSummary: (text: string) => Promise<number[]>
    /** Durable read: the stored real summary for a movie, or null if none. */
    loadStored: (movieId: number) => Promise<ReviewSummary | null>
    /** Durable write: persist a real summary + reception vector (best-effort). */
    saveStored: (movieId: number, record: StoredSummaryRecord) => Promise<void>
    cacheGet: (key: string) => Promise<string | null>
    cacheSet: (key: string, value: string, ttlSeconds: number) => Promise<void>
}

function defaultDeps(): SummaryDeps {
    return {
        fetchReviews: getMovieReviews,
        async summarize(reviewsText) {
            const { object, usage } = await generateObject({
                model: openai(SUMMARY_MODEL),
                schema: ReviewSummarySchema,
                schemaName: 'ReviewSummary',
                schemaDescription: 'Spoiler-free pros/cons + one-line vibe from audience reviews.',
                system: SYSTEM_PROMPT,
                prompt: reviewsText,
            })
            logUsage('review-summary', SUMMARY_MODEL, normalizeUsage(usage))
            return object
        },
        // Cache-aware (content-hashed) embed: an unchanged summary is never
        // re-embedded — the embeddings layer serves it from cache.
        embedSummary: (text) => embedText(text),
        async loadStored(movieId) {
            const [row] = await db
                .select({
                    summary: movies.reviewSummary,
                    reviewCount: movies.reviewCountAtSummary,
                })
                .from(movies)
                .where(eq(movies.tmdbId, movieId))
                .limit(1)

            // A row with no stored summary, or only the no-reviews placeholder
            // (reviewCount 0/null), is not a durable hit — fall through so the
            // generate path re-checks for newly-accrued reviews.
            if (!row || row.summary == null || !row.reviewCount) return null

            const parsed = ReviewSummarySchema.safeParse(row.summary)
            if (!parsed.success) {
                console.warn(`⚠️ Corrupt stored summary for movie ${movieId}; regenerating.`)
                return null
            }
            return parsed.data
        },
        async saveStored(movieId, record) {
            // Best-effort UPDATE on the catalog row. Affects 0 rows when the movie
            // isn't in our catalog yet (summary still served + Redis-cached) — the
            // reception vector only matters for catalog rows semantic search scans.
            await db
                .update(movies)
                .set({
                    reviewSummary: record.summary,
                    reviewSummaryEmbedding: record.embedding,
                    reviewSummaryHash: record.hash,
                    reviewCountAtSummary: record.reviewCount,
                    reviewSummaryAt: new Date(),
                })
                .where(eq(movies.tmdbId, movieId))
        },
        cacheGet: (key) => redis.get(key),
        async cacheSet(key, value, ttlSeconds) {
            await redis.set(key, value, 'EX', ttlSeconds)
        },
    }
}

/**
 * Spoiler-free pros/cons + one-line vibe for a movie's audience reviews.
 *
 * Read-through: Redis hot cache → durable PG store → (on miss) summarize + embed
 * the reception vector (Option B) + persist. Never re-summarizes unchanged
 * reviews. Returns a neutral placeholder (Redis-only, short TTL) when a movie has
 * no reviews. PG/Redis failures degrade gracefully — the summary is still served.
 */
export async function summarizeReviews(
    movieId: number,
    deps: SummaryDeps = defaultDeps(),
): Promise<ReviewSummary> {
    const key = cacheKey(movieId)

    // 1. Hot cache (Redis).
    const cached = await deps.cacheGet(key)
    if (cached) {
        try {
            return JSON.parse(cached) as ReviewSummary
        } catch (err) {
            // A corrupt cache entry shouldn't poison the response — fall through.
            console.warn(`⚠️ Corrupt summary cache for ${key}; regenerating:`, err)
        }
    }

    // 2. Durable store (Postgres). Warm Redis on a hit so the next read is fast.
    let stored: ReviewSummary | null = null
    try {
        stored = await deps.loadStored(movieId)
    } catch (err) {
        console.warn(`⚠️ PG summary read failed for movie ${movieId}; regenerating:`, err)
    }
    if (stored) {
        await deps.cacheSet(key, JSON.stringify(stored), SUMMARY_TTL_SECONDS)
        return stored
    }

    // 3. Generate.
    const reviews = await deps.fetchReviews(movieId)
    if (reviews.length === 0) {
        // Placeholder is Redis-only (short TTL) — not persisted to PG.
        await deps.cacheSet(key, JSON.stringify(EMPTY_SUMMARY), EMPTY_TTL_SECONDS)
        return EMPTY_SUMMARY
    }

    const reviewsText = composeReviewText(reviews)
    const summary = await deps.summarize(reviewsText)

    // Embed the reception vector (Option B), skipping a literally-empty summary.
    const receptionText = composeSummaryEmbeddingText(summary)
    const embedding = receptionText ? await deps.embedSummary(receptionText) : null

    // Persist durably (best-effort — a DB failure must not fail the response).
    try {
        await deps.saveStored(movieId, {
            summary,
            embedding,
            hash: contentHashFor(reviewsText),
            reviewCount: reviews.length,
        })
    } catch (err) {
        console.error(`⚠️ Failed to persist summary for movie ${movieId}:`, err)
    }

    await deps.cacheSet(key, JSON.stringify(summary), SUMMARY_TTL_SECONDS)
    return summary
}
