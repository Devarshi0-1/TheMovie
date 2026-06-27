import { screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { SidebarProvider } from '@/components/ui/sidebar'
import { TooltipProvider } from '@/components/ui/tooltip'
import { renderWithProviders } from '../test/providers'
import { AppSidebar } from './AppSidebar'

// AppSidebar reads the router for active state; the harness mounts it at '/'.
// TooltipProvider is required because the menu buttons carry collapsed tooltips.
function renderSidebar() {
    return renderWithProviders(
        <TooltipProvider>
            <SidebarProvider>
                <AppSidebar />
            </SidebarProvider>
        </TooltipProvider>,
    )
}

describe('<AppSidebar />', () => {
    // ── Feature / happy path ──────────────────────────────────────────────
    it('renders the brand and the three primary nav links', async () => {
        renderSidebar()
        expect(await screen.findByText('TheMovie')).toBeInTheDocument()
        expect(screen.getByRole('link', { name: /Discover/ })).toBeInTheDocument()
        expect(screen.getByRole('link', { name: /Chat/ })).toBeInTheDocument()
        expect(screen.getByRole('link', { name: /Watchlist/ })).toBeInTheDocument()
    })

    it('marks Discover active at "/" and the others inactive', async () => {
        renderSidebar()
        const discover = await screen.findByRole('link', { name: /Discover/ })
        expect(discover).toHaveAttribute('data-active', 'true')
        expect(screen.getByRole('link', { name: /Chat/ })).toHaveAttribute('data-active', 'false')
        expect(screen.getByRole('link', { name: /Watchlist/ })).toHaveAttribute(
            'data-active',
            'false',
        )
    })

    it('points the nav links at the right routes (edge)', async () => {
        renderSidebar()
        expect(await screen.findByRole('link', { name: /Chat/ })).toHaveAttribute('href', '/chat')
        expect(screen.getByRole('link', { name: /Watchlist/ })).toHaveAttribute(
            'href',
            '/watchlist',
        )
    })
})
