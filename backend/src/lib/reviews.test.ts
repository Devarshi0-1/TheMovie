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

const fakeDeps = (over: Partial<ReviewDeps> = {}) => {
    const recent = new Map<number, ReviewEntry[]>()
    const calls = { upsert: 0, push: 0, hydrate: 0, dbList: 0 }
    const deps: ReviewDeps = {
        async dbUpsert(_userId, input) {
            calls.upsert++
            return entry('new', input.movieId)
        },
        async dbListForMovie(movieId) {
            calls.dbList++
            return [entry('a', movieId), entry('b', movieId)]
        },
        async cachePushRecent(movieId, e) {
            calls.push++
            recent.set(movieId, [e, ...(recent.get(movieId) ?? [])])
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
    it('stores the review and pushes it onto the recent cache (feature)', async () => {
        const { deps, calls, recent } = fakeDeps()
        const out = await upsertReview('u1', { movieId: 5, content: 'great', rating: 9 }, deps)
        expect(out.id).toBe('new')
        expect(calls.upsert).toBe(1)
        expect(calls.push).toBe(1)
        expect(recent.get(5)).toHaveLength(1)
    })
})

describe('getRecentReviews', () => {
    it('serves from the Redis List on a warm cache without hitting the DB (feature)', async () => {
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
        expect(calls.hydrate).toBe(1) // membership list rebuilt
    })
})
