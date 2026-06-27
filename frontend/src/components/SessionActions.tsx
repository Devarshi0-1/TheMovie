import { useQueryClient } from '@tanstack/react-query'
import { Link } from '@tanstack/react-router'
import { useState } from 'react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { sessionQueryKey, signOut, useSession } from '../lib/auth'

/**
 * Session-aware account controls: the signed-in user's name + Sign out, or
 * Sign in / Sign up when signed out. Shared by the app-shell top bar and the
 * auth-pages header. Signing out invalidates the shared `['session']` query so
 * the whole app re-renders as signed-out.
 */
export function SessionActions() {
    const { data: user, isPending } = useSession()
    const queryClient = useQueryClient()
    const [signingOut, setSigningOut] = useState(false)

    async function handleSignOut() {
        setSigningOut(true)
        try {
            await signOut()
        } catch {
            // Even if the request fails, drop the local session so the UI is
            // consistent; the next guarded action will re-check server-side.
        } finally {
            await queryClient.invalidateQueries({ queryKey: sessionQueryKey })
            setSigningOut(false)
            toast.success('Signed out')
        }
    }

    if (isPending) return null

    return user ? (
        <div className="flex items-center gap-3.5">
            <span
                className="max-w-[16ch] truncate text-sm text-muted-foreground"
                title={user.email}
            >
                {user.name ?? user.email}
            </span>
            <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => void handleSignOut()}
                disabled={signingOut}
            >
                {signingOut ? 'Signing out…' : 'Sign out'}
            </Button>
        </div>
    ) : (
        <div className="flex items-center gap-3.5">
            <Button asChild variant="ghost" size="sm">
                <Link to="/signin">Sign in</Link>
            </Button>
            <Button asChild size="sm">
                <Link to="/signup">Sign up</Link>
            </Button>
        </div>
    )
}
