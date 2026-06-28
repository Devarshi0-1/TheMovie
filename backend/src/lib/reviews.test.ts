import { describe, expect, it } from 'bun:test'
import { getRecentReviews, upsertReview, type ReviewDeps } from './reviews'
import type { MediaType, ReviewEntry } from '@themovie/schemas'

const entry = (id: string, movieId = 5, mediaType: MediaType = 'movie'): ReviewEntry => ({
    id,
    userId: 'u1',
    movieId,
    mediaType,
    rating: 8,
    content: `review ${id}`,
    createdAt: '2026-01-01T00:00:00.000Z',
})

const key = (movieId: number, mediaType: MediaType) => `${mediaType}:${movieId}`

const fakeDeps = (over: Partial<ReviewDeps> = {}, dbRows?: ReviewEntry[]) => {
    const recent = new Map<string, ReviewEntry[]>()
    const calls = { upsert: 0, invalidate: 0, hydrate: 0, dbList: 0 }
    const deps: ReviewDeps = {
        async dbUpsert(_userId, input) {
            calls.upsert++
            return entry('new', input.movieId, input.mediaType)
        },
        async dbListForMovie(movieId, mediaType) {
            calls.dbList++
            return dbRows ?? [entry('a', movieId, mediaType), entry('b', movieId, mediaType)]
        },
        async cacheInvalidateRecent(movieId, mediaType) {
            calls.invalidate++
            recent.delete(key(movieId, mediaType))
        },
        async cacheGetRecent(movieId, mediaType) {
            return recent.get(key(movieId, mediaType)) ?? null
        },
        async cacheHydrateRecent(movieId, mediaType, entries) {
            calls.hydrate++
            recent.set(key(movieId, mediaType), entries)
        },
        ...over,
    }
    return { deps, recent, calls }
}

describe('upsertReview', () => {
    it('stores the review and invalidates the recent cache (feature)', async () => {
        const { deps, calls } = fakeDeps()
        const out = await upsertReview(
            'u1',
            { movieId: 5, content: 'great', rating: 9, mediaType: 'movie' },
            deps,
        )
        expect(out.id).toBe('new')
        expect(calls.upsert).toBe(1)
        expect(calls.invalidate).toBe(1)
    })

    it('carries the media type through to the stored entry (feature: TV reviews)', async () => {
        const { deps } = fakeDeps()
        const out = await upsertReview(
            'u1',
            { movieId: 1396, content: 'great show', rating: 10, mediaType: 'tv' },
            deps,
        )
        expect(out.mediaType).toBe('tv')
        expect(out.movieId).toBe(1396)
    })

    it('editing a review does not leave a stale duplicate in the listing (regression)', async () => {
        // A warm cache holds the pre-edit review; upserting must invalidate it so
        // the next read re-hydrates from Postgres (one row per user/movie) rather
        // than serving both the old and new copy.
        const { deps, recent, calls } = fakeDeps()
        recent.set('movie:5', [{ ...entry('r1'), rating: 9, content: 'first take' }])
        await upsertReview(
            'u1',
            { movieId: 5, content: 'edited take', rating: 8, mediaType: 'movie' },
            deps,
        )
        expect(calls.invalidate).toBe(1)
        expect(recent.has('movie:5')).toBe(false) // cache dropped; next read hydrates fresh
    })
})

describe('getRecentReviews', () => {
    it('serves from the cache on a warm hit without hitting the DB (feature)', async () => {
        const { deps, recent, calls } = fakeDeps()
        recent.set('movie:5', [entry('cached')])
        const out = await getRecentReviews(5, 'movie', deps)
        expect(out.map((r) => r.id)).toEqual(['cached'])
        expect(calls.dbList).toBe(0)
        expect(calls.hydrate).toBe(0)
    })

    it('keeps movie and TV recent lists separate for the same id (edge: mediaType)', async () => {
        const { deps, recent } = fakeDeps()
        recent.set('movie:1396', [entry('film', 1396, 'movie')])
        recent.set('tv:1396', [entry('show', 1396, 'tv')])
        expect((await getRecentReviews(1396, 'tv', deps)).map((r) => r.id)).toEqual(['show'])
        expect((await getRecentReviews(1396, 'movie', deps)).map((r) => r.id)).toEqual(['film'])
    })

    it('hydrates from Postgres on a cold cache, then returns (edge: cold start)', async () => {
        const { deps, calls } = fakeDeps()
        const out = await getRecentReviews(5, 'movie', deps)
        expect(out.map((r) => r.id)).toEqual(['a', 'b'])
        expect(calls.dbList).toBe(1)
        expect(calls.hydrate).toBe(1) // recent list rebuilt
    })

    it('falls back to Postgres when the cache read throws (regression: WRONGTYPE / outage)', async () => {
        // A key left in the old Redis List representation reads as WRONGTYPE, and
        // a Redis blip throws too. Neither must 500 the request — getRecentReviews
        // degrades to the DB, and the hydrate (which throws here too) is swallowed.
        const { deps, calls } = fakeDeps({
            cacheGetRecent: async () => {
                throw new Error('WRONGTYPE Operation against a key holding the wrong kind of value')
            },
            cacheHydrateRecent: async () => {
                throw new Error('still wedged')
            },
        })
        const out = await getRecentReviews(5, 'movie', deps)
        expect(out.map((r) => r.id)).toEqual(['a', 'b']) // served from Postgres
        expect(calls.dbList).toBe(1)
    })

    it('caches a zero-review title so repeat reads do not re-query Postgres (regression)', async () => {
        // Previously the cache stored nothing for an empty list and a read mapped
        // an absent key to "cold", so every read of a no-review title was a cold
        // miss that re-ran the DB query. Now an empty list is a real cache hit.
        const { deps, calls } = fakeDeps({}, [])
        const first = await getRecentReviews(7, 'movie', deps)
        expect(first).toEqual([])
        expect(calls.dbList).toBe(1)
        expect(calls.hydrate).toBe(1)

        const second = await getRecentReviews(7, 'movie', deps)
        expect(second).toEqual([])
        expect(calls.dbList).toBe(1) // unchanged: served from the cached empty list
    })
})
