import { openai } from '@ai-sdk/openai'
import { generateObject } from 'ai'
import { eq } from 'drizzle-orm'
import { db } from '../db'
import { movies, tvShows } from '../db/schema'
import { redis } from './redis'
import { getMovieReviewMeta, getTvReviewMeta } from './tmdb'
import { composeSummaryEmbeddingText, contentHashFor, embedText } from './embeddings'
import { logUsage, normalizeUsage } from './usage'
import { ReviewSummarySchema, type MediaType, type ReviewSummary } from '@themovie/schemas'

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

const EMPTY_SUMMARY: ReviewSummary = {
    vibe: 'No audience reviews yet.',
    pros: [],
    cons: [],
}

// Stable system prompt kept first, per-movie review text appended after — the
// right ordering for OpenAI prompt caching, though this prompt sits below the
// ~1024-token cache floor, so caching seldom engages in practice.
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
    // SHA-256 of the summarized review text — gates re-embedding.
    hash: string
    // TMDB's total review count at summary time — the refresh job's delta trigger
    // (count unchanged ⇒ reviews effectively unchanged ⇒ skip re-summarizing).
    reviewCount: number
}

/** IO seams, injected so the service is testable without TMDB / OpenAI / DB / Redis. */
export interface SummaryDeps {
    /** Redis cache key for a given id (namespaced by media type). */
    cacheKey: (id: number) => string
    fetchReviewMeta: (id: number) => Promise<{ totalResults: number; reviews: string[] }>
    summarize: (reviewsText: string) => Promise<ReviewSummary>
    embedSummary: (text: string) => Promise<number[]>
    /** Durable read: the stored real summary for a title, or null if none. */
    loadStored: (id: number) => Promise<ReviewSummary | null>
    /** Durable write: persist a real summary + reception vector (best-effort). */
    saveStored: (id: number, record: StoredSummaryRecord) => Promise<void>
    cacheGet: (key: string) => Promise<string | null>
    cacheSet: (key: string, value: string, ttlSeconds: number) => Promise<void>
}

/**
 * Deps for the given media type. The TV path mirrors the movie path exactly —
 * same summarize/embed/cache logic, only the catalog table (`tv_shows`), the
 * TMDB review fetcher, and the cache-key prefix differ. `tv_shows` mirrors
 * `movies`' review-summary columns 1:1, so the table is cast to the movies shape
 * for the (identical) read/write queries.
 */
export function summaryDeps(mediaType: MediaType = 'movie'): SummaryDeps {
    const table = (mediaType === 'tv' ? tvShows : movies) as typeof movies
    return {
        cacheKey: (id) => `${mediaType}:${id}:summary`,
        fetchReviewMeta: mediaType === 'tv' ? getTvReviewMeta : getMovieReviewMeta,
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
        async loadStored(id) {
            const [row] = await db
                .select({
                    summary: table.reviewSummary,
                    reviewCount: table.reviewCountAtSummary,
                })
                .from(table)
                .where(eq(table.tmdbId, id))
                .limit(1)

            // A row with no stored summary, or only the no-reviews placeholder
            // (reviewCount 0/null), is not a durable hit — fall through so the
            // generate path re-checks for newly-accrued reviews.
            if (!row || row.summary == null || !row.reviewCount) return null

            const parsed = ReviewSummarySchema.safeParse(row.summary)
            if (!parsed.success) {
                console.warn(`⚠️ Corrupt stored summary for ${mediaType} ${id}; regenerating.`)
                return null
            }
            return parsed.data
        },
        async saveStored(id, record) {
            // Best-effort UPDATE on the catalog row. Affects 0 rows when the title
            // isn't in our catalog yet (summary still served + Redis-cached) — the
            // reception vector only matters for catalog rows semantic search scans.
            await db
                .update(table)
                .set({
                    reviewSummary: record.summary,
                    reviewSummaryEmbedding: record.embedding,
                    reviewSummaryHash: record.hash,
                    reviewCountAtSummary: record.reviewCount,
                    reviewSummaryAt: new Date(),
                })
                .where(eq(table.tmdbId, id))
        },
        cacheGet: (key) => redis.get(key),
        async cacheSet(key, value, ttlSeconds) {
            await redis.set(key, value, 'EX', ttlSeconds)
        },
    }
}

/**
 * Summarize a movie's reviews, embed the reception vector (Option B), persist
 * durably to PG, and refresh the Redis hot cache. Shared by the on-demand miss
 * path and the tiered refresh job, so both produce identical durable state.
 * `totalResults` is stored as the delta trigger. Returns the summary.
 */
export async function generateAndStoreSummary(
    movieId: number,
    reviews: string[],
    totalResults: number,
    deps: SummaryDeps = summaryDeps(),
): Promise<ReviewSummary> {
    const reviewsText = composeReviewText(reviews)
    const summary = await deps.summarize(reviewsText)

    // Embed the reception vector (Option B), skipping a literally-empty summary.
    const receptionText = composeSummaryEmbeddingText(summary)
    const embedding = receptionText ? await deps.embedSummary(receptionText) : null

    // Persist durably (best-effort — a DB failure must not fail the caller).
    try {
        await deps.saveStored(movieId, {
            summary,
            embedding,
            hash: contentHashFor(reviewsText),
            reviewCount: totalResults,
        })
    } catch (err) {
        console.error(`⚠️ Failed to persist summary for movie ${movieId}:`, err)
    }

    await deps.cacheSet(deps.cacheKey(movieId), JSON.stringify(summary), SUMMARY_TTL_SECONDS)
    return summary
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
    deps: SummaryDeps = summaryDeps(),
): Promise<ReviewSummary> {
    const key = deps.cacheKey(movieId)

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
    const { totalResults, reviews } = await deps.fetchReviewMeta(movieId)
    if (reviews.length === 0) {
        // Placeholder is Redis-only (short TTL) — not persisted to PG.
        await deps.cacheSet(key, JSON.stringify(EMPTY_SUMMARY), EMPTY_TTL_SECONDS)
        return EMPTY_SUMMARY
    }

    return generateAndStoreSummary(movieId, reviews, totalResults, deps)
}
