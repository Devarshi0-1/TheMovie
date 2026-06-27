import { ManageWatchlistInputSchema } from '@themovie/schemas'
import { useState } from 'react'
import type { ManageWatchlistOutput } from '../lib/chat'
import { addToWatchlist, removeFromWatchlist } from '../lib/watchlist'

/**
 * Human-in-the-loop confirmation for the agent's `manage_watchlist` proposal.
 * The model never mutates the watchlist itself: this renders the proposed change
 * — one movie or a whole batch — and, on a SINGLE approval, applies each via the
 * REST endpoints, then reports the outcome back to the conversation
 * (`onResolve` → `addToolResult`) so the agent can confirm. Denial resolves the
 * tool without touching anything.
 */
export function WatchlistConfirm({
    input,
    onResolve,
}: {
    input: unknown
    onResolve: (output: ManageWatchlistOutput) => void
}) {
    const [busy, setBusy] = useState(false)
    const [error, setError] = useState<string | null>(null)

    const parsed = ManageWatchlistInputSchema.safeParse(input)
    if (!parsed.success) {
        return (
            <div className="hitl hitl--error" role="alert">
                The assistant proposed an invalid watchlist change, so nothing was done.
            </div>
        )
    }

    const { action, movies } = parsed.data
    const many = movies.length > 1
    const nameOf = (m: { movieId: number; title?: string }) => m.title ?? `movie ${m.movieId}`
    // The result reported back to the agent carries just id + title per movie.
    const outMovies = movies.map((m) => ({ movieId: m.movieId, title: m.title }))

    async function approve() {
        setBusy(true)
        setError(null)
        // Apply every movie in the batch. Each REST op is idempotent, so a retry
        // after a partial failure is safe.
        const results = await Promise.allSettled(
            movies.map((m) =>
                action === 'add'
                    ? addToWatchlist({
                          movieId: m.movieId,
                          title: m.title ?? `Movie ${m.movieId}`,
                          posterPath: m.posterPath ?? null,
                      })
                    : removeFromWatchlist(m.movieId),
            ),
        )
        const failed = results.filter((r) => r.status === 'rejected').length
        if (failed > 0) {
            setError(
                failed === movies.length
                    ? 'Could not update your watchlist. Please try again.'
                    : `Updated ${movies.length - failed} of ${movies.length}; ${failed} failed — try again.`,
            )
            setBusy(false)
            return
        }
        onResolve({ status: action === 'add' ? 'added' : 'removed', movies: outMovies })
    }

    function deny() {
        onResolve({ status: 'declined', movies: outMovies })
    }

    const approveLabel = busy
        ? 'Applying…'
        : many
          ? `Yes, ${action === 'add' ? 'add' : 'remove'} all ${movies.length}`
          : action === 'add'
            ? 'Yes, add it'
            : 'Yes, remove it'

    return (
        <div className="hitl">
            <p className="hitl__prompt">
                {action === 'add' ? 'Add' : 'Remove'}{' '}
                {many ? (
                    `these ${movies.length} movies`
                ) : (
                    <strong>{nameOf(movies[0]!)}</strong>
                )}{' '}
                {action === 'add' ? 'to' : 'from'} your watchlist?
            </p>
            {many && (
                <ul className="hitl__list">
                    {movies.map((m) => (
                        <li key={m.movieId}>{nameOf(m)}</li>
                    ))}
                </ul>
            )}
            {error && (
                <p className="hitl__error" role="alert">
                    {error}
                </p>
            )}
            <div className="hitl__actions">
                <button type="button" className="hitl__approve" onClick={approve} disabled={busy}>
                    {approveLabel}
                </button>
                <button type="button" className="hitl__deny" onClick={deny} disabled={busy}>
                    No
                </button>
            </div>
        </div>
    )
}

/** The settled outcome of a `manage_watchlist` tool call, shown after resolution. */
export function WatchlistOutcome({ output }: { output: unknown }) {
    const o = output as Partial<ManageWatchlistOutput> | null
    if (!o || typeof o.status !== 'string') return null
    if (o.status === 'declined') {
        return <div className="hitl hitl--done">You declined the change</div>
    }
    const names = (o.movies ?? []).map((m) => m.title ?? `movie ${m.movieId}`).join(', ')
    const verb = o.status === 'added' ? 'Added' : 'Removed'
    const prep = o.status === 'added' ? 'to' : 'from'
    return (
        <div className="hitl hitl--done">{`✓ ${verb} ${names || 'them'} ${prep} your watchlist`}</div>
    )
}
