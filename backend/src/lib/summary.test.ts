import { describe, expect, it } from 'bun:test'
import { summarizeReviews, type StoredSummaryRecord, type SummaryDeps } from './summary'
import type { ReviewSummary } from '@themovie/schemas'

const summary: ReviewSummary = {
    vibe: 'A tense, well-acted thriller.',
    pros: ['Strong performances', 'Gripping pacing'],
    cons: ['Slow middle act'],
}

const fakeVector = Array.from({ length: 1536 }, () => 0.1)

// Fake deps recording calls; override seams per test.
const fakeDeps = (over: Partial<SummaryDeps> = {}) => {
    const cache = new Map<string, string>()
    const calls = {
        fetch: 0,
        summarize: 0,
        embed: 0,
        load: 0,
        saved: [] as { movieId: number; record: StoredSummaryRecord }[],
        cacheSet: [] as { key: string; ttl: number }[],
    }
    const deps: SummaryDeps = {
        async fetchReviewMeta() {
            calls.fetch++
            // totalResults (17) intentionally differs from the 2 bodies, so tests
            // assert the TMDB total — not the page-1 body count — is stored.
            return {
                totalResults: 17,
                reviews: ['Great movie, loved the acting.', 'A bit slow but worth it.'],
            }
        },
        async summarize() {
            calls.summarize++
            return summary
        },
        async embedSummary() {
            calls.embed++
            return fakeVector
        },
        async loadStored() {
            calls.load++
            return null
        },
        async saveStored(movieId, record) {
            calls.saved.push({ movieId, record })
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
    it('fetches, summarizes, embeds, persists, and caches on a full miss (feature)', async () => {
        const { deps, calls, cache } = fakeDeps()
        const out = await summarizeReviews(42, deps)
        expect(out).toEqual(summary)
        expect(calls.fetch).toBe(1)
        expect(calls.summarize).toBe(1)
        expect(calls.embed).toBe(1) // reception vector (Option B) computed
        expect(cache.get('movie:42:summary')).toBe(JSON.stringify(summary))

        // Persisted durably to PG with the reception vector + change-trigger meta.
        expect(calls.saved).toHaveLength(1)
        const { movieId, record } = calls.saved[0]
        expect(movieId).toBe(42)
        expect(record.summary).toEqual(summary)
        expect(record.embedding).toBe(fakeVector)
        expect(record.reviewCount).toBe(17) // TMDB total, not the page-1 body count
        expect(record.hash).toMatch(/^[0-9a-f]{64}$/) // sha-256 of review text
    })

    it('serves a cached summary without fetching, summarizing, or hitting PG (feature: cost rule)', async () => {
        const { deps, calls } = fakeDeps({
            async cacheGet() {
                return JSON.stringify(summary)
            },
        })
        const out = await summarizeReviews(42, deps)
        expect(out).toEqual(summary)
        expect(calls.fetch).toBe(0)
        expect(calls.summarize).toBe(0)
        expect(calls.load).toBe(0) // Redis hit short-circuits before PG
    })

    it('serves a durable PG summary on a Redis miss and warms the cache (feature: durability)', async () => {
        const { deps, calls, cache } = fakeDeps({
            async loadStored() {
                calls.load++
                return summary
            },
        })
        const out = await summarizeReviews(55, deps)
        expect(out).toEqual(summary)
        expect(calls.summarize).toBe(0) // no LLM call — served from PG
        expect(calls.fetch).toBe(0)
        // Redis re-warmed at the full (not placeholder) TTL.
        expect(cache.get('movie:55:summary')).toBe(JSON.stringify(summary))
        expect(calls.cacheSet[0].ttl).toBe(60 * 60 * 24 * 7)
    })

    it('returns a neutral placeholder (short TTL, NOT persisted to PG) when there are no reviews (edge)', async () => {
        const { deps, calls } = fakeDeps({
            async fetchReviewMeta() {
                return { totalResults: 0, reviews: [] }
            },
        })
        const out = await summarizeReviews(7, deps)
        expect(out.pros).toEqual([])
        expect(out.cons).toEqual([])
        expect(out.vibe).toMatch(/no audience reviews/i)
        expect(calls.summarize).toBe(0) // never paid for a model call
        expect(calls.embed).toBe(0) // no reception vector for an empty summary
        expect(calls.saved).toHaveLength(0) // placeholder stays Redis-only
        // Shorter TTL than a real summary so it refreshes sooner.
        expect(calls.cacheSet[0].ttl).toBeLessThan(60 * 60 * 24 * 7)
    })

    it('skips the reception embedding when the summary is empty (edge: cost)', async () => {
        const empty: ReviewSummary = { vibe: '', pros: [], cons: [] }
        const { deps, calls } = fakeDeps({
            async summarize() {
                return empty
            },
        })
        await summarizeReviews(8, deps)
        expect(calls.embed).toBe(0) // composeSummaryEmbeddingText('') → no embed call
        expect(calls.saved[0].record.embedding).toBeNull()
    })

    it('still serves the summary when the PG write fails (edge: resilience)', async () => {
        const { deps } = fakeDeps({
            async saveStored() {
                throw new Error('db down')
            },
        })
        const out = await summarizeReviews(42, deps)
        expect(out).toEqual(summary) // user-facing answer unaffected
    })

    it('degrades to regeneration when the PG read fails (edge: resilience)', async () => {
        const { deps, calls } = fakeDeps({
            async loadStored() {
                throw new Error('db down')
            },
        })
        const out = await summarizeReviews(42, deps)
        expect(out).toEqual(summary)
        expect(calls.summarize).toBe(1) // fell through to a fresh summary
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
