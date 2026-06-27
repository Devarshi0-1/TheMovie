import { describe, expect, it } from 'bun:test'
import { summarizeReviews, type SummaryDeps } from './summary'
import type { ReviewSummary } from '@themovie/schemas'

const summary: ReviewSummary = {
    vibe: 'A tense, well-acted thriller.',
    pros: ['Strong performances', 'Gripping pacing'],
    cons: ['Slow middle act'],
}

// Fake deps recording calls; override seams per test.
const fakeDeps = (over: Partial<SummaryDeps> = {}) => {
    const cache = new Map<string, string>()
    const calls = { fetch: 0, summarize: 0, cacheSet: [] as { key: string; ttl: number }[] }
    const deps: SummaryDeps = {
        async fetchReviews() {
            calls.fetch++
            return ['Great movie, loved the acting.', 'A bit slow but worth it.']
        },
        async summarize() {
            calls.summarize++
            return summary
        },
        async cacheGet(key) {
            return cache.get(key) ?? null
        },
        async cacheSet(key, value, ttl) {
            calls.cacheSet.push({ key, ttl })
            cache.set(key, value)
        },
        ...over,
    }
    return { deps, cache, calls }
}

describe('summarizeReviews', () => {
    it('fetches, summarizes, and caches on a miss (feature)', async () => {
        const { deps, calls, cache } = fakeDeps()
        const out = await summarizeReviews(42, deps)
        expect(out).toEqual(summary)
        expect(calls.fetch).toBe(1)
        expect(calls.summarize).toBe(1)
        expect(cache.get('movie:42:summary')).toBe(JSON.stringify(summary))
    })

    it('serves a cached summary without fetching or summarizing (feature: cost rule)', async () => {
        const { deps, calls } = fakeDeps({
            async cacheGet() {
                return JSON.stringify(summary)
            },
        })
        const out = await summarizeReviews(42, deps)
        expect(out).toEqual(summary)
        expect(calls.fetch).toBe(0)
        expect(calls.summarize).toBe(0)
    })

    it('returns a neutral placeholder (short TTL) when there are no reviews (edge)', async () => {
        const { deps, calls } = fakeDeps({
            async fetchReviews() {
                return []
            },
        })
        const out = await summarizeReviews(7, deps)
        expect(out.pros).toEqual([])
        expect(out.cons).toEqual([])
        expect(out.vibe).toMatch(/no audience reviews/i)
        expect(calls.summarize).toBe(0) // never paid for a model call
        // Cached with a shorter TTL than a real summary so it refreshes sooner.
        expect(calls.cacheSet[0].ttl).toBeLessThan(60 * 60 * 24 * 7)
    })

    it('regenerates when the cache entry is corrupt (edge: resilience)', async () => {
        const { deps, calls } = fakeDeps({
            async cacheGet() {
                return 'not-json{'
            },
        })
        const out = await summarizeReviews(42, deps)
        expect(out).toEqual(summary)
        expect(calls.summarize).toBe(1) // fell through to a fresh summary
    })

    it('keys the cache by movie id (feature)', async () => {
        const { deps, calls } = fakeDeps()
        await summarizeReviews(99, deps)
        expect(calls.cacheSet[0].key).toBe('movie:99:summary')
    })
})
