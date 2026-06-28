import { ManageWatchlistInputSchema } from '@themovie/schemas'
import { Check } from 'lucide-react'
import { useState } from 'react'
import { Alert } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import type { ManageWatchlistMovie, ManageWatchlistOutput } from '../lib/chat'
import { useAddToWatchlist, useRemoveFromWatchlist } from '../lib/watchlist'

/** Shared presentation for a settled `manage_watchlist` outcome line. */
const HITL_DONE_CLASS =
    'self-start max-w-full rounded-xl border border-dashed border-border bg-transparent p-4 text-sm text-muted-foreground'

/**
 * Human-in-the-loop confirmation for the agent's `manage_watchlist` proposal.
 * The model never mutates the watchlist itself: this renders the proposed change
 * — one movie or a whole batch — and, on a SINGLE approval, applies each through
 * the watchlist mutation hooks (so the query caches are reconciled in one place,
 * even on a partial failure), then reports the outcome back to the conversation
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
    const add = useAddToWatchlist()
    const remove = useRemoveFromWatchlist()

    const parsed = ManageWatchlistInputSchema.safeParse(input)
    if (!parsed.success) {
        return (
            <Alert variant="destructive" className="max-w-full self-start">
                The assistant proposed an invalid watchlist change, so nothing was done.
            </Alert>
        )
    }

    const { action, movies } = parsed.data
    const many = movies.length > 1
    const nameOf = (m: { movieId: number; title?: string }) => m.title ?? `movie ${m.movieId}`
    // The result reported back to the agent carries just id + title per movie.
    const outMovies: ManageWatchlistMovie[] = movies.map((m) => ({
        movieId: m.movieId,
        title: m.title,
    }))

    async function approve() {
        setBusy(true)
        setError(null)
        // Apply every movie in the batch via the mutation hooks; each success
        // reconciles the caches through the hook's onSuccess. REST is idempotent,
        // so retrying after a partial failure is safe.
        const settled = await Promise.allSettled(
            // Each proposed item carries its own mediaType ('movie' by default,
            // 'tv' for a show — Phase 10.4), so a TV proposal hits the TV watchlist.
            movies.map((m) =>
                action === 'add'
                    ? add.mutateAsync({
                          movieId: m.movieId,
                          title: m.title ?? `Movie ${m.movieId}`,
                          posterPath: m.posterPath ?? null,
                          mediaType: m.mediaType,
                      })
                    : remove.mutateAsync({ movieId: m.movieId, mediaType: m.mediaType }),
            ),
        )

        const succeeded: ManageWatchlistMovie[] = []
        const failed: ManageWatchlistMovie[] = []
        movies.forEach((m, i) => {
            const entry: ManageWatchlistMovie = { movieId: m.movieId, title: m.title }
            if (settled[i]?.status === 'fulfilled') succeeded.push(entry)
            else failed.push(entry)
        })

        if (failed.length === 0) {
            onResolve({ status: action === 'add' ? 'added' : 'removed', movies: succeeded })
            return
        }
        if (succeeded.length === 0) {
            // Total failure: keep the prompt so the user can retry (idempotent).
            setError('Could not update your watchlist. Please try again.')
            setBusy(false)
            return
        }
        // Partial success: the succeeded subset is already applied and its caches
        // reconciled. Report the split so the agent learns the outcome and can
        // offer to retry the rest, rather than leaving the tool unresolved.
        onResolve({ status: 'partial', action, movies: succeeded, failed })
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
        <div className="max-w-full self-start rounded-xl border border-primary bg-accent-soft p-4">
            <p className="mb-3 leading-relaxed">
                {action === 'add' ? 'Add' : 'Remove'}{' '}
                {many ? `these ${movies.length} movies` : <strong>{nameOf(movies[0]!)}</strong>}{' '}
                {action === 'add' ? 'to' : 'from'} your watchlist?
            </p>
            {many && (
                <ul className="mb-3 max-h-44 list-disc overflow-y-auto pl-5 text-sm leading-relaxed text-foreground">
                    {movies.map((m) => (
                        <li key={m.movieId}>{nameOf(m)}</li>
                    ))}
                </ul>
            )}
            {error && (
                <p className="mb-2 text-sm text-destructive" role="alert">
                    {error}
                </p>
            )}
            <div className="flex gap-2.5">
                <Button type="button" onClick={() => void approve()} disabled={busy}>
                    {approveLabel}
                </Button>
                <Button type="button" variant="outline" onClick={deny} disabled={busy}>
                    No
                </Button>
            </div>
        </div>
    )
}

/** The settled outcome of a `manage_watchlist` tool call, shown after resolution. */
export function WatchlistOutcome({ output }: { output: unknown }) {
    const o = output as Partial<ManageWatchlistOutput> | null
    if (!o || typeof o.status !== 'string') return null
    if (o.status === 'declined') {
        return <div className={HITL_DONE_CLASS}>You declined the change</div>
    }
    const namesOf = (list: ManageWatchlistMovie[] | undefined) =>
        (list ?? []).map((m) => m.title ?? `movie ${m.movieId}`).join(', ')

    if (o.status === 'partial') {
        const verb = o.action === 'add' ? 'Added' : 'Removed'
        return (
            <div className={HITL_DONE_CLASS}>
                {`${verb} ${namesOf(o.movies) || 'some'}; couldn’t update ${
                    namesOf(o.failed) || 'the rest'
                } — try again`}
            </div>
        )
    }

    const verb = o.status === 'added' ? 'Added' : 'Removed'
    const prep = o.status === 'added' ? 'to' : 'from'
    return (
        <div className={`${HITL_DONE_CLASS} flex items-center gap-2`}>
            <Check className="size-4 shrink-0 text-pro" aria-hidden="true" />
            {`${verb} ${namesOf(o.movies) || 'them'} ${prep} your watchlist`}
        </div>
    )
}
