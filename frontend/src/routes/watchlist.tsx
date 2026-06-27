import type { MovieResult } from '@themovie/schemas'
import { useQuery } from '@tanstack/react-query'
import { createFileRoute, Link } from '@tanstack/react-router'
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
        <main className="page">
            <h1 className="section-title">Your watchlist</h1>

            {isPending ? (
                <p className="grid-state">Loading your watchlist…</p>
            ) : isError ? (
                <p className="grid-state grid-state--error" role="alert">
                    Couldn’t load your watchlist. Please try again.
                </p>
            ) : data.length === 0 ? (
                <p className="grid-state">
                    Nothing saved yet. <Link to="/">Browse what’s trending</Link> and add a film.
                </p>
            ) : (
                <div className="movie-grid">
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
                            <article key={entry.movieId} className="wl-item">
                                <MovieCardLink movie={movie} />
                                <button
                                    type="button"
                                    className="wl-remove"
                                    onClick={() => remove.mutate(entry.movieId)}
                                    disabled={remove.isPending}
                                >
                                    Remove
                                </button>
                            </article>
                        )
                    })}
                </div>
            )}
        </main>
    )
}
