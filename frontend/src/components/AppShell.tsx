import { useQuery } from '@tanstack/react-query'
import { Link, Outlet, useRouterState } from '@tanstack/react-router'
import { Fragment } from 'react'
import {
    Breadcrumb,
    BreadcrumbItem,
    BreadcrumbLink,
    BreadcrumbList,
    BreadcrumbPage,
    BreadcrumbSeparator,
} from '@/components/ui/breadcrumb'
import { Separator } from '@/components/ui/separator'
import { SidebarInset, SidebarProvider, SidebarTrigger } from '@/components/ui/sidebar'
import { TooltipProvider } from '@/components/ui/tooltip'
import { movieDetailsQueryOptions } from '../lib/movies'
import { useFocusOnNavigate } from '../lib/navigation'
import { AppSidebar } from './AppSidebar'
import { CommandSearch } from './CommandSearch'
import { SessionActions } from './SessionActions'

interface Crumb {
    label: string
    /** A link target for all but the last (current) crumb. */
    to?: string
}

// The breadcrumb trail for a path: Discover is the root, then the current page
// (the movie's title on a detail route, otherwise the capitalized segment).
export function buildCrumbs(pathname: string, movieTitle?: string): Crumb[] {
    if (pathname === '/') return [{ label: 'Discover' }]
    const segment = pathname.split('/').filter(Boolean)[0] ?? ''
    const current =
        segment === 'movie'
            ? (movieTitle ?? 'Movie')
            : segment.charAt(0).toUpperCase() + segment.slice(1)
    return [{ label: 'Discover', to: '/' }, { label: current }]
}

/** The movie id for a `/movie/:id` path, else null. */
export function movieIdFromPath(pathname: string): number | null {
    const match = /^\/movie\/(\d+)/.exec(pathname)
    return match ? Number(match[1]) : null
}

/**
 * The application shell for the signed-in app surface (Discover / Chat /
 * Watchlist / movie detail): a collapsible `Sidebar` plus a sticky top bar with
 * the sidebar trigger, a breadcrumb for the current page, and session controls.
 * Adapted from the @efferd app-shell-2 block. Auth/landing pages render the
 * plain header instead (see `__root.tsx`).
 *
 * The routed content sits in a focusable `<div id="main-content">` so the skip
 * link and route-change focus management keep working — each route owns its own
 * `<main>` landmark (mirroring the auth-pages `MainRegion`), so the shell wrapper
 * must NOT be a second `<main>`.
 */
export function AppShell() {
    const pathname = useRouterState({ select: (s) => s.location.pathname })
    const mainRef = useFocusOnNavigate<HTMLDivElement>()

    // On a movie route, read the (already loader-cached) details so the breadcrumb
    // can show the title instead of a generic "Movie". Disabled off that route.
    const movieId = movieIdFromPath(pathname)
    const movieQuery = useQuery({
        ...movieDetailsQueryOptions(movieId ?? 0),
        enabled: movieId !== null,
    })
    const crumbs = buildCrumbs(pathname, movieQuery.data?.title)

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
                                {crumbs.map((crumb, index) => {
                                    const isLast = index === crumbs.length - 1
                                    return (
                                        <Fragment key={crumb.label}>
                                            <BreadcrumbItem>
                                                {isLast || !crumb.to ? (
                                                    <BreadcrumbPage className="max-w-[40ch] truncate">
                                                        {crumb.label}
                                                    </BreadcrumbPage>
                                                ) : (
                                                    <BreadcrumbLink asChild>
                                                        <Link to={crumb.to}>{crumb.label}</Link>
                                                    </BreadcrumbLink>
                                                )}
                                            </BreadcrumbItem>
                                            {!isLast && <BreadcrumbSeparator />}
                                        </Fragment>
                                    )
                                })}
                            </BreadcrumbList>
                        </Breadcrumb>
                        <div className="ml-auto flex items-center gap-2">
                            <CommandSearch />
                            <SessionActions />
                        </div>
                    </header>

                    <div
                        id="main-content"
                        ref={mainRef}
                        tabIndex={-1}
                        className="flex-1 outline-none"
                    >
                        <Outlet />
                    </div>
                </SidebarInset>
            </SidebarProvider>
        </TooltipProvider>
    )
}
