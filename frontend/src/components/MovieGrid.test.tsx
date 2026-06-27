import type { MovieResult } from '@themovie/schemas'
import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { renderWithProviders } from '../test/providers'
import { MovieGrid } from './MovieGrid'

const movie = (id: number, title: string): MovieResult => ({
    tmdbId: id,
    title,
    overview: null,
    releaseDate: '2010-01-01',
    genres: [],
    posterPath: null,
})

describe('<MovieGrid />', () => {
    // ── Feature / happy path ──────────────────────────────────────────────
    it('renders a clickable card per movie', async () => {
        renderWithProviders(<MovieGrid movies={[movie(1, 'Inception'), movie(2, 'Tenet')]} />)
        expect(await screen.findByText('Inception')).toBeInTheDocument()
        expect(screen.getByText('Tenet')).toBeInTheDocument()
    })

    // ── Edge cases (states render without a router) ───────────────────────
    it('shows skeletons while loading', () => {
        render(<MovieGrid isLoading />)
        expect(screen.getByTestId('movie-grid-loading')).toHaveAttribute('aria-busy', 'true')
    })

    it('shows an error message on failure', () => {
        render(<MovieGrid isError errorLabel="Could not load trending." />)
        expect(screen.getByRole('alert')).toHaveTextContent('Could not load trending.')
    })

    it('shows a custom empty state when there are no movies', () => {
        render(<MovieGrid movies={[]} emptyLabel="No matches for that search." />)
        expect(screen.getByText('No matches for that search.')).toBeInTheDocument()
    })
})
