import { and, desc, eq } from 'drizzle-orm'
import { db } from '../db'
import { review } from '../db/schema'
import { redis } from './redis'
import type { ReviewEntry, ReviewInput } from '../schemas/review'

// User reviews. Postgres is the source of truth (one review per user/movie,
// editable via upsert); the most recent reviews per movie are mirrored to a
// Redis key (`movie:{id}:reviews:recent`, a JSON-encoded array) for a fast
// "recent reviews" read, hydrated from Postgres on a cold miss. All IO behind
// injectable deps.

const RECENT_LIMIT = 20
// Backstop TTL on the recent-reviews cache. Writes invalidate the key eagerly,
// so this only bounds staleness if an invalidation is ever missed.
const RECENT_TTL_SECONDS = 60 * 60

const recentKey = (movieId: number) => `movie:${movieId}:reviews:recent`

export interface ReviewDeps {
    /** Upsert the user's review (one per user/movie); returns the stored entry. */
    dbUpsert(userId: string, input: ReviewInput): Promise<ReviewEntry>
    /** The newest reviews for a movie (capped at RECENT_LIMIT), newest first. */
    dbListForMovie(movieId: number): Promise<ReviewEntry[]>
    /** Drop the movie's recent-reviews cache so the next read re-hydrates from Postgres. */
    cacheInvalidateRecent(movieId: number): Promise<void>
    /** Cached recent entries (possibly empty), or null if the key is absent (cold). */
    cacheGetRecent(movieId: number): Promise<ReviewEntry[] | null>
    /** Cache the recent-reviews list (newest first); caches an empty list too. */
    cacheHydrateRecent(movieId: number, entries: ReviewEntry[]): Promise<void>
}

function defaultDeps(): ReviewDeps {
    return {
        async dbUpsert(userId, input) {
            const [row] = await db
                .insert(review)
                .values({
                    userId,
                    movieId: input.movieId,
                    rating: input.rating ?? null,
                    content: input.content,
                })
                .onConflictDoUpdate({
                    target: [review.userId, review.movieId],
                    set: {
                        rating: input.rating ?? null,
                        content: input.content,
                        updatedAt: new Date(),
                    },
                })
                .returning()
            return toEntry(row)
        },

        async dbListForMovie(movieId) {
            // Only the recent window is ever shown; cap the fetch so a movie with
            // thousands of reviews doesn't pull (and deserialize) them all.
            const rows = await db
                .select()
                .from(review)
                .where(eq(review.movieId, movieId))
                .orderBy(desc(review.createdAt))
                .limit(RECENT_LIMIT)
            return rows.map(toEntry)
        },

        async cacheInvalidateRecent(movieId) {
            await redis.del(recentKey(movieId))
        },

        async cacheGetRecent(movieId) {
            // A single JSON value (not a List) so an empty array is a real cache
            // HIT, distinguishable from an absent key — `get` returns null only
            // when the key is missing (cold).
            const raw = await redis.get(recentKey(movieId))
            if (raw === null) return null
            return JSON.parse(raw) as ReviewEntry[]
        },

        async cacheHydrateRecent(movieId, entries) {
            // Cache even an empty list: a zero-review movie must become a cache
            // hit, not a permanent cold miss that re-queries Postgres every read.
            const recent = JSON.stringify(entries.slice(0, RECENT_LIMIT))
            await redis.set(recentKey(movieId), recent, 'EX', RECENT_TTL_SECONDS)
        },
    }
}

type ReviewRow = typeof review.$inferSelect

function toEntry(row: ReviewRow): ReviewEntry {
    return {
        id: row.id,
        userId: row.userId,
        movieId: row.movieId,
        rating: row.rating,
        content: row.content,
        createdAt: row.createdAt.toISOString(),
    }
}

/** Create or update the user's review of a movie. */
export async function upsertReview(
    userId: string,
    input: ReviewInput,
    deps: ReviewDeps = defaultDeps(),
): Promise<ReviewEntry> {
    const entry = await deps.dbUpsert(userId, input)
    // Invalidate (don't push): a review edit is an upsert, and pushing the new
    // copy onto the list would leave the pre-edit copy behind as a stale
    // duplicate. Dropping the key makes the next read re-hydrate from Postgres,
    // which holds exactly one row per (user, movie).
    await deps.cacheInvalidateRecent(input.movieId)
    return entry
}

/**
 * Recent reviews for a movie. Served from the Redis List; on a cold miss the
 * list is rebuilt from Postgres so reads stay fast and correct.
 */
export async function getRecentReviews(
    movieId: number,
    deps: ReviewDeps = defaultDeps(),
): Promise<ReviewEntry[]> {
    const cached = await deps.cacheGetRecent(movieId)
    if (cached) return cached

    const all = await deps.dbListForMovie(movieId)
    const recent = all.slice(0, RECENT_LIMIT)
    await deps.cacheHydrateRecent(movieId, recent)
    return recent
}
