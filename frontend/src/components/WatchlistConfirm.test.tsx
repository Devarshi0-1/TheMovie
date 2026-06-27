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

const addInput = {
    action: 'add',
    movies: [{ movieId: 27205, title: 'Inception', posterPath: '/p.jpg' }],
}
const removeInput = { action: 'remove', movies: [{ movieId: 27205, title: 'Inception' }] }
const batchAddInput = {
    action: 'add',
    movies: [
        { movieId: 1, title: 'Se7en' },
        { movieId: 2, title: 'Martyrs' },
        { movieId: 3, title: 'High Tension' },
    ],
}

afterEach(() => {
    vi.unstubAllGlobals()
})

describe('<WatchlistConfirm />', () => {
    // ── Feature / happy path ──────────────────────────────────────────────
    it('renders a single proposed add and approving POSTs then resolves "added" (feature)', async () => {
        const spy = mockFetch(() => jsonResponse({ added: true, movieId: 27205 }, 201))
        const onResolve = vi.fn()
        render(<WatchlistConfirm input={addInput} onResolve={onResolve} />)

        expect(screen.getByText('Inception')).toBeInTheDocument()
        fireEvent.click(screen.getByRole('button', { name: 'Yes, add it' }))

        await waitFor(() =>
            expect(onResolve).toHaveBeenCalledWith({
                status: 'added',
                movies: [{ movieId: 27205, title: 'Inception' }],
            }),
        )
        expect(spy.mock.calls[0]![1]?.method).toBe('POST')
    })

    it('adds a whole batch on a single approval — one POST per movie (feature)', async () => {
        const spy = mockFetch(() => jsonResponse({ added: true, movieId: 1 }, 201))
        const onResolve = vi.fn()
        render(<WatchlistConfirm input={batchAddInput} onResolve={onResolve} />)

        // Every movie is listed, and one button applies them all.
        expect(screen.getByText('Se7en')).toBeInTheDocument()
        expect(screen.getByText('High Tension')).toBeInTheDocument()
        fireEvent.click(screen.getByRole('button', { name: 'Yes, add all 3' }))

        await waitFor(() =>
            expect(onResolve).toHaveBeenCalledWith({
                status: 'added',
                movies: [
                    { movieId: 1, title: 'Se7en' },
                    { movieId: 2, title: 'Martyrs' },
                    { movieId: 3, title: 'High Tension' },
                ],
            }),
        )
        expect(spy).toHaveBeenCalledTimes(3) // one REST add per movie
    })

    it('approving a remove proposal DELETEs then resolves "removed" (feature)', async () => {
        const spy = mockFetch(() => jsonResponse({ removed: true, movieId: 27205 }))
        const onResolve = vi.fn()
        render(<WatchlistConfirm input={removeInput} onResolve={onResolve} />)

        fireEvent.click(screen.getByRole('button', { name: 'Yes, remove it' }))
        await waitFor(() =>
            expect(onResolve).toHaveBeenCalledWith({
                status: 'removed',
                movies: [{ movieId: 27205, title: 'Inception' }],
            }),
        )
        expect(spy.mock.calls[0]![1]?.method).toBe('DELETE')
    })

    // ── Edge cases ────────────────────────────────────────────────────────
    it('denying resolves "declined" and never calls the API (edge)', () => {
        const spy = mockFetch(() => jsonResponse({}))
        const onResolve = vi.fn()
        render(<WatchlistConfirm input={addInput} onResolve={onResolve} />)

        fireEvent.click(screen.getByRole('button', { name: 'No' }))
        expect(onResolve).toHaveBeenCalledWith({
            status: 'declined',
            movies: [{ movieId: 27205, title: 'Inception' }],
        })
        expect(spy).not.toHaveBeenCalled()
    })

    it('shows an error and does NOT resolve when a mutation fails (edge)', async () => {
        mockFetch(() => jsonResponse({ error: 'Unauthorized' }, 401))
        const onResolve = vi.fn()
        render(<WatchlistConfirm input={addInput} onResolve={onResolve} />)

        fireEvent.click(screen.getByRole('button', { name: 'Yes, add it' }))
        expect(await screen.findByText(/Could not update your watchlist/)).toBeInTheDocument()
        expect(onResolve).not.toHaveBeenCalled()
    })

    it('reports a partial failure across a batch and does NOT resolve (edge)', async () => {
        // First add fails (401); the other two succeed.
        let n = 0
        mockFetch(() =>
            n++ === 0
                ? jsonResponse({ error: 'nope' }, 401)
                : jsonResponse({ added: true, movieId: 9 }, 201),
        )
        const onResolve = vi.fn()
        render(<WatchlistConfirm input={batchAddInput} onResolve={onResolve} />)

        fireEvent.click(screen.getByRole('button', { name: 'Yes, add all 3' }))
        expect(await screen.findByText(/Updated 2 of 3/)).toBeInTheDocument()
        expect(onResolve).not.toHaveBeenCalled()
    })

    it('rejects a structurally invalid proposal without offering actions (edge)', () => {
        const onResolve = vi.fn()
        render(<WatchlistConfirm input={{ action: 'frobnicate' }} onResolve={onResolve} />)
        expect(screen.getByRole('alert')).toHaveTextContent('invalid watchlist change')
        expect(screen.queryByRole('button')).not.toBeInTheDocument()
    })
})
