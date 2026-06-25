import { afterEach, describe, expect, it, vi } from 'vitest'
import {
    addToWatchlist,
    fetchWatchlist,
    fetchWatchlistStatus,
    removeFromWatchlist,
} from './watchlist'

function mockFetch(impl: (url: string, init?: RequestInit) => Response | Promise<Response>) {
    const spy = vi.fn(impl)
    vi.stubGlobal('fetch', spy)
    return spy
}

function jsonResponse(body: unknown, status = 200) {
    return new Response(JSON.stringify(body), {
        status,
        headers: { 'Content-Type': 'application/json' },
    })
}

const ENTRY = {
    movieId: 550,
    title: 'Fight Club',
    posterPath: '/poster.jpg',
    createdAt: '2026-01-01T00:00:00Z',
}

afterEach(() => {
    vi.unstubAllGlobals()
})

describe('watchlist data layer', () => {
    // ── Feature / happy path ──────────────────────────────────────────────
    it('fetches and validates the watchlist', async () => {
        mockFetch(() => jsonResponse([ENTRY]))
        const list = await fetchWatchlist()
        expect(list).toHaveLength(1)
        expect(list[0]!.title).toBe('Fight Club')
    })

    it('reads membership status', async () => {
        mockFetch(() => jsonResponse({ inWatchlist: true }))
        await expect(fetchWatchlistStatus(550)).resolves.toBe(true)
    })

    it('adds a movie and parses the idempotent result', async () => {
        const spy = mockFetch(() => jsonResponse({ added: true, movieId: 550 }, 201))
        const res = await addToWatchlist({
            movieId: 550,
            title: 'Fight Club',
            posterPath: '/p.jpg',
        })
        expect(res).toEqual({ added: true, movieId: 550 })
        const [url, init] = spy.mock.calls[0]!
        expect(url).toContain('/api/v1/watchlist')
        expect(init?.method).toBe('POST')
    })

    it('removes a movie by id with a DELETE', async () => {
        const spy = mockFetch(() => jsonResponse({ removed: true, movieId: 550 }))
        await expect(removeFromWatchlist(550)).resolves.toEqual({ removed: true, movieId: 550 })
        const [url, init] = spy.mock.calls[0]!
        expect(url).toContain('/api/v1/watchlist/550')
        expect(init?.method).toBe('DELETE')
    })

    // ── Edge cases ────────────────────────────────────────────────────────
    it('propagates a 401 as an ApiError (caller treats as signed-out)', async () => {
        mockFetch(() => jsonResponse({ error: 'Unauthorized' }, 401))
        await expect(fetchWatchlist()).rejects.toMatchObject({ status: 401 })
    })

    it('throws when the list payload is malformed', async () => {
        mockFetch(() => jsonResponse([{ movieId: 'nope' }]))
        await expect(fetchWatchlist()).rejects.toThrow()
    })
})
