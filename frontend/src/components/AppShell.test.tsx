import { screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { sessionQueryKey } from '../lib/auth'
import { makeTestQueryClient, renderWithProviders } from '../test/providers'
import { AppShell } from './AppShell'

describe('<AppShell />', () => {
    // ── Feature / happy path ──────────────────────────────────────────────
    it('renders the sidebar nav, a breadcrumb, and the sidebar trigger', async () => {
        const qc = makeTestQueryClient()
        qc.setQueryData(sessionQueryKey, null)
        renderWithProviders(<AppShell />, qc)

        // Sidebar nav present.
        expect(await screen.findByText('TheMovie')).toBeInTheDocument()
        expect(screen.getAllByRole('link', { name: /Discover/ }).length).toBeGreaterThan(0)
        // Breadcrumb reflects the current page ("/" → Discover).
        expect(
            screen.getByText('Discover', { selector: '[data-slot="breadcrumb-page"]' }),
        ).toBeInTheDocument()
        // The collapse trigger is reachable.
        expect(screen.getByRole('button', { name: 'Toggle Sidebar' })).toBeInTheDocument()
    })

    it('exposes a focusable main landmark for the skip link', async () => {
        const qc = makeTestQueryClient()
        qc.setQueryData(sessionQueryKey, null)
        const { container } = renderWithProviders(<AppShell />, qc)
        await screen.findByText('TheMovie')

        const main = container.querySelector('main#main-content')
        expect(main).not.toBeNull()
        expect(main).toHaveAttribute('tabindex', '-1')
    })

    // ── Edge cases ────────────────────────────────────────────────────────
    it('shows Sign in / Sign up in the top bar when signed out', async () => {
        const qc = makeTestQueryClient()
        qc.setQueryData(sessionQueryKey, null)
        renderWithProviders(<AppShell />, qc)
        expect(await screen.findByText('Sign in')).toBeInTheDocument()
        expect(screen.getByText('Sign up')).toBeInTheDocument()
    })

    it('shows the signed-in user and Sign out when authenticated', async () => {
        const qc = makeTestQueryClient()
        qc.setQueryData(sessionQueryKey, { id: 'u1', email: 'ana@example.com', name: 'Ana' })
        renderWithProviders(<AppShell />, qc)
        expect(await screen.findByText('Ana')).toBeInTheDocument()
        expect(screen.getByRole('button', { name: 'Sign out' })).toBeInTheDocument()
    })
})
