import { z } from 'zod'

// The single HTTP boundary between the frontend and the Hono backend. Every
// request goes through `apiFetch` so credentials, JSON handling, and error
// envelopes are handled in exactly one place.
//
// The backend lives on a different origin in dev (frontend :5173, backend
// :3100 locally), so:
//   - the base URL is configurable via `VITE_API_URL` (inlined by Vite on both
//     the server and the client; falls back to the dev backend), and
//   - every request sends `credentials: 'include'` so BetterAuth's session
//     cookie rides along (the two ports are same-site, so the cookie is sent).

export const API_BASE = (
    (import.meta.env.VITE_API_URL as string | undefined) ?? 'http://localhost:3100'
).replace(/\/+$/, '')

/** A typed failure from the API: carries the HTTP status and any Zod issues. */
export class ApiError extends Error {
    readonly status: number
    readonly issues?: unknown
    constructor(message: string, status: number, issues?: unknown) {
        super(message)
        this.name = 'ApiError'
        this.status = status
        this.issues = issues
    }
}

// Our Hono routes return `{ error, issues? }` on failure; BetterAuth returns
// `{ message, code }`. Accept both (and tolerate plain-text bodies) so a
// malformed error body still yields a useful ApiError instead of crashing.
const ErrorBodySchema = z.object({
    error: z.string().optional(),
    message: z.string().optional(),
    issues: z.unknown().optional(),
})

function tryJson(text: string): unknown {
    if (!text) return null
    try {
        return JSON.parse(text)
    } catch {
        return text
    }
}

/**
 * Fetch `path` (absolute, or a `/api/...` path resolved against `API_BASE`) and
 * return the parsed JSON body typed as `T`. Throws `ApiError` on any non-2xx
 * response or network failure — callers (and TanStack Query) handle one error
 * type.
 */
export async function apiFetch<T = unknown>(path: string, init: RequestInit = {}): Promise<T> {
    const url = path.startsWith('http') ? path : `${API_BASE}${path}`

    let res: Response
    try {
        res = await fetch(url, {
            ...init,
            credentials: 'include',
            headers: {
                // Only declare a JSON body when one is actually sent.
                ...(init.body != null ? { 'Content-Type': 'application/json' } : {}),
                ...init.headers,
            },
        })
    } catch (cause) {
        throw new ApiError('Network error — could not reach the server.', 0, cause)
    }

    const data = tryJson(await res.text())

    if (!res.ok) {
        const parsed = ErrorBodySchema.safeParse(data)
        const message =
            (parsed.success && (parsed.data.error ?? parsed.data.message)) ||
            `Request failed with status ${res.status}`
        throw new ApiError(message, res.status, parsed.success ? parsed.data.issues : undefined)
    }

    return data as T
}

/** Convenience JSON POST. */
export function apiPost<T = unknown>(path: string, body: unknown, init: RequestInit = {}) {
    return apiFetch<T>(path, { ...init, method: 'POST', body: JSON.stringify(body) })
}

/** Convenience DELETE. */
export function apiDelete<T = unknown>(path: string, init: RequestInit = {}) {
    return apiFetch<T>(path, { ...init, method: 'DELETE' })
}
