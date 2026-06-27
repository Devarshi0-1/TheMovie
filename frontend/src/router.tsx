import { MutationCache, QueryCache, QueryClient } from '@tanstack/react-query'
import { createRouter } from '@tanstack/react-router'
import { setupRouterSsrQueryIntegration } from '@tanstack/react-router-ssr-query'
import { NotFound } from './components/NotFound'
import { RouteError } from './components/RouteError'
import { routeTree } from './routeTree.gen'

// The router factory. TanStack Start discovers `getRouter` by convention and
// calls it once per request (server) / once on hydration (client). A fresh
// QueryClient is created per call so SSR requests never share a cache; the
// SSR-query integration dehydrates it into the HTML and rehydrates on the
// client (replaces the deprecated `routerWithQueryClient`).
export function getRouter() {
    const queryClient = new QueryClient({
        // Centralized observability: query/mutation failures are logged once here
        // rather than per call site.
        queryCache: new QueryCache({
            onError: (error) => console.error('Query error', error),
        }),
        mutationCache: new MutationCache({
            onError: (error) => console.error('Mutation error', error),
        }),
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
        // App-level fallbacks so unknown URLs and unhandled loader/render errors
        // get a branded screen instead of TanStack's bare defaults.
        defaultNotFoundComponent: NotFound,
        defaultErrorComponent: RouteError,
    })

    setupRouterSsrQueryIntegration({ router, queryClient })

    return router
}

declare module '@tanstack/react-router' {
    interface Register {
        router: ReturnType<typeof getRouter>
    }
}
