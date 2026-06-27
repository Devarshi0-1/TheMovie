/**
 * Sanitize a post-auth `?redirect=` target. Only internal absolute paths are
 * allowed; protocol-relative (`//host`) and backslash-prefixed (`/\host`)
 * values — which browsers can resolve to an external origin — fall back to `/`.
 * This is the open-redirect boundary for the auth screens.
 */
export function safeRedirect(redirect: string | undefined): string {
    return redirect && redirect.startsWith('/') && redirect[1] !== '/' && redirect[1] !== '\\'
        ? redirect
        : '/'
}
