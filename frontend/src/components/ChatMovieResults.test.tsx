import type { MovieResult } from '@themovie/schemas'
import { screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { renderWithProviders } from '../test/providers'
import { ChatMovieResults } from './ChatMovieResults'

const movie = (over: Partial<MovieResult> = {}): MovieResult => ({
    tmdbId: 27205,
    title: 'Inception',
    overview: null,
    releaseDate: '2010-07-16',
    genres: [],
    posterPath: '/poster.jpg',
    ...over,
})

describe('<ChatMovieResults />', () => {
    it('renders each movie as a link to its detail page with a rating chip', async () => {
        renderWithProviders(<ChatMovieResults movies={[movie({ voteAverage: 8.4 })]} />)
        const link = await screen.findByRole('link', { name: 'Inception' })
        expect(link).toHaveAttribute('href', '/movie/27205')
        expect(screen.getByText('2010')).toBeInTheDocument()
        expect(screen.getByText('8.4')).toBeInTheDocument()
    })

    it('routes a TV result to its /tv/:id detail page (feature: TV parity)', async () => {
        renderWithProviders(
            <ChatMovieResults
                movies={[movie({ tmdbId: 1396, title: 'Breaking Bad', mediaType: 'tv' })]}
            />,
        )
        const link = await screen.findByRole('link', { name: 'Breaking Bad' })
        expect(link).toHaveAttribute('href', '/tv/1396')
    })

    it('omits the rating chip when the score is missing or zero (edge)', async () => {
        renderWithProviders(<ChatMovieResults movies={[movie({ voteAverage: 0 })]} />)
        await screen.findByRole('link', { name: 'Inception' })
        expect(screen.queryByText('0.0')).not.toBeInTheDocument()
    })

    it('renders nothing for an empty list (edge)', () => {
        const { container } = renderWithProviders(<ChatMovieResults movies={[]} />)
        expect(container.querySelector('ul')).toBeNull()
    })
})
