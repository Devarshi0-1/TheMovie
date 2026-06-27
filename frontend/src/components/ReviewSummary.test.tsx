import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { ReviewSummary, ReviewSummarySkeleton } from './ReviewSummary'

describe('<ReviewSummary />', () => {
    // ── Feature / happy path ──────────────────────────────────────────────
    it('renders the vibe plus loved/critiqued lists', () => {
        render(
            <ReviewSummary
                summary={{ vibe: 'A twisty crowd-pleaser.', pros: ['Acting'], cons: ['Pacing'] }}
            />,
        )
        expect(screen.getByText('A twisty crowd-pleaser.')).toBeInTheDocument()
        expect(screen.getByText('Loved')).toBeInTheDocument()
        expect(screen.getByText('Acting')).toBeInTheDocument()
        expect(screen.getByText('Critiqued')).toBeInTheDocument()
        expect(screen.getByText('Pacing')).toBeInTheDocument()
    })

    it('advertises the summary as spoiler-free', () => {
        render(<ReviewSummary summary={{ vibe: 'x', pros: [], cons: [] }} />)
        expect(screen.getByText(/spoiler-free/i)).toBeInTheDocument()
    })

    // ── Edge cases ────────────────────────────────────────────────────────
    it('collapses both columns for the no-reviews case (vibe only)', () => {
        render(<ReviewSummary summary={{ vibe: 'No audience reviews yet.', pros: [], cons: [] }} />)
        expect(screen.getByText('No audience reviews yet.')).toBeInTheDocument()
        expect(screen.queryByText('Loved')).not.toBeInTheDocument()
        expect(screen.queryByText('Critiqued')).not.toBeInTheDocument()
    })

    it('renders only the loved column when there are no cons', () => {
        render(<ReviewSummary summary={{ vibe: 'x', pros: ['Great score'], cons: [] }} />)
        expect(screen.getByText('Loved')).toBeInTheDocument()
        expect(screen.queryByText('Critiqued')).not.toBeInTheDocument()
    })

    it('renders a busy skeleton placeholder while the summary loads', () => {
        const { container } = render(<ReviewSummarySkeleton />)
        expect(screen.getByLabelText('Summarizing audience reviews')).toHaveAttribute(
            'aria-busy',
            'true',
        )
        expect(container.querySelectorAll('[data-slot="skeleton"]').length).toBeGreaterThan(0)
    })
})
