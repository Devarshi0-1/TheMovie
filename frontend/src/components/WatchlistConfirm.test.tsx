import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { WatchlistConfirm } from './WatchlistConfirm'

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

const addInput = { action: 'add', movieId: 27205, title: 'Inception', posterPath: '/p.jpg' }
const removeInput = { action: 'remove', movieId: 27205, title: 'Inception' }

afterEach(() => {
    vi.unstubAllGlobals()
})

describe('<WatchlistConfirm />', () => {
    // ── Feature / happy path ──────────────────────────────────────────────
    it('renders the proposed add and approving performs a POST then resolves "added"', async () => {
        const spy = mockFetch(() => jsonResponse({ added: true, movieId: 27205 }, 201))
        const onResolve = vi.fn()
        render(<WatchlistConfirm input={addInput} onResolve={onResolve} />)

        expect(screen.getByText(/Add/)).toBeInTheDocument()
        expect(screen.getByText('Inception')).toBeInTheDocument()
        fireEvent.click(screen.getByRole('button', { name: 'Yes, add it' }))

        await waitFor(() =>
            expect(onResolve).toHaveBeenCalledWith({
                status: 'added',
                movieId: 27205,
                title: 'Inception',
            }),
        )
        expect(spy.mock.calls[0]![1]?.method).toBe('POST')
    })

    it('approving a remove proposal performs a DELETE then resolves "removed"', async () => {
        const spy = mockFetch(() => jsonResponse({ removed: true, movieId: 27205 }))
        const onResolve = vi.fn()
        render(<WatchlistConfirm input={removeInput} onResolve={onResolve} />)

        fireEvent.click(screen.getByRole('button', { name: 'Yes, remove it' }))
        await waitFor(() =>
            expect(onResolve).toHaveBeenCalledWith({
                status: 'removed',
                movieId: 27205,
                title: 'Inception',
            }),
        )
        expect(spy.mock.calls[0]![1]?.method).toBe('DELETE')
    })

    // ── Edge cases ────────────────────────────────────────────────────────
    it('denying resolves "declined" and never calls the API', () => {
        const spy = mockFetch(() => jsonResponse({}))
        const onResolve = vi.fn()
        render(<WatchlistConfirm input={addInput} onResolve={onResolve} />)

        fireEvent.click(screen.getByRole('button', { name: 'No' }))
        expect(onResolve).toHaveBeenCalledWith({
            status: 'declined',
            movieId: 27205,
            title: 'Inception',
        })
        expect(spy).not.toHaveBeenCalled()
    })

    it('shows an error and does NOT resolve when the mutation fails', async () => {
        mockFetch(() => jsonResponse({ error: 'Unauthorized' }, 401))
        const onResolve = vi.fn()
        render(<WatchlistConfirm input={addInput} onResolve={onResolve} />)

        fireEvent.click(screen.getByRole('button', { name: 'Yes, add it' }))
        expect(await screen.findByText('Unauthorized')).toBeInTheDocument()
        expect(onResolve).not.toHaveBeenCalled()
    })

    it('rejects a structurally invalid proposal without offering actions', () => {
        const onResolve = vi.fn()
        render(<WatchlistConfirm input={{ action: 'frobnicate' }} onResolve={onResolve} />)
        expect(screen.getByRole('alert')).toHaveTextContent('invalid watchlist change')
        expect(screen.queryByRole('button')).not.toBeInTheDocument()
    })
})
