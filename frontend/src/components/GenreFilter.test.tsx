import { screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { makeTestQueryClient, renderWithProviders } from '../test/providers'
import { GenreFilter } from './GenreFilter'

function seeded() {
    const qc = makeTestQueryClient()
    qc.setQueryData(
        ['movies', 'genres'],
        [
            { id: 28, name: 'Action' },
            { id: 878, name: 'Science Fiction' },
        ],
    )
    return qc
}

describe('<GenreFilter />', () => {
    it('renders an "All" chip plus a chip per genre, marking the active one', async () => {
        renderWithProviders(<GenreFilter activeId={878} onSelect={() => {}} />, seeded())

        const sciFi = await screen.findByRole('button', { name: 'Science Fiction' })
        expect(sciFi).toHaveAttribute('aria-pressed', 'true')
        expect(screen.getByRole('button', { name: 'Action' })).toHaveAttribute(
            'aria-pressed',
            'false',
        )
        expect(screen.getByRole('button', { name: 'All' })).toHaveAttribute('aria-pressed', 'false')
    })

    it('marks "All" active and calls onSelect(undefined) when cleared (edge)', async () => {
        const onSelect = vi.fn()
        renderWithProviders(<GenreFilter onSelect={onSelect} />, seeded())

        const all = await screen.findByRole('button', { name: 'All' })
        expect(all).toHaveAttribute('aria-pressed', 'true')
        all.click()
        expect(onSelect).toHaveBeenCalledWith(undefined)
    })

    it('selects a genre by id on click (feature)', async () => {
        const onSelect = vi.fn()
        renderWithProviders(<GenreFilter onSelect={onSelect} />, seeded())
        ;(await screen.findByRole('button', { name: 'Action' })).click()
        expect(onSelect).toHaveBeenCalledWith(28)
    })
})
