import { Link } from '@tanstack/react-router'
import { SessionActions } from './SessionActions'

/**
 * The plain top header used on auth/landing pages (the signed-in app surface
 * uses the sidebar {@link AppShell} instead). Brand + Discover/Chat/Watchlist
 * links, with session-aware account controls on the right.
 */
export function AppHeader() {
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

                <SessionActions />
            </div>
        </header>
    )
}
