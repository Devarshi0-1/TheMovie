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

    it('renders the poster image with descriptive alt text', () => {
        render(<MovieCard movie={movie} />)
        const img = screen.getByRole('img', { name: 'Inception poster' })
        expect(img).toHaveAttribute('src', expect.stringContaining('/poster.jpg'))
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
        const { container } = render(<MovieCard movie={{ ...movie, genres: [] }} />)
        expect(container.querySelectorAll('.movie-card__genres li')).toHaveLength(0)
    })
})
