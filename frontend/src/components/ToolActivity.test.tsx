import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { ToolActivity } from './ToolActivity'

describe('<ToolActivity />', () => {
    it('shows a running label while the tool is in progress', () => {
        render(<ToolActivity name="search_movies_sql" state="input-available" />)
        expect(screen.getByText(/Searching the catalog…/)).toBeInTheDocument()
    })

    it('shows a done label once output is available', () => {
        render(<ToolActivity name="semantic_search_movies" state="output-available" />)
        expect(screen.getByText('Searched by theme')).toBeInTheDocument()
    })

    it('shows an error label on output-error', () => {
        render(<ToolActivity name="fetch_from_tmdb" state="output-error" />)
        expect(screen.getByText(/fetch from tmdb failed/)).toBeInTheDocument()
    })
})
