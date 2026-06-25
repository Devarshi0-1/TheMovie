import { and, desc, eq } from 'drizzle-orm'
import { db } from '../db'
import { watchlist } from '../db/schema'
import { redis } from './redis'
import type { WatchlistAdd, WatchlistEntry } from '../schemas/watchlist'

// Watchlist persistence. Postgres is the source of truth (respecting the
// `unique_user_movie` constraint); a Redis Set per user mirrors membership for
// O(1) "is this on my watchlist?" checks, hydrated from Postgres on a cold miss.
// All IO is behind injectable deps so the service is testable offline.

export interface WatchlistDeps {
    /** Insert, ignoring duplicates. Returns true only if a new row was created. */
    dbInsert(userId: string, item: WatchlistAdd): Promise<boolean>
    /** Delete by (user, movie). Returns true if a row was removed. */
    dbDelete(userId: string, movieId: number): Promise<boolean>
    /** All of the user's entries, newest first. */
    dbList(userId: string): Promise<WatchlistEntry[]>
    cacheAdd(userId: string, movieId: number): Promise<void>
    cacheRemove(userId: string, movieId: number): Promise<void>
    /** Membership from the cache, or undefined if the set isn't populated (cold). */
    cacheHas(userId: string, movieId: number): Promise<boolean | undefined>
    /** Populate the membership set from the authoritative id list. */
    cacheHydrate(userId: string, movieIds: number[]): Promise<void>
}

const setKey = (userId: string) => `watchlist:${userId}`

function defaultDeps(): WatchlistDeps {
    return {
        async dbInsert(userId, item) {
            const inserted = await db
                .insert(watchlist)
                .values({
                    userId,
                    movieId: item.movieId,
                    title: item.title,
                    posterPath: item.posterPath ?? null,
                })
                .onConflictDoNothing({ target: [watchlist.userId, watchlist.movieId] })
                .returning({ id: watchlist.id })
            return inserted.length > 0
        },

        async dbDelete(userId, movieId) {
            const deleted = await db
                .delete(watchlist)
                .where(and(eq(watchlist.userId, userId), eq(watchlist.movieId, movieId)))
                .returning({ id: watchlist.id })
            return deleted.length > 0
        },

        async dbList(userId) {
            const rows = await db
                .select({
                    movieId: watchlist.movieId,
                    title: watchlist.title,
                    posterPath: watchlist.posterPath,
                    createdAt: watchlist.createdAt,
                })
                .from(watchlist)
                .where(eq(watchlist.userId, userId))
                .orderBy(desc(watchlist.createdAt))
            return rows.map((r) => ({
                movieId: r.movieId,
                title: r.title,
                posterPath: r.posterPath,
                createdAt: r.createdAt.toISOString(),
            }))
        },

        async cacheAdd(userId, movieId) {
            await redis.sadd(setKey(userId), String(movieId))
        },
        async cacheRemove(userId, movieId) {
            await redis.srem(setKey(userId), String(movieId))
        },
        async cacheHas(userId, movieId) {
            // An empty/absent set in Redis means "not yet populated" — fall back
            // to Postgres (caller hydrates) rather than wrongly reporting absent.
            const populated = await redis.exists(setKey(userId))
            if (!populated) return undefined
            return redis.sismember(setKey(userId), String(movieId))
        },
        async cacheHydrate(userId, movieIds) {
            if (movieIds.length === 0) return
            await redis.sadd(setKey(userId), ...movieIds.map(String))
        },
    }
}

/** Add a movie; idempotent. `added` is false if it was already on the list. */
export async function addToWatchlist(
    userId: string,
    item: WatchlistAdd,
    deps: WatchlistDeps = defaultDeps(),
): Promise<{ added: boolean }> {
    const added = await deps.dbInsert(userId, item)
    await deps.cacheAdd(userId, item.movieId)
    return { added }
}

/** Remove a movie; idempotent. `removed` is false if it wasn't on the list. */
export async function removeFromWatchlist(
    userId: string,
    movieId: number,
    deps: WatchlistDeps = defaultDeps(),
): Promise<{ removed: boolean }> {
    const removed = await deps.dbDelete(userId, movieId)
    await deps.cacheRemove(userId, movieId)
    return { removed }
}

/** The user's full watchlist, newest first. */
export async function getWatchlist(
    userId: string,
    deps: WatchlistDeps = defaultDeps(),
): Promise<WatchlistEntry[]> {
    return deps.dbList(userId)
}

/** O(1) membership via the Redis Set, hydrating from Postgres on a cold miss. */
export async function isInWatchlist(
    userId: string,
    movieId: number,
    deps: WatchlistDeps = defaultDeps(),
): Promise<boolean> {
    const cached = await deps.cacheHas(userId, movieId)
    if (cached !== undefined) return cached

    // Cold cache: rebuild the membership set from the source of truth.
    const ids = (await deps.dbList(userId)).map((e) => e.movieId)
    await deps.cacheHydrate(userId, ids)
    return ids.includes(movieId)
}
