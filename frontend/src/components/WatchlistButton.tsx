import { useQuery } from '@tanstack/react-query'
import { Link } from '@tanstack/react-router'
import { Check, Plus } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { useSession } from '../lib/auth'
import {
    useAddToWatchlist,
    useRemoveFromWatchlist,
    watchlistStatusQueryOptions,
} from '../lib/watchlist'

interface WatchlistButtonProps {
    movieId: number
    title: string
    posterPath: string | null
}

/**
 * Toggles a movie on/off the signed-in user's watchlist. When signed out it
 * becomes a "Sign in to save" link that returns to this movie after auth.
 * Membership comes from `GET /watchlist/:id/status` (only queried when signed
 * in) and the add/remove mutations keep that cache in sync.
 */
export function WatchlistButton({ movieId, title, posterPath }: WatchlistButtonProps) {
    const { data: user, isPending: sessionPending } = useSession()
    const signedIn = Boolean(user)

    const statusQuery = useQuery(watchlistStatusQueryOptions(movieId, signedIn))
    const add = useAddToWatchlist()
    const remove = useRemoveFromWatchlist()

    if (sessionPending) {
        return (
            <Button type="button" disabled>
                …
            </Button>
        )
    }

    if (!signedIn) {
        return (
            <Button asChild variant="outline">
                <Link to="/signin" search={{ redirect: `/movie/${movieId}` }}>
                    Sign in to save
                </Link>
            </Button>
        )
    }

    const inList = statusQuery.data === true
    const busy = add.isPending || remove.isPending || statusQuery.isLoading
    const failed = add.isError || remove.isError

    function toggle() {
        // Toast at the call site (not in the shared hooks) so the chat HITL flow,
        // which reuses these hooks for batch changes, keeps its own inline outcome
        // instead of firing one toast per movie.
        if (inList) {
            remove.mutate(movieId, {
                // Removal is reversible: a neutral toast offers Undo (NN/g "user
                // control & freedom") which re-adds via the same add mutation.
                onSuccess: () =>
                    toast(`Removed “${title}” from your watchlist`, {
                        duration: 6000,
                        action: {
                            label: 'Undo',
                            onClick: () =>
                                add.mutate(
                                    { movieId, title, posterPath },
                                    { onError: () => toast.error('Couldn’t undo. Try again.') },
                                ),
                        },
                    }),
                onError: () => toast.error(`Couldn’t remove “${title}”. Try again.`),
            })
        } else {
            add.mutate(
                { movieId, title, posterPath },
                {
                    onSuccess: () => toast.success(`Added “${title}” to your watchlist`),
                    onError: () => toast.error(`Couldn’t add “${title}”. Try again.`),
                },
            )
        }
    }

    return (
        <div className="flex flex-col items-start gap-2">
            <Button
                type="button"
                variant={inList ? 'outline' : 'default'}
                onClick={toggle}
                disabled={busy}
                aria-pressed={inList}
            >
                {busy ? (
                    '…'
                ) : inList ? (
                    <>
                        <Check data-icon aria-hidden="true" /> On your watchlist
                    </>
                ) : (
                    <>
                        <Plus data-icon aria-hidden="true" /> Add to watchlist
                    </>
                )}
            </Button>
            {failed && (
                <p className="text-sm text-destructive" role="alert">
                    Couldn’t update your watchlist. Try again.
                </p>
            )}
        </div>
    )
}
