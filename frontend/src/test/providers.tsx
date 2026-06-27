import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import {
    createMemoryHistory,
    createRootRoute,
    createRouter,
    RouterProvider,
} from '@tanstack/react-router'
import { render } from '@testing-library/react'
import type { ReactNode } from 'react'

// Test harness for components that use TanStack Router `Link`/`useNavigate` and
// TanStack Query. A throwaway memory router mounts the component under test as
// its root, and a no-retry QueryClient keeps async assertions fast. Seed query
// caches (e.g. the session) via the returned `queryClient` before asserting.

export function makeTestQueryClient() {
    return new QueryClient({ defaultOptions: { queries: { retry: false } } })
}

export function renderWithProviders(
    ui: ReactNode,
    queryClient: QueryClient = makeTestQueryClient(),
) {
    const rootRoute = createRootRoute({ component: () => ui })
    const router = createRouter({
        routeTree: rootRoute,
        history: createMemoryHistory({ initialEntries: ['/'] }),
    })

    const result = render(
        <QueryClientProvider client={queryClient}>
            <RouterProvider router={router} />
        </QueryClientProvider>,
    )

    return { ...result, queryClient }
}
