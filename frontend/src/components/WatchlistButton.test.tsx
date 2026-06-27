import { fireEvent, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { toast } from 'sonner'
import { sessionQueryKey } from '../lib/auth'
import { makeTestQueryClient, renderWithProviders } from '../test/providers'
import { WatchlistButton } from './WatchlistButton'

// Toasts fire from a portal we don't mount here; assert on the call instead.
// `toast` is callable (neutral toast for undoable removal) AND has .success/.error.
vi.mock('sonner', () => ({
    toast: Object.assign(vi.fn(), { success: vi.fn(), error: vi.fn() }),
}))

/** The options object of the most recent neutral `toast(msg, opts)` call. */
function lastActionToast() {
    const calls = vi.mocked(toast).mock.calls
    const call = [...calls].reverse().find((c) => c[1] && 'action' in c[1])
    return call?.[1] as { action?: { label: string; onClick: () => void } } | undefined
}

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
    vi.clearAllMocks()
})

const PROPS = { movieId: 550, title: 'Fight Club', posterPath: '/p.jpg' }

describe('<WatchlistButton />', () => {
    // ── Feature / happy path ──────────────────────────────────────────────
    it('offers to add a movie not yet on the watchlist, then POSTs on click', async () => {
        const spy = mockApi(false)
        renderWithProviders(<WatchlistButton {...PROPS} />, signedInClient())

        const btn = await screen.findByRole('button', { name: 'Add to watchlist' })
        fireEvent.click(btn)

        await waitFor(() =>
            expect(
                spy.mock.calls.some(
                    ([url, init]) => url.includes('/watchlist') && init?.method === 'POST',
                ),
            ).toBe(true),
        )

        await waitFor(() =>
            expect(toast.success).toHaveBeenCalledWith('Added “Fight Club” to your watchlist'),
        )
    })

    // ── Edge case: a failed mutation toasts an error ──────────────────────
    it('shows an error toast when the add request fails', async () => {
        vi.stubGlobal(
            'fetch',
            vi.fn((url: string, init?: RequestInit) => {
                const method = init?.method ?? 'GET'
                if (url.includes('/status')) return jsonResponse({ inWatchlist: false })
                if (method === 'POST') return jsonResponse({ error: 'nope' }, 500)
                return jsonResponse({})
            }),
        )
        renderWithProviders(<WatchlistButton {...PROPS} />, signedInClient())

        fireEvent.click(await screen.findByRole('button', { name: 'Add to watchlist' }))

        await waitFor(() =>
            expect(toast.error).toHaveBeenCalledWith('Couldn’t add “Fight Club”. Try again.'),
        )
        expect(toast.success).not.toHaveBeenCalled()
    })

    it('shows an active state when the movie is already on the watchlist', async () => {
        mockApi(true)
        renderWithProviders(<WatchlistButton {...PROPS} />, signedInClient())

        const btn = await screen.findByRole('button', { name: 'On your watchlist' })
        expect(btn).toHaveAttribute('aria-pressed', 'true')
    })

    // ── Feature: removal is reversible via an Undo toast ──────────────────
    it('offers Undo after removing, and re-adds when Undo is clicked', async () => {
        const spy = mockApi(true)
        renderWithProviders(<WatchlistButton {...PROPS} />, signedInClient())

        fireEvent.click(await screen.findByRole('button', { name: 'On your watchlist' }))

        await waitFor(() =>
            expect(
                spy.mock.calls.some(
                    ([url, init]) => url.includes('/watchlist') && init?.method === 'DELETE',
                ),
            ).toBe(true),
        )

        // A neutral toast carrying an Undo action (not toast.success).
        await waitFor(() => expect(lastActionToast()?.action?.label).toBe('Undo'))
        expect(toast.success).not.toHaveBeenCalled()

        // Clicking Undo re-adds the movie (POST).
        lastActionToast()!.action!.onClick()
        await waitFor(() =>
            expect(
                spy.mock.calls.some(
                    ([url, init]) => url.includes('/watchlist') && init?.method === 'POST',
                ),
            ).toBe(true),
        )
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
