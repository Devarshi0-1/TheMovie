import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { SearchBar } from './SearchBar'

describe('<SearchBar />', () => {
    // ── Feature / happy path ──────────────────────────────────────────────
    it('reports input changes through onChange', () => {
        const onChange = vi.fn()
        render(<SearchBar value="" onChange={onChange} onSubmit={() => {}} />)
        fireEvent.change(screen.getByRole('searchbox'), { target: { value: 'matrix' } })
        expect(onChange).toHaveBeenCalledWith('matrix')
    })

    it('calls onSubmit when the form is submitted', () => {
        const onSubmit = vi.fn()
        render(<SearchBar value="dune" onChange={() => {}} onSubmit={onSubmit} />)
        fireEvent.click(screen.getByRole('button', { name: 'Search' }))
        expect(onSubmit).toHaveBeenCalledOnce()
    })

    // ── Edge cases ────────────────────────────────────────────────────────
    it('shows a clear button only when there is a value, and clears via onChange', () => {
        const onChange = vi.fn()
        const { rerender } = render(<SearchBar value="" onChange={onChange} onSubmit={() => {}} />)
        expect(screen.queryByRole('button', { name: 'Clear search' })).not.toBeInTheDocument()

        rerender(<SearchBar value="dune" onChange={onChange} onSubmit={() => {}} />)
        fireEvent.click(screen.getByRole('button', { name: 'Clear search' }))
        expect(onChange).toHaveBeenCalledWith('')
    })

    it('disables the submit button and shows progress while busy', () => {
        render(<SearchBar value="dune" onChange={() => {}} onSubmit={() => {}} busy />)
        expect(screen.getByRole('button', { name: 'Searching…' })).toBeDisabled()
    })
})
