import { QueryClient } from '@tanstack/react-query'
import { createRouter } from '@tanstack/react-router'
import { setupRouterSsrQueryIntegration } from '@tanstack/react-router-ssr-query'
import { routeTree } from './routeTree.gen'

// The router factory. TanStack Start discovers `getRouter` by convention and
// calls it once per request (server) / once on hydration (client). A fresh
// QueryClient is created per call so SSR requests never share a cache; the
// SSR-query integration dehydrates it into the HTML and rehydrates on the
// client (replaces the deprecated `routerWithQueryClient`).
export function getRouter() {
    const queryClient = new QueryClient({
        defaultOptions: {
            queries: {
                // Server-rendered data is fresh enough to skip an immediate
                // client refetch on hydration.
                staleTime: 60_000,
            },
        },
    })

    const router = createRouter({
        routeTree,
        context: { queryClient },
        defaultPreload: 'intent',
        scrollRestoration: true,
    })

    setupRouterSsrQueryIntegration({ router, queryClient })

    return router
}

declare module '@tanstack/react-router' {
    interface Register {
        router: ReturnType<typeof getRouter>
    }
}
