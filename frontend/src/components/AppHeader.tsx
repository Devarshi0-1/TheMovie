import { useQueryClient } from '@tanstack/react-query'
import { Link } from '@tanstack/react-router'
import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { sessionQueryKey, signOut, useSession } from '../lib/auth'

/**
 * App-wide header with session-aware navigation: brand + Discover/Watchlist
 * links, and either the signed-in user's name + Sign out, or Sign in / Sign up.
 * Session state comes from the shared `['session']` query; signing out
 * invalidates it so the whole app re-renders as signed-out.
 */
export function AppHeader() {
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
        }
    }

    const navLinkClass =
        'text-sm text-muted-foreground transition-colors hover:text-foreground data-[status=active]:text-foreground'

    return (
        <header className="sticky top-0 z-20 border-b border-border bg-background/80 backdrop-blur">
            <div className="mx-auto flex max-w-[1100px] items-center gap-6 px-6 py-3.5">
                <Link
                    to="/"
                    className="inline-flex items-center gap-2 font-bold tracking-tight text-foreground"
                >
                    <span className="text-lg" aria-hidden="true">
                        🎬
                    </span>
                    TheMovie
                </Link>

                <nav className="mr-auto flex gap-5" aria-label="Primary">
                    <Link to="/" className={navLinkClass} activeOptions={{ exact: true }}>
                        Discover
                    </Link>
                    <Link to="/chat" className={navLinkClass}>
                        Chat
                    </Link>
                    <Link to="/watchlist" className={navLinkClass}>
                        Watchlist
                    </Link>
                </nav>

                <div className="flex items-center gap-3.5">
                    {isPending ? null : user ? (
                        <>
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
                        </>
                    ) : (
                        <>
                            <Button asChild variant="ghost" size="sm">
                                <Link to="/signin">Sign in</Link>
                            </Button>
                            <Button asChild size="sm">
                                <Link to="/signup">Sign up</Link>
                            </Button>
                        </>
                    )}
                </div>
            </div>
        </header>
    )
}
