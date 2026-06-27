import { type QueryClient, queryOptions, useQuery } from '@tanstack/react-query'
import { redirect } from '@tanstack/react-router'
import {
    GetSessionResponseSchema,
    type SessionUser,
    type SignInValues,
    type SignUpValues,
} from '@themovie/schemas'
import { ApiError, apiFetch, apiPost } from './api'

// Auth talks to BetterAuth's email/password endpoints (mounted at
// `/api/auth/*` on the backend). The session is a same-site cookie set by the
// backend; `apiFetch` sends it on every request via `credentials: 'include'`.
//
// Session state is resolved on the CLIENT (the cookie lives on the backend
// origin, so the SSR server can't read it). The whole app reads it through the
// `['session']` TanStack Query below — sign-in / sign-up / sign-out invalidate
// that key to refresh the nav and route guards.
//
// The session/credential schemas are defined once in `@themovie/schemas` and
// re-exported here so consumers (forms, routes) keep importing from `lib/auth`.
export {
    SignInSchema,
    SignUpSchema,
    type SessionUser,
    type SignInValues,
    type SignUpValues,
} from '@themovie/schemas'

/** Resolve the current user, or `null` when signed out. Never throws on 401. */
export async function getSession(): Promise<SessionUser | null> {
    let body: unknown
    try {
        body = await apiFetch('/api/auth/get-session')
    } catch (err) {
        if (err instanceof ApiError && (err.status === 401 || err.status === 403)) return null
        throw err
    }
    const parsed = GetSessionResponseSchema.safeParse(body)
    if (!parsed.success || !parsed.data?.user) return null
    return parsed.data.user
}

export const sessionQueryKey = ['session'] as const

export const sessionQueryOptions = queryOptions({
    queryKey: sessionQueryKey,
    queryFn: getSession,
    // The session rarely changes within a tab; mutations invalidate it
    // explicitly. `retry: false` so a signed-out 401-ish state resolves fast.
    staleTime: 5 * 60_000,
    retry: false,
})

/** Read the current session (`data` is `SessionUser | null`, `undefined` while loading). */
export function useSession() {
    return useQuery(sessionQueryOptions)
}

// ── Route guards (beforeLoad) ────────────────────────────────────────────────
// Router-native guards replace the old effect-based <RequireAuth>: they run
// before the route's loader/component, so there's no flash of protected content
// and the redirect is cache-first. The session cookie is unreadable during SSR
// (it lives on the backend origin), so enforcement happens on the CLIENT only —
// the server renders the shell and the client beforeLoad resolves the session
// (from cache when warm) and redirects if needed.

/** Guard a protected route: redirect signed-out users to /signin (client-side). */
export async function requireSession(queryClient: QueryClient, href: string): Promise<void> {
    if (typeof window === 'undefined') return
    const user = await queryClient.ensureQueryData(sessionQueryOptions)
    if (!user) throw redirect({ to: '/signin', search: { redirect: href } })
}

/** Guard an auth screen: bounce already-signed-in users to `dest` (client-side). */
export async function redirectIfAuthenticated(
    queryClient: QueryClient,
    dest: string,
): Promise<void> {
    if (typeof window === 'undefined') return
    const user = await queryClient.ensureQueryData(sessionQueryOptions)
    if (user) throw redirect({ to: dest })
}

// ── Mutations ───────────────────────────────────────────────────────────────

export function signIn(values: SignInValues) {
    return apiPost('/api/auth/sign-in/email', values)
}

export function signUp(values: SignUpValues) {
    return apiPost('/api/auth/sign-up/email', values)
}

export function signOut() {
    return apiPost('/api/auth/sign-out', {})
}
