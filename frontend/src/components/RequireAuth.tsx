import { useNavigate } from '@tanstack/react-router'
import { useEffect, type ReactNode } from 'react'
import { useSession } from '../lib/auth'

/**
 * Client-side route guard. The session cookie lives on the backend origin, so
 * it can't be read during SSR — we resolve the session on the client and, until
 * it's known, render a neutral loading state (never the protected content).
 * Signed-out users are bounced to /signin with a return path.
 */
export function RequireAuth({ children, redirect }: { children: ReactNode; redirect: string }) {
    const { data: user, isPending } = useSession()
    const navigate = useNavigate()

    useEffect(() => {
        if (!isPending && !user) {
            void navigate({ to: '/signin', search: { redirect } })
        }
    }, [isPending, user, navigate, redirect])

    if (isPending) {
        return <p className="grid-state">Loading…</p>
    }

    if (!user) {
        // Redirect is in flight; render nothing rather than protected content.
        return null
    }

    return <>{children}</>
}
