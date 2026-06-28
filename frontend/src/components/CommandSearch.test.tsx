import type { MovieResult } from '@themovie/schemas'
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
}

function seeded(query: string, movies: MovieResult[]) {
    const qc = makeTestQueryClient()
    qc.setQueryData(['movies', 'suggest', query], movies)
    return qc
}

describe('<CommandSearch />', () => {
    // ── Feature / happy path ──────────────────────────────────────────────
    it('opens the palette from the header button and prompts for input', async () => {
        renderWithProviders(<CommandSearch />)
        fireEvent.click(await screen.findByRole('button', { name: 'Search movies' }))

        expect(screen.getByPlaceholderText('Search movies…')).toBeInTheDocument()
        expect(screen.getByText(/Type at least 2 characters/)).toBeInTheDocument()
    })

    it('lists matching movies and a "search all" row once the query is long enough', async () => {
        renderWithProviders(<CommandSearch />, seeded('matrix', [suggestion]))
        fireEvent.click(await screen.findByRole('button', { name: 'Search movies' }))
        fireEvent.change(screen.getByPlaceholderText('Search movies…'), {
            target: { value: 'matrix' },
        })

        expect(await screen.findByText('The Matrix')).toBeInTheDocument()
        expect(screen.getByText(/Search all results for/)).toBeInTheDocument()
    })

    // ── Edge case ─────────────────────────────────────────────────────────
    it('shows an empty state when there are no matches (edge)', async () => {
        renderWithProviders(<CommandSearch />, seeded('zzzz', []))
        fireEvent.click(await screen.findByRole('button', { name: 'Search movies' }))
        fireEvent.change(screen.getByPlaceholderText('Search movies…'), {
            target: { value: 'zzzz' },
        })

        expect(await screen.findByText(/No movies match/)).toBeInTheDocument()
    })
})
