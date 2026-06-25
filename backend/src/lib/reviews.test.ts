import { describe, expect, it } from 'bun:test'
import { getRecentReviews, upsertReview, type ReviewDeps } from './reviews'
import type { ReviewEntry } from '../schemas/review'

const entry = (id: string, movieId = 5): ReviewEntry => ({
    id,
    userId: 'u1',
    movieId,
    rating: 8,
    content: `review ${id}`,
    createdAt: '2026-01-01T00:00:00.000Z',
})

const fakeDeps = (over: Partial<ReviewDeps> = {}, dbRows?: ReviewEntry[]) => {
    const recent = new Map<number, ReviewEntry[]>()
    const calls = { upsert: 0, invalidate: 0, hydrate: 0, dbList: 0 }
    const deps: ReviewDeps = {
        async dbUpsert(_userId, input) {
            calls.upsert++
            return entry('new', input.movieId)
        },
        async dbListForMovie(movieId) {
            calls.dbList++
            return dbRows ?? [entry('a', movieId), entry('b', movieId)]
        },
        async cacheInvalidateRecent(movieId) {
            calls.invalidate++
            recent.delete(movieId)
        },
        async cacheGetRecent(movieId) {
            return recent.get(movieId) ?? null
        },
        async cacheHydrateRecent(movieId, entries) {
            calls.hydrate++
            recent.set(movieId, entries)
        },
        ...over,
    }
    return { deps, recent, calls }
}

describe('upsertReview', () => {
    it('stores the review and invalidates the recent cache (feature)', async () => {
        const { deps, calls } = fakeDeps()
        const out = await upsertReview('u1', { movieId: 5, content: 'great', rating: 9 }, deps)
        expect(out.id).toBe('new')
        expect(calls.upsert).toBe(1)
        expect(calls.invalidate).toBe(1)
    })

    it('editing a review does not leave a stale duplicate in the listing (regression)', async () => {
        // A warm cache holds the pre-edit review; upserting must invalidate it so
        // the next read re-hydrates from Postgres (one row per user/movie) rather
        // than serving both the old and new copy.
        const { deps, recent, calls } = fakeDeps()
        recent.set(5, [{ ...entry('r1'), rating: 9, content: 'first take' }])
        await upsertReview('u1', { movieId: 5, content: 'edited take', rating: 8 }, deps)
        expect(calls.invalidate).toBe(1)
        expect(recent.has(5)).toBe(false) // cache dropped; next read hydrates fresh
    })
})

describe('getRecentReviews', () => {
    it('serves from the cache on a warm hit without hitting the DB (feature)', async () => {
        const { deps, recent, calls } = fakeDeps()
        recent.set(5, [entry('cached')])
        const out = await getRecentReviews(5, deps)
        expect(out.map((r) => r.id)).toEqual(['cached'])
        expect(calls.dbList).toBe(0)
        expect(calls.hydrate).toBe(0)
    })

    it('hydrates from Postgres on a cold cache, then returns (edge: cold start)', async () => {
        const { deps, calls } = fakeDeps()
        const out = await getRecentReviews(5, deps)
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
        const out = await getRecentReviews(5, deps)
        expect(out.map((r) => r.id)).toEqual(['a', 'b']) // served from Postgres
        expect(calls.dbList).toBe(1)
    })

    it('caches a zero-review movie so repeat reads do not re-query Postgres (regression)', async () => {
        // Previously the cache stored nothing for an empty list and a read mapped
        // an absent key to "cold", so every read of a no-review movie was a cold
        // miss that re-ran the DB query. Now an empty list is a real cache hit.
        const { deps, calls } = fakeDeps({}, [])
        const first = await getRecentReviews(7, deps)
        expect(first).toEqual([])
        expect(calls.dbList).toBe(1)
        expect(calls.hydrate).toBe(1)

        const second = await getRecentReviews(7, deps)
        expect(second).toEqual([])
        expect(calls.dbList).toBe(1) // unchanged: served from the cached empty list
    })
})
