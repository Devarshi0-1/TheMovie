import { afterEach, beforeEach, describe, expect, it } from 'bun:test'
import { fetchFromTMDB, getTrendingMovies, searchMovie, type TmdbCache } from './tmdb'

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

// TMDB's edge resets connections intermittently from some networks; fetchFromTMDB
// retries transient failures with exponential backoff. The `sleep` is injected so
// these tests exercise the loop without actually waiting.
describe('fetchFromTMDB retry/backoff', () => {
    const makeSleep = () => {
        const delays: number[] = []
        return { delays, sleep: async (ms: number) => void delays.push(ms) }
    }

    const okResponse = (payload: unknown) =>
        ({ ok: true, status: 200, statusText: 'OK', json: async () => payload }) as Response

    const errResponse = (status: number, statusText = 'ERR') =>
        ({ ok: false, status, statusText, json: async () => ({}) }) as Response

    it('retries a network reset (ECONNRESET) and then succeeds (feature)', async () => {
        let calls = 0
        globalThis.fetch = (async () => {
            calls++
            if (calls < 3) throw new Error('ECONNRESET')
            return okResponse({ ok: true })
        }) as unknown as typeof fetch
        const { delays, sleep } = makeSleep()

        const out = await fetchFromTMDB<{ ok: boolean }>('/x', { baseDelayMs: 10, sleep })
        expect(out).toEqual({ ok: true })
        expect(calls).toBe(3) // failed twice, third attempt succeeded
        expect(delays).toEqual([10, 20]) // exponential backoff before each retry
    })

    it('retries a transient 503 and then succeeds (feature)', async () => {
        let calls = 0
        globalThis.fetch = (async () => {
            calls++
            return calls < 2 ? errResponse(503, 'Service Unavailable') : okResponse({ id: 1 })
        }) as unknown as typeof fetch
        const { delays, sleep } = makeSleep()

        const out = await fetchFromTMDB<{ id: number }>('/x', { baseDelayMs: 10, sleep })
        expect(out).toEqual({ id: 1 })
        expect(calls).toBe(2)
        expect(delays).toEqual([10])
    })

    it('gives up after maxRetries on a persistent reset and rethrows (edge)', async () => {
        let calls = 0
        globalThis.fetch = (async () => {
            calls++
            throw new Error('ECONNRESET')
        }) as unknown as typeof fetch
        const { delays, sleep } = makeSleep()

        await expect(
            fetchFromTMDB('/x', { maxRetries: 2, baseDelayMs: 10, sleep }),
        ).rejects.toThrow('ECONNRESET')
        expect(calls).toBe(3) // initial attempt + 2 retries
        expect(delays).toEqual([10, 20]) // slept before each retry, none after the last
    })

    it('does NOT retry a 404 — fails fast (edge)', async () => {
        let calls = 0
        globalThis.fetch = (async () => {
            calls++
            return errResponse(404, 'Not Found')
        }) as unknown as typeof fetch
        const { delays, sleep } = makeSleep()

        await expect(fetchFromTMDB('/x', { baseDelayMs: 10, sleep })).rejects.toThrow(
            'Failed to fetch from TMDB',
        )
        expect(calls).toBe(1) // a client error is not retryable
        expect(delays).toEqual([])
    })

    it('throws immediately when the API key is missing, without fetching (edge)', async () => {
        delete process.env.TMDB_READ_ACCESS_API_KEY
        let calls = 0
        globalThis.fetch = (async () => {
            calls++
            return okResponse({})
        }) as unknown as typeof fetch

        await expect(fetchFromTMDB('/x')).rejects.toThrow('TMDB_READ_ACCESS_API_KEY is not defined')
        expect(calls).toBe(0)
    })
})
