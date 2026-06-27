import { useQuery } from '@tanstack/react-query'
import { Link } from '@tanstack/react-router'
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
        if (inList) remove.mutate(movieId)
        else add.mutate({ movieId, title, posterPath })
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
                {busy ? '…' : inList ? '✓ On your watchlist' : '+ Add to watchlist'}
            </Button>
            {failed && (
                <p className="text-sm text-destructive" role="alert">
                    Couldn’t update your watchlist. Try again.
                </p>
            )}
        </div>
    )
}
