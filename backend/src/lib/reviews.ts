import { and, desc, eq } from 'drizzle-orm'
import { db } from '../db'
import { review } from '../db/schema'
import { redis } from './redis'
import type { ReviewEntry, ReviewInput } from '../schemas/review'

// User reviews. Postgres is the source of truth (one review per user/movie,
// editable via upsert); the most recent reviews per movie are mirrored to a
// Redis List (`movie:{id}:reviews:recent`) for a fast "recent reviews" read,
// hydrated from Postgres on a cold miss. All IO behind injectable deps.

const RECENT_LIMIT = 20

const recentKey = (movieId: number) => `movie:${movieId}:reviews:recent`

export interface ReviewDeps {
    /** Upsert the user's review (one per user/movie); returns the stored entry. */
    dbUpsert(userId: string, input: ReviewInput): Promise<ReviewEntry>
    /** All reviews for a movie, newest first. */
    dbListForMovie(movieId: number): Promise<ReviewEntry[]>
    /** Drop the movie's recent-reviews cache so the next read re-hydrates from Postgres. */
    cacheInvalidateRecent(movieId: number): Promise<void>
    /** Recent entries from the cache, or null if the list isn't populated (cold). */
    cacheGetRecent(movieId: number): Promise<ReviewEntry[] | null>
    /** Replace the recent-reviews list with these entries (newest first). */
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
            const rows = await db
                .select()
                .from(review)
                .where(eq(review.movieId, movieId))
                .orderBy(desc(review.createdAt))
            return rows.map(toEntry)
        },

        async cacheInvalidateRecent(movieId) {
            await redis.del(recentKey(movieId))
        },

        async cacheGetRecent(movieId) {
            const raw = await redis.lrange(recentKey(movieId), 0, -1)
            if (raw.length === 0) return null
            return raw.map((r) => JSON.parse(r) as ReviewEntry)
        },

        async cacheHydrateRecent(movieId, entries) {
            if (entries.length === 0) return
            // Oldest pushed first so the newest ends up at the head of the list.
            const [first, ...rest] = entries
                .slice(0, RECENT_LIMIT)
                .reverse()
                .map((e) => JSON.stringify(e))
            await redis.lpush(recentKey(movieId), first, ...rest)
            await redis.ltrim(recentKey(movieId), 0, RECENT_LIMIT - 1)
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
