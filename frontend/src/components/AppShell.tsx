import { Outlet, useRouterState } from '@tanstack/react-router'
import {
    Breadcrumb,
    BreadcrumbItem,
    BreadcrumbList,
    BreadcrumbPage,
} from '@/components/ui/breadcrumb'
import { Separator } from '@/components/ui/separator'
import { SidebarInset, SidebarProvider, SidebarTrigger } from '@/components/ui/sidebar'
import { TooltipProvider } from '@/components/ui/tooltip'
import { useFocusOnNavigate } from '../lib/navigation'
import { AppSidebar } from './AppSidebar'
import { SessionActions } from './SessionActions'

// The current page's breadcrumb label, derived from the path's first segment.
function pageTitle(pathname: string): string {
    if (pathname === '/') return 'Discover'
    const segment = pathname.split('/').filter(Boolean)[0] ?? ''
    if (segment === 'movie') return 'Movie'
    return segment.charAt(0).toUpperCase() + segment.slice(1)
}

/**
 * The application shell for the signed-in app surface (Discover / Chat /
 * Watchlist / movie detail): a collapsible `Sidebar` plus a sticky top bar with
 * the sidebar trigger, a breadcrumb for the current page, and session controls.
 * Adapted from the @efferd app-shell-2 block. Auth/landing pages render the
 * plain header instead (see `__root.tsx`).
 *
 * The routed content sits in a focusable `<main id="main-content">` so the skip
 * link and route-change focus management keep working.
 */
export function AppShell() {
    const pathname = useRouterState({ select: (s) => s.location.pathname })
    const mainRef = useFocusOnNavigate<HTMLElement>()

    return (
        <TooltipProvider>
            <SidebarProvider>
                <AppSidebar />
                <SidebarInset>
                    <header className="sticky top-0 z-20 flex h-14 shrink-0 items-center gap-2 border-b border-border bg-background/80 px-4 backdrop-blur md:px-6">
                        <SidebarTrigger />
                        <Separator
                            orientation="vertical"
                            className="mr-1 h-4 data-[orientation=vertical]:self-center"
                        />
                        <Breadcrumb>
                            <BreadcrumbList>
                                <BreadcrumbItem>
                                    <BreadcrumbPage>{pageTitle(pathname)}</BreadcrumbPage>
                                </BreadcrumbItem>
                            </BreadcrumbList>
                        </Breadcrumb>
                        <div className="ml-auto">
                            <SessionActions />
                        </div>
                    </header>

                    <main
                        id="main-content"
                        ref={mainRef}
                        tabIndex={-1}
                        className="flex-1 outline-none"
                    >
                        <Outlet />
                    </main>
                </SidebarInset>
            </SidebarProvider>
        </TooltipProvider>
    )
}
