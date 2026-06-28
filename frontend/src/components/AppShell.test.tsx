import { screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { sessionQueryKey } from '../lib/auth'
import { makeTestQueryClient, renderWithProviders } from '../test/providers'
import { AppShell, buildCrumbs, movieIdFromPath } from './AppShell'

describe('breadcrumb helpers', () => {
    it('builds a single Discover crumb at the root', () => {
        expect(buildCrumbs('/')).toEqual([{ label: 'Discover' }])
    })

    it('builds a Discover › Page trail for a top-level route', () => {
        expect(buildCrumbs('/watchlist')).toEqual([
            { label: 'Discover', to: '/' },
            { label: 'Watchlist' },
        ])
    })

    it('uses the movie title on a detail route, falling back to "Movie"', () => {
        expect(buildCrumbs('/movie/27205', 'Inception')).toEqual([
            { label: 'Discover', to: '/' },
            { label: 'Inception' },
        ])
        expect(buildCrumbs('/movie/27205')[1]).toEqual({ label: 'Movie' })
    })

    it('extracts the movie id only from a /movie/:id path (edge)', () => {
        expect(movieIdFromPath('/movie/27205')).toBe(27205)
        expect(movieIdFromPath('/watchlist')).toBeNull()
        expect(movieIdFromPath('/movie/abc')).toBeNull()
    })
})

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

    it('exposes a focusable content region for the skip link (not a 2nd main)', async () => {
        const qc = makeTestQueryClient()
        qc.setQueryData(sessionQueryKey, null)
        const { container } = renderWithProviders(<AppShell />, qc)
        await screen.findByText('TheMovie')

        // The skip-link / focus target is a <div id="main-content"> — each route
        // owns its own <main>, so the shell must not render a second <main>.
        const region = container.querySelector('#main-content')
        expect(region).not.toBeNull()
        expect(region?.tagName).toBe('DIV')
        expect(region).toHaveAttribute('tabindex', '-1')
        expect(container.querySelector('main#main-content')).toBeNull()
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
