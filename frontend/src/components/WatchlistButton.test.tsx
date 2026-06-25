import { fireEvent, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { sessionQueryKey } from '../lib/auth'
import { makeTestQueryClient, renderWithProviders } from '../test/providers'
import { WatchlistButton } from './WatchlistButton'

function jsonResponse(body: unknown, status = 200) {
    return new Response(JSON.stringify(body), {
        status,
        headers: { 'Content-Type': 'application/json' },
    })
}

function mockApi(inWatchlist: boolean) {
    const spy = vi.fn((url: string, init?: RequestInit) => {
        const method = init?.method ?? 'GET'
        if (url.includes('/status')) return jsonResponse({ inWatchlist })
        if (method === 'POST') return jsonResponse({ added: true, movieId: 550 }, 201)
        if (method === 'DELETE') return jsonResponse({ removed: true, movieId: 550 })
        return jsonResponse({})
    })
    vi.stubGlobal('fetch', spy)
    return spy
}

function signedInClient() {
    const qc = makeTestQueryClient()
    qc.setQueryData(sessionQueryKey, { id: 'u1', email: 'a@b.com', name: 'Ana' })
    return qc
}

afterEach(() => {
    vi.unstubAllGlobals()
})

const PROPS = { movieId: 550, title: 'Fight Club', posterPath: '/p.jpg' }

describe('<WatchlistButton />', () => {
    // ── Feature / happy path ──────────────────────────────────────────────
    it('offers to add a movie not yet on the watchlist, then POSTs on click', async () => {
        const spy = mockApi(false)
        renderWithProviders(<WatchlistButton {...PROPS} />, signedInClient())

        const btn = await screen.findByRole('button', { name: '+ Add to watchlist' })
        fireEvent.click(btn)

        await waitFor(() =>
            expect(
                spy.mock.calls.some(
                    ([url, init]) => url.includes('/watchlist') && init?.method === 'POST',
                ),
            ).toBe(true),
        )
    })

    it('shows an active state when the movie is already on the watchlist', async () => {
        mockApi(true)
        renderWithProviders(<WatchlistButton {...PROPS} />, signedInClient())

        const btn = await screen.findByRole('button', { name: '✓ On your watchlist' })
        expect(btn).toHaveAttribute('aria-pressed', 'true')
    })

    // ── Edge case: signed out ─────────────────────────────────────────────
    it('renders a sign-in link (not a toggle) when signed out', async () => {
        const qc = makeTestQueryClient()
        qc.setQueryData(sessionQueryKey, null)
        renderWithProviders(<WatchlistButton {...PROPS} />, qc)

        expect(await screen.findByText('Sign in to save')).toBeInTheDocument()
        expect(screen.queryByRole('button')).not.toBeInTheDocument()
    })
})
