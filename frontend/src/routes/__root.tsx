/// <reference types="vite/client" />
import type { QueryClient } from '@tanstack/react-query'
import {
    createRootRouteWithContext,
    HeadContent,
    Outlet,
    Scripts,
    useRouterState,
} from '@tanstack/react-router'
import { type ReactNode } from 'react'
import { AppHeader } from '../components/AppHeader'
import { AppShell } from '../components/AppShell'
import { Toaster } from '../components/ui/sonner'
import { useFocusOnNavigate } from '../lib/navigation'
import appCss from '../styles/app.css?url'

// The root route owns the entire HTML document. `HeadContent` flushes the
// per-route <head> tags; `Scripts` injects the hydration bundle — omitting it
// ships a dead, un-hydrated page.
export const Route = createRootRouteWithContext<{ queryClient: QueryClient }>()({
    head: () => ({
        meta: [
            { charSet: 'utf-8' },
            { name: 'viewport', content: 'width=device-width, initial-scale=1' },
            { title: 'TheMovie — AI movie discovery' },
        ],
        links: [{ rel: 'stylesheet', href: appCss }],
    }),
    component: RootComponent,
})

// Auth/landing pages keep the plain top header; everything else (Discover, Chat,
// Watchlist, movie detail) renders inside the sidebar app shell.
const AUTH_ROUTES = new Set(['/signin', '/signup'])

function RootComponent() {
    const pathname = useRouterState({ select: (s) => s.location.pathname })
    const isAuthRoute = AUTH_ROUTES.has(pathname)

    return (
        <RootDocument>
            <a
                href="#main-content"
                className="sr-only rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground focus:not-sr-only focus:absolute focus:left-4 focus:top-4 focus:z-50"
            >
                Skip to content
            </a>
            {isAuthRoute ? (
                <>
                    <AppHeader />
                    <MainRegion />
                </>
            ) : (
                <AppShell />
            )}
            <Toaster richColors closeButton />
        </RootDocument>
    )
}

/**
 * Wraps the routed content in a focusable landmark target for the auth/landing
 * pages (the app shell provides its own). On client-side navigation focus moves
 * here so keyboard / screen-reader users land on the new page's content instead
 * of staying on the link they activated (A11Y Project: manage focus on route
 * change). The "Skip to content" link targets the same id.
 */
function MainRegion() {
    const ref = useFocusOnNavigate<HTMLDivElement>()

    return (
        <div id="main-content" ref={ref} tabIndex={-1} className="outline-none">
            <Outlet />
        </div>
    )
}

function RootDocument({ children }: { children: ReactNode }) {
    return (
        <html lang="en">
            <head>
                <HeadContent />
            </head>
            <body>
                {children}
                <Scripts />
            </body>
        </html>
    )
}
