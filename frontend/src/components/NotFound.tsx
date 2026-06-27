import { Link } from '@tanstack/react-router'

/** App-level 404 — the router's `defaultNotFoundComponent` for unknown URLs. */
export function NotFound() {
    return (
        <main className="page">
            <h1 className="section-title">Page not found</h1>
            <p className="grid-state">
                That page doesn’t exist. <Link to="/">Back to discovery</Link>.
            </p>
        </main>
    )
}
