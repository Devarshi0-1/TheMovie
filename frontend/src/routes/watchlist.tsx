import type { MovieResult } from '@themovie/schemas'
import { useQuery } from '@tanstack/react-query'
import { createFileRoute, Link } from '@tanstack/react-router'
import { toast } from 'sonner'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { Empty, EmptyHeader, EmptyDescription } from '@/components/ui/empty'
import { MovieCardLink } from '../components/MovieCardLink'
import { requireSession } from '../lib/auth'
import { useRemoveFromWatchlist, watchlistQueryOptions } from '../lib/watchlist'

export const Route = createFileRoute('/watchlist')({
    // Auth-gated; guard before render so signed-out users never see the shell.
    beforeLoad: ({ context, location }) => requireSession(context.queryClient, location.href),
    component: WatchlistScreen,
})

function WatchlistScreen() {
    const { data, isPending, isError } = useQuery(watchlistQueryOptions)
    const remove = useRemoveFromWatchlist()

    return (
        <main className="mx-auto w-full max-w-[1100px] px-6 py-10">
            <h1 className="mb-6 text-xl font-semibold tracking-tight">Your watchlist</h1>

            {isPending ? (
                <p className="py-8 text-muted-foreground">Loading your watchlist…</p>
            ) : isError ? (
                <Alert variant="destructive">
                    <AlertDescription>
                        Couldn’t load your watchlist. Please try again.
                    </AlertDescription>
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
                <div className="grid grid-cols-[repeat(auto-fill,minmax(170px,1fr))] gap-5">
                    {data.map((entry) => {
                        const movie: MovieResult = {
                            tmdbId: entry.movieId,
                            title: entry.title,
                            overview: null,
                            releaseDate: null,
                            genres: [],
                            posterPath: entry.posterPath,
                        }
                        return (
                            <article key={entry.movieId} className="flex flex-col gap-2">
                                <MovieCardLink movie={movie} />
                                <Button
                                    type="button"
                                    variant="outline"
                                    size="sm"
                                    onClick={() =>
                                        remove.mutate(entry.movieId, {
                                            onSuccess: () =>
                                                toast.success(
                                                    `Removed “${entry.title}” from your watchlist`,
                                                ),
                                            onError: () =>
                                                toast.error(
                                                    `Couldn’t remove “${entry.title}”. Try again.`,
                                                ),
                                        })
                                    }
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
