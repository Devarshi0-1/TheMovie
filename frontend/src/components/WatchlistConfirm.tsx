import { ManageWatchlistInputSchema } from '@themovie/schemas'
import { useState } from 'react'
import type { ManageWatchlistOutput } from '../lib/chat'
import { addToWatchlist, removeFromWatchlist } from '../lib/watchlist'

/**
 * Human-in-the-loop confirmation for the agent's `manage_watchlist` proposal.
 * The model never mutates the watchlist itself: this renders the proposed change
 * and, on approval, performs it via the REST endpoint, then reports the outcome
 * back to the conversation (`onResolve` → `addToolResult`) so the agent can
 * confirm. Denial resolves the tool without touching anything.
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

    const { action, movieId, title, posterPath } = parsed.data
    const label = title ?? `movie ${movieId}`

    async function approve() {
        setBusy(true)
        setError(null)
        try {
            if (action === 'add') {
                await addToWatchlist({
                    movieId,
                    title: title ?? `Movie ${movieId}`,
                    posterPath: posterPath ?? null,
                })
                onResolve({ status: 'added', movieId, title })
            } else {
                await removeFromWatchlist(movieId)
                onResolve({ status: 'removed', movieId, title })
            }
        } catch (err) {
            setError(err instanceof Error ? err.message : 'Could not update your watchlist.')
            setBusy(false)
        }
    }

    function deny() {
        onResolve({ status: 'declined', movieId, title })
    }

    return (
        <div className="hitl">
            <p className="hitl__prompt">
                {action === 'add' ? 'Add' : 'Remove'} <strong>{label}</strong>{' '}
                {action === 'add' ? 'to' : 'from'} your watchlist?
            </p>
            {error && (
                <p className="hitl__error" role="alert">
                    {error}
                </p>
            )}
            <div className="hitl__actions">
                <button type="button" className="hitl__approve" onClick={approve} disabled={busy}>
                    {busy ? 'Applying…' : action === 'add' ? 'Yes, add it' : 'Yes, remove it'}
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
    const text =
        o.status === 'added'
            ? `✓ Added ${o.title ?? 'it'} to your watchlist`
            : o.status === 'removed'
              ? `✓ Removed ${o.title ?? 'it'} from your watchlist`
              : 'You declined the change'
    return <div className="hitl hitl--done">{text}</div>
}
