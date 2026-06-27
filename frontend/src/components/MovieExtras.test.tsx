import type { MovieExtras as MovieExtrasData } from '@themovie/schemas'
import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { renderWithProviders } from '../test/providers'
import { MoreLikeThis, MovieExtras, MovieExtrasSkeleton } from './MovieExtras'

const EXTRAS: MovieExtrasData = {
    cast: [
        { id: 1, name: 'Leonardo DiCaprio', character: 'Cobb', profilePath: '/leo.jpg' },
        { id: 2, name: 'Tom Hardy', character: 'Eames', profilePath: null },
    ],
    director: 'Christopher Nolan',
    trailer: { key: 'YoHD9XEInc0', name: 'Official Trailer', site: 'YouTube', type: 'Trailer' },
    watchProviders: {
        region: 'US',
        link: 'https://www.themoviedb.org/movie/27205/watch',
        flatrate: [{ id: 8, name: 'Netflix', logoPath: '/nf.jpg' }],
        rent: [{ id: 2, name: 'Apple TV', logoPath: null }],
        buy: [],
    },
    recommendations: [
        {
            tmdbId: 155,
            title: 'The Dark Knight',
            overview: null,
            releaseDate: '2008-07-18',
            genres: ['Action'],
            posterPath: null,
        },
    ],
}

const EMPTY: MovieExtrasData = {
    cast: [],
    director: null,
    trailer: null,
    watchProviders: null,
    recommendations: [],
}

describe('<MovieExtras />', () => {
    // ── Feature / happy path ──────────────────────────────────────────────
    it('renders trailer, cast + director, and where-to-watch', () => {
        render(<MovieExtras extras={EXTRAS} />)

        expect(screen.getByTitle('Official Trailer')).toBeInTheDocument()
        expect(screen.getByText('Leonardo DiCaprio')).toBeInTheDocument()
        expect(screen.getByText('Cobb')).toBeInTheDocument()
        expect(screen.getByText(/Christopher Nolan/)).toBeInTheDocument()
        // Where-to-watch groups + region badge.
        expect(screen.getByText('Where to watch')).toBeInTheDocument()
        expect(screen.getByText('US')).toBeInTheDocument()
        expect(screen.getByText('Stream')).toBeInTheDocument()
        expect(screen.getByText('Rent')).toBeInTheDocument()
        // A provider logo carries its name as alt text.
        expect(screen.getByAltText('Netflix')).toBeInTheDocument()
        // No buy offers → no Buy row.
        expect(screen.queryByText('Buy')).not.toBeInTheDocument()
    })

    it('falls back to a name badge for a provider with no logo', () => {
        render(<MovieExtras extras={EXTRAS} />)
        // Apple TV has logoPath: null → rendered as a Badge, not an <img>.
        expect(screen.getByText('Apple TV')).toBeInTheDocument()
        expect(screen.queryByAltText('Apple TV')).not.toBeInTheDocument()
    })

    // ── Edge cases ────────────────────────────────────────────────────────
    it('renders nothing when every section is empty', () => {
        const { container } = render(<MovieExtras extras={EMPTY} />)
        expect(container).toBeEmptyDOMElement()
    })

    it('omits where-to-watch but keeps cast when providers are null', () => {
        render(<MovieExtras extras={{ ...EXTRAS, watchProviders: null }} />)
        expect(screen.getByText('Leonardo DiCaprio')).toBeInTheDocument()
        expect(screen.queryByText('Where to watch')).not.toBeInTheDocument()
    })

    it('shows a director line even when the cast list is empty', () => {
        render(<MovieExtras extras={{ ...EMPTY, director: 'Greta Gerwig' }} />)
        expect(screen.getByText(/Greta Gerwig/)).toBeInTheDocument()
    })

    it('skeleton is announced as busy and mirrors the layout', () => {
        const { container } = render(<MovieExtrasSkeleton />)
        expect(screen.getByLabelText('Loading cast and trailer')).toHaveAttribute(
            'aria-busy',
            'true',
        )
        expect(container.querySelectorAll('[data-slot="skeleton"]').length).toBeGreaterThan(0)
    })
})

describe('<MoreLikeThis />', () => {
    it('renders a navigable card per recommendation', async () => {
        renderWithProviders(<MoreLikeThis movies={EXTRAS.recommendations} />)
        expect(await screen.findByText('The Dark Knight')).toBeInTheDocument()
    })

    it('renders nothing with no recommendations (edge)', () => {
        const { container } = render(<MoreLikeThis movies={[]} />)
        expect(container).toBeEmptyDOMElement()
    })
})
