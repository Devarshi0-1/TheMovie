import type { MovieResult } from '@themovie/schemas'
import { screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { renderWithProviders } from '../test/providers'
import { MovieCardLink } from './MovieCardLink'

const base: MovieResult = {
    tmdbId: 27205,
    title: 'Inception',
    overview: null,
    releaseDate: '2010-07-16',
    genres: [],
    posterPath: null,
}

describe('<MovieCardLink />', () => {
    it('links a movie card to the movie detail route', async () => {
        renderWithProviders(<MovieCardLink movie={{ ...base, mediaType: 'movie' }} />)
        const link = await screen.findByRole('link', { name: 'Inception' })
        expect(link).toHaveAttribute('href', '/movie/27205')
    })

    it('links a TV card to the TV detail route', async () => {
        renderWithProviders(
            <MovieCardLink
                movie={{ ...base, tmdbId: 1396, title: 'Breaking Bad', mediaType: 'tv' }}
            />,
        )
        const link = await screen.findByRole('link', { name: 'Breaking Bad' })
        expect(link).toHaveAttribute('href', '/tv/1396')
    })

    it('treats a card with no mediaType as a movie (edge: agent/DB results)', async () => {
        renderWithProviders(<MovieCardLink movie={base} />)
        const link = await screen.findByRole('link', { name: 'Inception' })
        expect(link).toHaveAttribute('href', '/movie/27205')
    })
})
