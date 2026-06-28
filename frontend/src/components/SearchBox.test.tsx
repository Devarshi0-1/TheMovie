import type { GroupedSuggestions, MovieResult } from '@themovie/schemas'
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
    mediaType: 'movie',
}

const tvSuggestion: MovieResult = {
    tmdbId: 1396,
    title: 'Breaking Bad',
    overview: null,
    releaseDate: '2008-01-20',
    genres: [],
    posterPath: '/bb.jpg',
    mediaType: 'tv',
}

// Seed the grouped multi-suggest cache for a query so the dropdown renders
// without a network call (fresh for 5 min, so the queryFn never runs).
function seeded(query: string, groups: GroupedSuggestions) {
    const qc = makeTestQueryClient()
    qc.setQueryData(['search', 'suggest', query], groups)
    return qc
}

// TV-scoped suggest seeds a flat MovieResult[] under the tv suggest key.
function seededTv(query: string, shows: MovieResult[]) {
    const qc = makeTestQueryClient()
    qc.setQueryData(['tv', 'suggest', query], shows)
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
            seeded('matrix', { movies: [suggestion], tv: [] }),
        )
        // Closed until the field is focused.
        const input = await screen.findByRole('searchbox')
        expect(screen.queryByText('The Matrix')).not.toBeInTheDocument()

        fireEvent.focus(input)
        const link = screen.getByRole('link', { name: /The Matrix/ })
        expect(link).toHaveAttribute('href', '/movie/603')
        expect(screen.getByText('1999')).toBeInTheDocument()
    })

    it('groups Movies and TV Shows, routing a TV pick to /tv/:id (feature)', async () => {
        renderWithProviders(
            <SearchBox value="break" onChange={() => {}} onSubmit={() => {}} />,
            seeded('break', { movies: [suggestion], tv: [tvSuggestion] }),
        )
        fireEvent.focus(await screen.findByRole('searchbox'))
        // Both group headings render.
        expect(screen.getByRole('heading', { name: 'Movies' })).toBeInTheDocument()
        expect(screen.getByRole('heading', { name: 'TV Shows' })).toBeInTheDocument()
        // The TV result routes to the TV detail page.
        expect(screen.getByRole('link', { name: /Breaking Bad/ })).toHaveAttribute(
            'href',
            '/tv/1396',
        )
    })

    it('scope="tv" suggests TV shows only, from the tv suggest source (feature)', async () => {
        renderWithProviders(
            <SearchBox value="break" onChange={() => {}} onSubmit={() => {}} scope="tv" />,
            seededTv('break', [tvSuggestion]),
        )
        fireEvent.focus(await screen.findByRole('searchbox'))
        expect(screen.getByRole('link', { name: /Breaking Bad/ })).toHaveAttribute(
            'href',
            '/tv/1396',
        )
        // No Movies group in TV scope.
        expect(screen.queryByRole('heading', { name: 'Movies' })).not.toBeInTheDocument()
    })

    it('does not suggest for a one-character query (edge: below the floor)', async () => {
        renderWithProviders(
            <SearchBox value="m" onChange={() => {}} onSubmit={() => {}} />,
            seeded('m', { movies: [suggestion], tv: [] }),
        )
        fireEvent.focus(await screen.findByRole('searchbox'))
        expect(screen.queryByText('The Matrix')).not.toBeInTheDocument()
    })
})
