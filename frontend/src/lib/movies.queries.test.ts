import { afterEach, describe, expect, it, vi } from 'vitest'
import { fetchMovieDetails, fetchMovieSummary, fetchTrending, searchMovies } from './movies'

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

// The movie endpoints now return the shared camelCase shapes (the backend maps
// TMDB → MovieResult / MovieDetailView), so these fixtures mirror the server
// contract and the queries validate rather than map.
const DISPLAY_LIST = [
    {
        tmdbId: 550,
        title: 'Fight Club',
        overview: 'x',
        releaseDate: '1999-10-15',
        genres: ['Drama'],
        posterPath: '/p.jpg',
    },
]

afterEach(() => {
    vi.unstubAllGlobals()
})

describe('live movie queries', () => {
    // ── Feature / happy path ──────────────────────────────────────────────
    it('fetchTrending validates display movies from the server', async () => {
        mockFetch(() => jsonResponse(DISPLAY_LIST))
        const movies = await fetchTrending()
        expect(movies[0]).toMatchObject({ tmdbId: 550, title: 'Fight Club', genres: ['Drama'] })
    })

    it('searchMovies URL-encodes the query', async () => {
        const spy = mockFetch(() => jsonResponse(DISPLAY_LIST))
        await searchMovies('the matrix & more')
        expect(spy.mock.calls[0]![0]).toContain('q=the%20matrix%20%26%20more')
    })

    it('fetchMovieDetails validates the detail view payload', async () => {
        mockFetch(() =>
            jsonResponse({
                tmdbId: 550,
                title: 'Fight Club',
                overview: null,
                releaseDate: null,
                genres: ['Drama'],
                posterPath: null,
                backdropPath: '/b.jpg',
                tagline: 'Soap.',
                runtime: 139,
                voteAverage: 8.4,
            }),
        )
        const details = await fetchMovieDetails(550)
        expect(details).toMatchObject({
            tmdbId: 550,
            runtime: 139,
            genres: ['Drama'],
            backdropPath: '/b.jpg',
        })
    })

    it('throws when a movie payload is missing required fields (edge: boundary validation)', async () => {
        mockFetch(() => jsonResponse([{ title: 'no id' }]))
        await expect(fetchTrending()).rejects.toThrow()
    })

    it('fetchMovieSummary validates the spoiler-free summary shape', async () => {
        mockFetch(() => jsonResponse({ vibe: 'Loved it', pros: ['twist'], cons: [] }))
        const summary = await fetchMovieSummary(550)
        expect(summary.vibe).toBe('Loved it')
        expect(summary.pros).toEqual(['twist'])
    })

    // ── Edge cases ────────────────────────────────────────────────────────
    it('throws when the summary payload is malformed', async () => {
        mockFetch(() => jsonResponse({ vibe: 123 }))
        await expect(fetchMovieSummary(550)).rejects.toThrow()
    })

    it('propagates a 500 from the trending endpoint', async () => {
        mockFetch(() => jsonResponse({ error: 'Failed to fetch trending movies' }, 500))
        await expect(fetchTrending()).rejects.toMatchObject({ status: 500 })
    })
})
