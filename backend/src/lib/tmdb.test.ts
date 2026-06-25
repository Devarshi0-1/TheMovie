import { afterEach, beforeEach, describe, expect, it } from 'bun:test'
import { getTrendingMovies, searchMovie, type TmdbCache } from './tmdb'

// Inject a fake cache (no './redis' module mock — that would leak across test
// files) and stub global fetch for the network. Both are reset per test.
const store = new Map<string, string>()
const fakeCache: TmdbCache = {
    async get(key) {
        return store.get(key) ?? null
    },
    async set(key, value) {
        store.set(key, value)
    },
}

const originalFetch = globalThis.fetch
let fetchCalls = 0

const stubFetch = (payload: unknown) => {
    fetchCalls = 0
    globalThis.fetch = (async () => {
        fetchCalls++
        return { ok: true, statusText: 'OK', json: async () => payload } as Response
    }) as unknown as typeof fetch
}

beforeEach(() => {
    store.clear()
    process.env.TMDB_READ_ACCESS_API_KEY = 'test-token'
})

afterEach(() => {
    globalThis.fetch = originalFetch
})

// Regression (Phase 4.2): searchMovie previously returned the results array on a
// cache miss but the whole response wrapper on a cache hit. Both paths must now
// return the same array shape (mirrors the Phase 0 getTrendingMovies fix).
describe('searchMovie shape consistency', () => {
    const response = {
        page: 1,
        results: [
            { id: 1, title: 'Dune' },
            { id: 2, title: 'Dune: Part Two' },
        ],
        total_pages: 1,
        total_results: 2,
    }

    it('returns the results array on a cache MISS (feature)', async () => {
        stubFetch(response)
        const out = await searchMovie('dune', fakeCache)
        expect(Array.isArray(out)).toBe(true)
        expect(out.map((m) => m.id)).toEqual([1, 2])
        expect(fetchCalls).toBe(1)
    })

    it('returns the same array shape on a cache HIT, without refetching (regression)', async () => {
        stubFetch(response)
        await searchMovie('dune', fakeCache) // populates cache
        const cachedResult = await searchMovie('dune', fakeCache) // served from cache
        expect(Array.isArray(cachedResult)).toBe(true)
        expect(cachedResult.map((m) => m.id)).toEqual([1, 2])
        expect(fetchCalls).toBe(1) // second call hit the cache, no extra fetch
    })

    it('returns [] when TMDB yields no results array (edge)', async () => {
        stubFetch({ page: 1, total_pages: 0, total_results: 0 })
        const out = await searchMovie('nonexistent film xyz', fakeCache)
        expect(out).toEqual([])
    })
})

describe('getTrendingMovies', () => {
    it('returns the results array on both miss and hit (feature)', async () => {
        stubFetch({ page: 1, results: [{ id: 9, title: 'Trending' }] })
        const miss = await getTrendingMovies(fakeCache)
        const hit = await getTrendingMovies(fakeCache)
        expect(miss.map((m) => m.id)).toEqual([9])
        expect(hit.map((m) => m.id)).toEqual([9])
        expect(fetchCalls).toBe(1)
    })
})
