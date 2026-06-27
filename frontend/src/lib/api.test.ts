import { afterEach, describe, expect, it, vi } from 'vitest'
import { apiDelete, ApiError, apiFetch, API_BASE, apiPost } from './api'

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

afterEach(() => {
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
})

describe('apiFetch', () => {
    // ── Feature / happy path ──────────────────────────────────────────────
    it('resolves the parsed JSON body on a 2xx response', async () => {
        mockFetch(() => jsonResponse({ hello: 'world' }))
        await expect(apiFetch('/api/v1/thing')).resolves.toEqual({ hello: 'world' })
    })

    it('prefixes a relative path with API_BASE and always sends credentials', async () => {
        const spy = mockFetch(() => jsonResponse({ ok: true }))
        await apiFetch('/api/v1/movies/trending')
        expect(spy).toHaveBeenCalledWith(
            `${API_BASE}/api/v1/movies/trending`,
            expect.objectContaining({ credentials: 'include' }),
        )
    })

    it('leaves an absolute URL untouched', async () => {
        const spy = mockFetch(() => jsonResponse({}))
        await apiFetch('https://example.com/x')
        expect(spy).toHaveBeenCalledWith('https://example.com/x', expect.anything())
    })

    it('apiPost sends a JSON body with a Content-Type header', async () => {
        const spy = mockFetch(() => jsonResponse({ added: true }))
        await apiPost('/api/v1/watchlist', { movieId: 1, title: 'X' })
        const init = spy.mock.calls[0]![1] as RequestInit
        expect(init.method).toBe('POST')
        expect(init.body).toBe(JSON.stringify({ movieId: 1, title: 'X' }))
        // Headers are normalized through a `Headers` instance before fetch.
        expect(new Headers(init.headers).get('Content-Type')).toBe('application/json')
    })

    it('apiDelete issues a DELETE without a body or Content-Type', async () => {
        const spy = mockFetch(() => jsonResponse({ removed: true }))
        await apiDelete('/api/v1/watchlist/5')
        const init = spy.mock.calls[0]![1] as RequestInit
        expect(init.method).toBe('DELETE')
        expect(new Headers(init.headers).get('Content-Type')).toBeNull()
    })

    // ── Edge cases ────────────────────────────────────────────────────────
    it('throws an ApiError carrying the status and the backend error message', async () => {
        mockFetch(() => jsonResponse({ error: 'Unauthorized' }, 401))
        await expect(apiFetch('/api/v1/watchlist')).rejects.toMatchObject({
            name: 'ApiError',
            status: 401,
            message: 'Unauthorized',
        })
    })

    it('surfaces validation issues from a 400 envelope', async () => {
        const issues = [{ path: ['movieId'], message: 'Required' }]
        mockFetch(() => jsonResponse({ error: 'Invalid request body', issues }, 400))
        const err = await apiFetch('/api/v1/watchlist').catch((e) => e as ApiError)
        expect(err).toBeInstanceOf(ApiError)
        expect((err as ApiError).issues).toEqual(issues)
    })

    it('falls back to a status message when the error body has no `error` field', async () => {
        mockFetch(() => new Response('upstream exploded', { status: 500 }))
        await expect(apiFetch('/api/v1/movies/trending')).rejects.toMatchObject({
            status: 500,
            message: 'Request failed with status 500',
        })
    })

    it('wraps a network failure in an ApiError with status 0', async () => {
        mockFetch(() => {
            throw new TypeError('Failed to fetch')
        })
        await expect(apiFetch('/api/v1/x')).rejects.toMatchObject({
            name: 'ApiError',
            status: 0,
        })
    })

    it('returns null for an empty 2xx body without throwing', async () => {
        mockFetch(() => new Response('', { status: 200 }))
        await expect(apiFetch('/api/v1/x')).resolves.toBeNull()
    })
})
