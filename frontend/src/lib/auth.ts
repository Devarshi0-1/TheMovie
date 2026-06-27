import { queryOptions, useQuery } from '@tanstack/react-query'
import { z } from 'zod'
import { ApiError, apiFetch, apiPost } from './api'

// Auth talks to BetterAuth's email/password endpoints (mounted at
// `/api/auth/*` on the backend). The session is a same-site cookie set by the
// backend; `apiFetch` sends it on every request via `credentials: 'include'`.
//
// Session state is resolved on the CLIENT (the cookie lives on the backend
// origin, so the SSR server can't read it). The whole app reads it through the
// `['session']` TanStack Query below — sign-in / sign-up / sign-out invalidate
// that key to refresh the nav and route guards.

export const SessionUserSchema = z.object({
    id: z.string(),
    email: z.string(),
    name: z.string().nullish(),
})
export type SessionUser = z.infer<typeof SessionUserSchema>

// BetterAuth's get-session returns `{ session, user }` when authed and `null`
// (HTTP 200) when not.
const GetSessionResponseSchema = z.object({ user: SessionUserSchema.nullish() }).nullable()

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

// ── Form schemas ──────────────────────────────────────────────────────────
// Client-side validation only; BetterAuth re-validates server-side. Password
// minimum mirrors the backend's `minPasswordLength: 8`.

export const SignInSchema = z.object({
    email: z.string().min(1, 'Email is required').email('Enter a valid email address'),
    password: z.string().min(1, 'Password is required'),
})
export type SignInValues = z.infer<typeof SignInSchema>

export const SignUpSchema = z.object({
    name: z.string().min(1, 'Name is required'),
    email: z.string().min(1, 'Email is required').email('Enter a valid email address'),
    password: z.string().min(8, 'Password must be at least 8 characters'),
})
export type SignUpValues = z.infer<typeof SignUpSchema>

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
