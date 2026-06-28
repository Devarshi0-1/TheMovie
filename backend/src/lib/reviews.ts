import { and, desc, eq } from 'drizzle-orm'
import { db } from '../db'
import { review } from '../db/schema'
import { redis } from './redis'
import type { MediaType, ReviewEntry, ReviewInput } from '@themovie/schemas'

// User reviews. Postgres is the source of truth (one review per user per
// (mediaType, movie), editable via upsert); the most recent reviews per title
// are mirrored to a Redis key (`{mediaType}:{id}:reviews:recent`, a JSON-encoded
// array) for a fast "recent reviews" read, hydrated from Postgres on a cold miss.
// The `movie` prefix keeps pre-Phase-10.3 movie caches valid; TV gets its own
// `tv:` namespace. All IO behind injectable deps.

const RECENT_LIMIT = 20
// Backstop TTL on the recent-reviews cache. Writes invalidate the key eagerly,
// so this only bounds staleness if an invalidation is ever missed.
const RECENT_TTL_SECONDS = 60 * 60

const recentKey = (movieId: number, mediaType: MediaType) =>
    `${mediaType}:${movieId}:reviews:recent`

export interface ReviewDeps {
    /** Upsert the user's review (one per user/(mediaType, movie)); returns the entry. */
    dbUpsert(userId: string, input: ReviewInput): Promise<ReviewEntry>
    /** The newest reviews for a title (capped at RECENT_LIMIT), newest first. */
    dbListForMovie(movieId: number, mediaType: MediaType): Promise<ReviewEntry[]>
    /** Drop the title's recent-reviews cache so the next read re-hydrates from Postgres. */
    cacheInvalidateRecent(movieId: number, mediaType: MediaType): Promise<void>
    /** Cached recent entries (possibly empty), or null if the key is absent (cold). */
    cacheGetRecent(movieId: number, mediaType: MediaType): Promise<ReviewEntry[] | null>
    /** Cache the recent-reviews list (newest first); caches an empty list too. */
    cacheHydrateRecent(movieId: number, mediaType: MediaType, entries: ReviewEntry[]): Promise<void>
}

function defaultDeps(): ReviewDeps {
    return {
        async dbUpsert(userId, input) {
            const [row] = await db
                .insert(review)
                .values({
                    userId,
                    movieId: input.movieId,
                    mediaType: input.mediaType,
                    rating: input.rating ?? null,
                    content: input.content,
                })
                .onConflictDoUpdate({
                    target: [review.userId, review.mediaType, review.movieId],
                    set: {
                        rating: input.rating ?? null,
                        content: input.content,
                        updatedAt: new Date(),
                    },
                })
                .returning()
            if (!row) throw new Error('Review upsert returned no row')
            return toEntry(row)
        },

        async dbListForMovie(movieId, mediaType) {
            // Only the recent window is ever shown; cap the fetch so a title with
            // thousands of reviews doesn't pull (and deserialize) them all.
            const rows = await db
                .select()
                .from(review)
                .where(and(eq(review.mediaType, mediaType), eq(review.movieId, movieId)))
                .orderBy(desc(review.createdAt))
                .limit(RECENT_LIMIT)
            return rows.map(toEntry)
        },

        async cacheInvalidateRecent(movieId, mediaType) {
            await redis.del(recentKey(movieId, mediaType))
        },

        async cacheGetRecent(movieId, mediaType) {
            // A single JSON value (not a List) so an empty array is a real cache
            // HIT, distinguishable from an absent key — `get` returns null only
            // when the key is missing (cold).
            const raw = await redis.get(recentKey(movieId, mediaType))
            if (raw === null) return null
            return JSON.parse(raw) as ReviewEntry[]
        },

        async cacheHydrateRecent(movieId, mediaType, entries) {
            // Cache even an empty list: a zero-review title must become a cache
            // hit, not a permanent cold miss that re-queries Postgres every read.
            const recent = JSON.stringify(entries.slice(0, RECENT_LIMIT))
            await redis.set(recentKey(movieId, mediaType), recent, 'EX', RECENT_TTL_SECONDS)
        },
    }
}

type ReviewRow = typeof review.$inferSelect

function toEntry(row: ReviewRow): ReviewEntry {
    return {
        id: row.id,
        userId: row.userId,
        movieId: row.movieId,
        mediaType: row.mediaType as MediaType,
        rating: row.rating,
        content: row.content,
        createdAt: row.createdAt.toISOString(),
    }
}

/** Create or update the user's review of a movie/show. */
export async function upsertReview(
    userId: string,
    input: ReviewInput,
    deps: ReviewDeps = defaultDeps(),
): Promise<ReviewEntry> {
    const entry = await deps.dbUpsert(userId, input)
    // Invalidate (don't push): a review edit is an upsert, and pushing the new
    // copy onto the list would leave the pre-edit copy behind as a stale
    // duplicate. Dropping the key makes the next read re-hydrate from Postgres,
    // which holds exactly one row per (user, mediaType, movie).
    await deps.cacheInvalidateRecent(input.movieId, input.mediaType)
    return entry
}

/**
 * Recent reviews for a movie/show. Served from Redis; on a cold miss the list is
 * rebuilt from Postgres so reads stay fast and correct.
 */
export async function getRecentReviews(
    movieId: number,
    mediaType: MediaType = 'movie',
    deps: ReviewDeps = defaultDeps(),
): Promise<ReviewEntry[]> {
    let cached: ReviewEntry[] | null = null
    try {
        cached = await deps.cacheGetRecent(movieId, mediaType)
    } catch (err) {
        // A cache read must never fail the request. Two cases land here: a key
        // left in the OLD List representation reads as WRONGTYPE, and a Redis
        // blip throws too. Fall back to Postgres (the source of truth); the
        // hydrate below rewrites the key (SET overwrites any stale List), so the
        // old representation self-heals on the first read.
        console.warn('⚠️ recent-reviews cache read failed; falling back to Postgres:', err)
    }
    if (cached) return cached

    const recent = (await deps.dbListForMovie(movieId, mediaType)).slice(0, RECENT_LIMIT)
    try {
        await deps.cacheHydrateRecent(movieId, mediaType, recent)
    } catch (err) {
        console.warn('⚠️ recent-reviews cache hydrate failed; serving from Postgres:', err)
    }
    return recent
}
