import type { MovieResult } from '@themovie/schemas'
import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { MovieCard } from './MovieCard'

const movie: MovieResult = {
    tmdbId: 27205,
    title: 'Inception',
    overview: 'Dream heist.',
    releaseDate: '2010-07-16',
    genres: ['Action', 'Science Fiction'],
    posterPath: '/poster.jpg',
}

describe('<MovieCard />', () => {
    // ── Feature / happy path ──────────────────────────────────────────────
    it('renders the title, year, and genres', () => {
        render(<MovieCard movie={movie} />)
        expect(screen.getByRole('heading', { name: 'Inception' })).toBeInTheDocument()
        expect(screen.getByText('2010')).toBeInTheDocument()
        expect(screen.getByText('Science Fiction')).toBeInTheDocument()
    })

    it('renders the poster image with descriptive alt text and intrinsic dimensions', () => {
        render(<MovieCard movie={movie} />)
        const img = screen.getByRole('img', { name: 'Inception poster' })
        expect(img).toHaveAttribute('src', expect.stringContaining('/poster.jpg'))
        // Intrinsic width/height reserve the aspect ratio (no layout shift).
        expect(img).toHaveAttribute('width', '342')
        expect(img).toHaveAttribute('height', '513')
    })

    it('names the poster for a shared-element view transition into the detail page', () => {
        render(<MovieCard movie={movie} />)
        const img = screen.getByRole('img', { name: 'Inception poster' })
        // The detail-page poster carries the same name, so the browser morphs them.
        expect(img.getAttribute('style')).toContain('view-transition-name: movie-poster-27205')
    })

    // ── Edge cases ────────────────────────────────────────────────────────
    it('shows a placeholder (no broken image) when posterPath is null', () => {
        render(<MovieCard movie={{ ...movie, posterPath: null }} />)
        expect(screen.queryByRole('img')).not.toBeInTheDocument()
    })

    it('shows an em dash when the release date is missing', () => {
        render(<MovieCard movie={{ ...movie, releaseDate: null }} />)
        expect(screen.getByText('—')).toBeInTheDocument()
    })

    it('renders no genre chips when the list is empty', () => {
        render(<MovieCard movie={{ ...movie, genres: [] }} />)
        expect(screen.queryAllByRole('listitem')).toHaveLength(0)
    })

    // ── Rating + recommended signal ───────────────────────────────────────
    it('shows the rating chip and a Recommended flag for a highly-rated movie', () => {
        render(<MovieCard movie={{ ...movie, voteAverage: 8.4 }} />)
        expect(screen.getByLabelText('Rated 8.4 out of 10')).toBeInTheDocument()
        expect(screen.getByText('Recommended')).toBeInTheDocument()
    })

    it('shows the rating chip but no Recommended flag below the threshold (edge)', () => {
        render(<MovieCard movie={{ ...movie, voteAverage: 6.9 }} />)
        expect(screen.getByLabelText('Rated 6.9 out of 10')).toBeInTheDocument()
        expect(screen.queryByText('Recommended')).not.toBeInTheDocument()
    })

    it('hides the rating chip when the score is missing or zero (edge: unrated)', () => {
        render(<MovieCard movie={{ ...movie, voteAverage: 0 }} />)
        expect(screen.queryByLabelText(/Rated/)).not.toBeInTheDocument()
        render(<MovieCard movie={{ ...movie, voteAverage: null }} />)
        expect(screen.queryByLabelText(/Rated/)).not.toBeInTheDocument()
    })
})
