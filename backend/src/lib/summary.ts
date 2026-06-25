import { openai } from '@ai-sdk/openai'
import { generateObject } from 'ai'
import { redis } from './redis'
import { getMovieReviews } from './tmdb'
import { ReviewSummarySchema, type ReviewSummary } from '../schemas/movie'

// Bounded summarization runs on the cheap model (a cost rule), and outputs are
// cached in Redis so we never re-summarize the same reviews (see CLAUDE.md).
export const SUMMARY_MODEL = 'gpt-5-mini'

// Summaries are stable; 7 days. The no-reviews placeholder gets a short TTL so a
// movie that later accrues reviews gets summarized soon after.
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

/** IO seams, injected so the service is testable without TMDB / OpenAI / Redis. */
export interface SummaryDeps {
    fetchReviews: (movieId: number) => Promise<string[]>
    summarize: (reviewsText: string) => Promise<ReviewSummary>
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
            console.log(
                `📝 review summary | tokens in=${usage.inputTokens ?? '?'} ` +
                    `out=${usage.outputTokens ?? '?'} ` +
                    `cached=${usage.inputTokenDetails?.cacheReadTokens ?? 0}`,
            )
            return object
        },
        cacheGet: (key) => redis.get(key),
        async cacheSet(key, value, ttlSeconds) {
            await redis.set(key, value, 'EX', ttlSeconds)
        },
    }
}

/**
 * Spoiler-free pros/cons + one-line vibe for a movie's audience reviews.
 * Redis-cached by `movie:{id}:summary`; never re-summarizes unchanged reviews.
 * Returns a neutral placeholder (cached briefly) when a movie has no reviews.
 */
export async function summarizeReviews(
    movieId: number,
    deps: SummaryDeps = defaultDeps(),
): Promise<ReviewSummary> {
    const key = cacheKey(movieId)

    const cached = await deps.cacheGet(key)
    if (cached) {
        try {
            return JSON.parse(cached) as ReviewSummary
        } catch (err) {
            // A corrupt cache entry shouldn't poison the response — re-summarize.
            console.warn(`⚠️ Corrupt summary cache for ${key}; regenerating:`, err)
        }
    }

    const reviews = await deps.fetchReviews(movieId)
    if (reviews.length === 0) {
        await deps.cacheSet(key, JSON.stringify(EMPTY_SUMMARY), EMPTY_TTL_SECONDS)
        return EMPTY_SUMMARY
    }

    const summary = await deps.summarize(composeReviewText(reviews))
    await deps.cacheSet(key, JSON.stringify(summary), SUMMARY_TTL_SECONDS)
    return summary
}
