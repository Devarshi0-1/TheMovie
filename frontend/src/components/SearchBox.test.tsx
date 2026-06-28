import type { MovieResult } from '@themovie/schemas'
import { fireEvent, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { makeTestQueryClient, renderWithProviders } from '../test/providers'
import { SearchBox } from './SearchBox'

const suggestion: MovieResult = {
    tmdbId: 603,
    title: 'The Matrix',
    overview: null,
    releaseDate: '1999-03-31',
    genres: [],
    posterPath: '/matrix.jpg',
}

// Seed the suggest cache for a query so the dropdown renders without a network
// call (the query is fresh for 5 min, so the queryFn never runs).
function seeded(query: string, movies: MovieResult[]) {
    const qc = makeTestQueryClient()
    qc.setQueryData(['movies', 'suggest', query], movies)
    return qc
}

describe('<SearchBox />', () => {
    // ── Feature / happy path (carried from SearchBar) ─────────────────────
    it('reports input changes through onChange', async () => {
        const onChange = vi.fn()
        renderWithProviders(<SearchBox value="" onChange={onChange} onSubmit={() => {}} />)
        fireEvent.change(await screen.findByRole('searchbox'), { target: { value: 'matrix' } })
        expect(onChange).toHaveBeenCalledWith('matrix')
    })

    it('calls onSubmit when the form is submitted', async () => {
        const onSubmit = vi.fn()
        renderWithProviders(<SearchBox value="dune" onChange={() => {}} onSubmit={onSubmit} />)
        fireEvent.click(await screen.findByRole('button', { name: 'Search' }))
        expect(onSubmit).toHaveBeenCalledOnce()
    })

    it('hides the clear button when the field is empty', async () => {
        renderWithProviders(<SearchBox value="" onChange={() => {}} onSubmit={() => {}} />)
        await screen.findByRole('searchbox')
        expect(screen.queryByRole('button', { name: 'Clear search' })).not.toBeInTheDocument()
    })

    it('shows the clear button when there is a value, and clears via onChange', async () => {
        const onChange = vi.fn()
        renderWithProviders(<SearchBox value="dune" onChange={onChange} onSubmit={() => {}} />)
        fireEvent.click(await screen.findByRole('button', { name: 'Clear search' }))
        expect(onChange).toHaveBeenCalledWith('')
    })

    it('disables the submit button and shows progress while busy', async () => {
        renderWithProviders(<SearchBox value="dune" onChange={() => {}} onSubmit={() => {}} busy />)
        expect(await screen.findByRole('button', { name: 'Searching…' })).toBeDisabled()
    })

    // ── Typeahead suggestions ─────────────────────────────────────────────
    it('shows matching suggestions once the field is focused, linking to detail', async () => {
        renderWithProviders(
            <SearchBox value="matrix" onChange={() => {}} onSubmit={() => {}} />,
            seeded('matrix', [suggestion]),
        )
        // Closed until the field is focused.
        const input = await screen.findByRole('searchbox')
        expect(screen.queryByText('The Matrix')).not.toBeInTheDocument()

        fireEvent.focus(input)
        const link = screen.getByRole('link', { name: /The Matrix/ })
        expect(link).toHaveAttribute('href', '/movie/603')
        expect(screen.getByText('1999')).toBeInTheDocument()
    })

    it('does not suggest for a one-character query (edge: below the floor)', async () => {
        renderWithProviders(
            <SearchBox value="m" onChange={() => {}} onSubmit={() => {}} />,
            seeded('m', [suggestion]),
        )
        fireEvent.focus(await screen.findByRole('searchbox'))
        expect(screen.queryByText('The Matrix')).not.toBeInTheDocument()
    })
})
