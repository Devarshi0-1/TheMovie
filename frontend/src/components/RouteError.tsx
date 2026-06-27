import { Link, type ErrorComponentProps } from '@tanstack/react-router'

/** App-level error screen — the router's `defaultErrorComponent`. */
export function RouteError({ error }: ErrorComponentProps) {
    const message = error instanceof Error ? error.message : 'Something went wrong.'
    return (
        <main className="page">
            <h1 className="section-title">Something went wrong</h1>
            <p className="grid-state grid-state--error" role="alert">
                {message}
            </p>
            <p className="grid-state">
                <Link to="/">Back to discovery</Link>
            </p>
        </main>
    )
}
