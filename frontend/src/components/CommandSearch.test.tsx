import type { GroupedSuggestions, MovieResult } from '@themovie/schemas'
import { fireEvent, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { makeTestQueryClient, renderWithProviders } from '../test/providers'
import { CommandSearch } from './CommandSearch'

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

function seeded(query: string, groups: GroupedSuggestions) {
    const qc = makeTestQueryClient()
    qc.setQueryData(['search', 'suggest', query], groups)
    return qc
}

describe('<CommandSearch />', () => {
    // ── Feature / happy path ──────────────────────────────────────────────
    it('opens the palette from the header button and prompts for input', async () => {
        renderWithProviders(<CommandSearch />)
        fireEvent.click(await screen.findByRole('button', { name: 'Search movies and TV shows' }))

        expect(screen.getByPlaceholderText('Search movies & TV…')).toBeInTheDocument()
        expect(screen.getByText(/Type at least 2 characters/)).toBeInTheDocument()
    })

    it('lists matching titles in Movies + TV groups, plus a "search all" row', async () => {
        renderWithProviders(
            <CommandSearch />,
            seeded('break', { movies: [suggestion], tv: [tvSuggestion] }),
        )
        fireEvent.click(await screen.findByRole('button', { name: 'Search movies and TV shows' }))
        fireEvent.change(screen.getByPlaceholderText('Search movies & TV…'), {
            target: { value: 'break' },
        })

        expect(await screen.findByText('The Matrix')).toBeInTheDocument()
        expect(screen.getByText('Breaking Bad')).toBeInTheDocument()
        expect(screen.getByText('Movies')).toBeInTheDocument()
        expect(screen.getByText('TV Shows')).toBeInTheDocument()
        expect(screen.getByText(/Search all results for/)).toBeInTheDocument()
    })

    // ── Edge case ─────────────────────────────────────────────────────────
    it('shows an empty state when neither group has matches (edge)', async () => {
        renderWithProviders(<CommandSearch />, seeded('zzzz', { movies: [], tv: [] }))
        fireEvent.click(await screen.findByRole('button', { name: 'Search movies and TV shows' }))
        fireEvent.change(screen.getByPlaceholderText('Search movies & TV…'), {
            target: { value: 'zzzz' },
        })

        expect(await screen.findByText(/Nothing matches/)).toBeInTheDocument()
    })
})
