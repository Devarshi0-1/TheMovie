import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { PosterGridSkeleton } from './PosterGridSkeleton'

describe('<PosterGridSkeleton />', () => {
    // ── Feature / happy path ──────────────────────────────────────────────
    it('renders a busy region with one placeholder per count', () => {
        const { container } = render(<PosterGridSkeleton count={6} testId="grid-loading" />)

        const region = screen.getByTestId('grid-loading')
        expect(region).toHaveAttribute('aria-busy', 'true')
        // One poster skeleton per card when there's no action row.
        expect(container.querySelectorAll('[data-slot="skeleton"]')).toHaveLength(6)
    })

    it('uses the provided label as the accessible name', () => {
        render(<PosterGridSkeleton count={1} label="Loading your watchlist" testId="wl" />)
        expect(screen.getByLabelText('Loading your watchlist')).toBeInTheDocument()
    })

    // ── Edge case: action row reserves space for the per-card button ───────
    it('adds a second skeleton per card when withAction is set', () => {
        const { container } = render(<PosterGridSkeleton count={3} withAction testId="wl" />)
        // poster + action row → two skeletons per card.
        expect(container.querySelectorAll('[data-slot="skeleton"]')).toHaveLength(6)
    })
})
