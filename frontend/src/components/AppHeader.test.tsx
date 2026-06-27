import { screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { sessionQueryKey } from '../lib/auth'
import { makeTestQueryClient, renderWithProviders } from '../test/providers'
import { AppHeader } from './AppHeader'

describe('<AppHeader />', () => {
    // ── Feature / happy path ──────────────────────────────────────────────
    it('shows the user and a Sign out button when signed in', async () => {
        const qc = makeTestQueryClient()
        qc.setQueryData(sessionQueryKey, { id: 'u1', email: 'ana@example.com', name: 'Ana' })
        renderWithProviders(<AppHeader />, qc)

        expect(await screen.findByText('Ana')).toBeInTheDocument()
        expect(screen.getByRole('button', { name: 'Sign out' })).toBeInTheDocument()
        expect(screen.queryByText('Sign in')).not.toBeInTheDocument()
    })

    // ── Edge cases ────────────────────────────────────────────────────────
    it('shows Sign in / Sign up when signed out', async () => {
        const qc = makeTestQueryClient()
        qc.setQueryData(sessionQueryKey, null)
        renderWithProviders(<AppHeader />, qc)

        expect(await screen.findByText('Sign in')).toBeInTheDocument()
        expect(screen.getByText('Sign up')).toBeInTheDocument()
        expect(screen.queryByRole('button', { name: 'Sign out' })).not.toBeInTheDocument()
    })

    it('always exposes the Discover and Watchlist nav links', async () => {
        const qc = makeTestQueryClient()
        qc.setQueryData(sessionQueryKey, null)
        renderWithProviders(<AppHeader />, qc)

        expect(await screen.findByText('Discover')).toBeInTheDocument()
        expect(screen.getByText('Watchlist')).toBeInTheDocument()
    })
})
