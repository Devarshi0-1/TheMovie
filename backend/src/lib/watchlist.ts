import { and, desc, eq } from 'drizzle-orm'
import { db } from '../db'
import { watchlist } from '../db/schema'
import { redis } from './redis'
import type { MediaType, WatchlistAdd, WatchlistEntry } from '@themovie/schemas'

// Watchlist persistence. Postgres is the source of truth (respecting the
// `unique_user_media` constraint over (user, mediaType, movieId)); a Redis Set
// per user mirrors membership for O(1) "is this on my watchlist?" checks,
// hydrated from Postgres on a cold miss. Because a movie and a show can share a
// TMDB id, set members are namespaced as `${mediaType}:${movieId}` and the key
// is versioned (`watchlist:v2:…`) so pre-Phase-10.3 sets (bare-id members) are
// abandoned rather than misread. All IO is behind injectable deps so the service
// is testable offline.

export interface WatchlistDeps {
    /** Insert, ignoring duplicates. Returns true only if a new row was created. */
    dbInsert(userId: string, item: WatchlistAdd): Promise<boolean>
    /** Delete by (user, mediaType, movie). Returns true if a row was removed. */
    dbDelete(userId: string, movieId: number, mediaType: MediaType): Promise<boolean>
    /** All of the user's entries, newest first. */
    dbList(userId: string): Promise<WatchlistEntry[]>
    cacheAdd(userId: string, movieId: number, mediaType: MediaType): Promise<void>
    cacheRemove(userId: string, movieId: number, mediaType: MediaType): Promise<void>
    /** Membership from the cache, or undefined if the set isn't populated (cold). */
    cacheHas(userId: string, movieId: number, mediaType: MediaType): Promise<boolean | undefined>
    /** Populate the membership set from the authoritative `mediaType:id` members. */
    cacheHydrate(userId: string, members: string[]): Promise<void>
}

const setKey = (userId: string) => `watchlist:v2:${userId}`
/** Namespaced set member — disambiguates a film from a show with the same id. */
const member = (movieId: number, mediaType: MediaType) => `${mediaType}:${movieId}`

function defaultDeps(): WatchlistDeps {
    return {
        async dbInsert(userId, item) {
            const inserted = await db
                .insert(watchlist)
                .values({
                    userId,
                    movieId: item.movieId,
                    mediaType: item.mediaType,
                    title: item.title,
                    posterPath: item.posterPath ?? null,
                })
                .onConflictDoNothing({
                    target: [watchlist.userId, watchlist.mediaType, watchlist.movieId],
                })
                .returning({ id: watchlist.id })
            return inserted.length > 0
        },

        async dbDelete(userId, movieId, mediaType) {
            const deleted = await db
                .delete(watchlist)
                .where(
                    and(
                        eq(watchlist.userId, userId),
                        eq(watchlist.mediaType, mediaType),
                        eq(watchlist.movieId, movieId),
                    ),
                )
                .returning({ id: watchlist.id })
            return deleted.length > 0
        },

        async dbList(userId) {
            const rows = await db
                .select({
                    movieId: watchlist.movieId,
                    mediaType: watchlist.mediaType,
                    title: watchlist.title,
                    posterPath: watchlist.posterPath,
                    createdAt: watchlist.createdAt,
                })
                .from(watchlist)
                .where(eq(watchlist.userId, userId))
                .orderBy(desc(watchlist.createdAt))
            return rows.map((r) => ({
                movieId: r.movieId,
                mediaType: r.mediaType as MediaType,
                title: r.title,
                posterPath: r.posterPath,
                createdAt: r.createdAt.toISOString(),
            }))
        },

        async cacheAdd(userId, movieId, mediaType) {
            // Only mirror into an ALREADY-populated set. Creating a one-member set
            // on a cold cache would leave it partially populated: `cacheHas` would
            // then see `exists()=true` and answer false for every OTHER title the
            // user really has (the set has no TTL, so the wholesale hydrate never
            // re-runs). A cold set is instead left absent so the next
            // `isInWatchlist` rebuilds it in full from Postgres.
            if (await redis.exists(setKey(userId))) {
                await redis.sadd(setKey(userId), member(movieId, mediaType))
            }
        },
        async cacheRemove(userId, movieId, mediaType) {
            await redis.srem(setKey(userId), member(movieId, mediaType))
        },
        async cacheHas(userId, movieId, mediaType) {
            // An empty/absent set in Redis means "not yet populated" — fall back
            // to Postgres (caller hydrates) rather than wrongly reporting absent.
            const populated = await redis.exists(setKey(userId))
            if (!populated) return undefined
            return redis.sismember(setKey(userId), member(movieId, mediaType))
        },
        async cacheHydrate(userId, members) {
            if (members.length === 0) return
            await redis.sadd(setKey(userId), ...members)
        },
    }
}

/** Add a movie/show; idempotent. `added` is false if it was already on the list. */
export async function addToWatchlist(
    userId: string,
    item: WatchlistAdd,
    deps: WatchlistDeps = defaultDeps(),
): Promise<{ added: boolean }> {
    const added = await deps.dbInsert(userId, item)
    await deps.cacheAdd(userId, item.movieId, item.mediaType)
    return { added }
}

/** Remove a movie/show; idempotent. `removed` is false if it wasn't on the list. */
export async function removeFromWatchlist(
    userId: string,
    movieId: number,
    mediaType: MediaType,
    deps: WatchlistDeps = defaultDeps(),
): Promise<{ removed: boolean }> {
    const removed = await deps.dbDelete(userId, movieId, mediaType)
    await deps.cacheRemove(userId, movieId, mediaType)
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
    mediaType: MediaType,
    deps: WatchlistDeps = defaultDeps(),
): Promise<boolean> {
    const cached = await deps.cacheHas(userId, movieId, mediaType)
    if (cached !== undefined) return cached

    // Cold cache: rebuild the membership set from the source of truth.
    const entries = await deps.dbList(userId)
    await deps.cacheHydrate(
        userId,
        entries.map((e) => member(e.movieId, e.mediaType)),
    )
    return entries.some((e) => e.movieId === movieId && e.mediaType === mediaType)
}
