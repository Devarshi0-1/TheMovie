import { useQueryClient } from '@tanstack/react-query'
import { Link } from '@tanstack/react-router'
import { useState } from 'react'
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

    return (
        <header className="appheader">
            <div className="appheader__inner">
                <Link to="/" className="appheader__brand">
                    <span className="appheader__mark" aria-hidden="true">
                        🎬
                    </span>
                    TheMovie
                </Link>

                <nav className="appheader__nav" aria-label="Primary">
                    <Link to="/" className="appheader__link" activeOptions={{ exact: true }}>
                        Discover
                    </Link>
                    <Link to="/watchlist" className="appheader__link">
                        Watchlist
                    </Link>
                </nav>

                <div className="appheader__auth">
                    {isPending ? null : user ? (
                        <>
                            <span className="appheader__user" title={user.email}>
                                {user.name ?? user.email}
                            </span>
                            <button
                                type="button"
                                className="appheader__btn"
                                onClick={handleSignOut}
                                disabled={signingOut}
                            >
                                {signingOut ? 'Signing out…' : 'Sign out'}
                            </button>
                        </>
                    ) : (
                        <>
                            <Link to="/signin" className="appheader__link">
                                Sign in
                            </Link>
                            <Link to="/signup" className="appheader__btn appheader__btn--primary">
                                Sign up
                            </Link>
                        </>
                    )}
                </div>
            </div>
        </header>
    )
}
