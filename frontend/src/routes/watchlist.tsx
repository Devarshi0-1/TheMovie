import type { MovieResult, WatchlistEntry } from '@themovie/schemas'
import { useQuery } from '@tanstack/react-query'
import { createFileRoute, Link } from '@tanstack/react-router'
import { toast } from 'sonner'
import { Alert, AlertAction, AlertDescription } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { Empty, EmptyHeader, EmptyDescription } from '@/components/ui/empty'
import { MovieCardLink } from '../components/MovieCardLink'
import { POSTER_GRID_CLASS, PosterGridSkeleton } from '../components/PosterGridSkeleton'
import { requireSession } from '../lib/auth'
import { useAddToWatchlist, useRemoveFromWatchlist, watchlistQueryOptions } from '../lib/watchlist'

export const Route = createFileRoute('/watchlist')({
    // Auth-gated; guard before render so signed-out users never see the shell.
    beforeLoad: ({ context, location }) => requireSession(context.queryClient, location.href),
    component: WatchlistScreen,
})

function WatchlistScreen() {
    const { data, isPending, isError, refetch } = useQuery(watchlistQueryOptions)
    const remove = useRemoveFromWatchlist()
    const add = useAddToWatchlist()

    // Removal is reversible: a neutral toast offers Undo (NN/g "user control &
    // freedom"), which re-adds the entry via the same add mutation.
    function removeWithUndo(entry: WatchlistEntry) {
        remove.mutate(
            { movieId: entry.movieId, mediaType: entry.mediaType },
            {
                onSuccess: () =>
                    toast(`Removed “${entry.title}” from your watchlist`, {
                        duration: 6000,
                        action: {
                            label: 'Undo',
                            onClick: () =>
                                add.mutate(
                                    {
                                        movieId: entry.movieId,
                                        title: entry.title,
                                        posterPath: entry.posterPath,
                                        mediaType: entry.mediaType,
                                    },
                                    { onError: () => toast.error('Couldn’t undo. Try again.') },
                                ),
                        },
                    }),
                onError: () => toast.error(`Couldn’t remove “${entry.title}”. Try again.`),
            },
        )
    }

    return (
        <main className="mx-auto w-full max-w-[1100px] px-6 py-10">
            <h1 className="mb-6 text-xl font-semibold tracking-tight">Your watchlist</h1>

            {isPending ? (
                <PosterGridSkeleton
                    withAction
                    testId="watchlist-loading"
                    label="Loading your watchlist"
                />
            ) : isError ? (
                <Alert variant="destructive">
                    <AlertDescription>
                        Couldn’t load your watchlist. Please try again.
                    </AlertDescription>
                    <AlertAction>
                        <Button
                            type="button"
                            variant="outline"
                            size="sm"
                            onClick={() => void refetch()}
                        >
                            Retry
                        </Button>
                    </AlertAction>
                </Alert>
            ) : data.length === 0 ? (
                <Empty>
                    <EmptyHeader>
                        <EmptyDescription>
                            Nothing saved yet. <Link to="/">Browse what’s trending</Link> and add a
                            film.
                        </EmptyDescription>
                    </EmptyHeader>
                </Empty>
            ) : (
                <div className={POSTER_GRID_CLASS}>
                    {data.map((entry) => {
                        const movie: MovieResult = {
                            tmdbId: entry.movieId,
                            title: entry.title,
                            overview: null,
                            releaseDate: null,
                            genres: [],
                            posterPath: entry.posterPath,
                            // Carry the media type so the card routes to /tv/:id vs /movie/:id.
                            mediaType: entry.mediaType,
                        }
                        return (
                            <article
                                key={`${entry.mediaType}-${entry.movieId}`}
                                className="flex flex-col gap-2"
                            >
                                <MovieCardLink movie={movie} />
                                <Button
                                    type="button"
                                    variant="outline"
                                    size="sm"
                                    onClick={() => removeWithUndo(entry)}
                                    disabled={remove.isPending}
                                >
                                    Remove
                                </Button>
                            </article>
                        )
                    })}
                </div>
            )}
        </main>
    )
}
