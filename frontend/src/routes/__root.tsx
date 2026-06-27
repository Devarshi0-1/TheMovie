/// <reference types="vite/client" />
import type { QueryClient } from '@tanstack/react-query'
import { createRootRouteWithContext, HeadContent, Outlet, Scripts } from '@tanstack/react-router'
import type { ReactNode } from 'react'
import { AppHeader } from '../components/AppHeader'
import { Toaster } from '../components/ui/sonner'
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

function RootComponent() {
    return (
        <RootDocument>
            <AppHeader />
            <Outlet />
            <Toaster richColors closeButton />
        </RootDocument>
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
