import { useQuery, useSuspenseQuery } from '@tanstack/react-query'
import { createFileRoute, Link, notFound } from '@tanstack/react-router'
import { ReviewSummary } from '../components/ReviewSummary'
import { WatchlistButton } from '../components/WatchlistButton'
import { movieDetailsQueryOptions, movieSummaryQueryOptions, releaseYear } from '../lib/movies'
import { formatRuntime, TMDB_BACKDROP_BASE, TMDB_POSTER_BASE } from '../lib/tmdb'

function parseId(raw: string): number {
    const id = Number(raw)
    if (!Number.isInteger(id) || id <= 0) throw notFound()
    return id
}

export const Route = createFileRoute('/movie/$id')({
    loader: ({ context, params }) =>
        context.queryClient.ensureQueryData(movieDetailsQueryOptions(parseId(params.id))),
    component: MovieDetail,
    errorComponent: () => (
        <main className="page">
            <p className="grid-state grid-state--error" role="alert">
                We couldn’t load this movie. It may not exist, or the service is unavailable.
            </p>
            <p className="detail__back-row">
                <Link to="/">← Back to discovery</Link>
            </p>
        </main>
    ),
    notFoundComponent: () => (
        <main className="page">
            <p className="grid-state">That movie isn’t a valid id.</p>
            <p className="detail__back-row">
                <Link to="/">← Back to discovery</Link>
            </p>
        </main>
    ),
})

function MovieDetail() {
    const { id } = Route.useParams()
    const movieId = Number(id)
    const { data: movie } = useSuspenseQuery(movieDetailsQueryOptions(movieId))
    const summary = useQuery(movieSummaryQueryOptions(movieId))

    const runtime = formatRuntime(movie.runtime)
    const rating = movie.voteAverage && movie.voteAverage > 0 ? movie.voteAverage.toFixed(1) : null

    return (
        <main className="page detail">
            <div
                className="detail__backdrop"
                style={
                    movie.backdropPath
                        ? { backgroundImage: `url(${TMDB_BACKDROP_BASE}${movie.backdropPath})` }
                        : undefined
                }
                aria-hidden="true"
            />

            <Link to="/" className="detail__back">
                ← Back to discovery
            </Link>

            <div className="detail__main">
                <div className="detail__poster">
                    {movie.posterPath ? (
                        <img
                            src={`${TMDB_POSTER_BASE}${movie.posterPath}`}
                            alt={`${movie.title} poster`}
                        />
                    ) : (
                        <div className="movie-card__poster--empty" aria-hidden="true">
                            🎬
                        </div>
                    )}
                </div>

                <div className="detail__body">
                    <h1 className="detail__title">{movie.title}</h1>
                    <p className="detail__meta">
                        <span>{releaseYear(movie)}</span>
                        {runtime && (
                            <>
                                <span aria-hidden="true">·</span>
                                <span>{runtime}</span>
                            </>
                        )}
                        {rating && (
                            <>
                                <span aria-hidden="true">·</span>
                                <span className="detail__rating">★ {rating}</span>
                            </>
                        )}
                    </p>

                    {movie.genres.length > 0 && (
                        <ul className="detail__genres">
                            {movie.genres.map((genre) => (
                                <li key={genre}>{genre}</li>
                            ))}
                        </ul>
                    )}

                    {movie.tagline && <p className="detail__tagline">“{movie.tagline}”</p>}
                    {movie.overview && <p className="detail__overview">{movie.overview}</p>}

                    <div className="detail__actions">
                        <WatchlistButton
                            movieId={movie.tmdbId}
                            title={movie.title}
                            posterPath={movie.posterPath}
                        />
                    </div>
                </div>
            </div>

            <div className="detail__summary">
                {summary.isPending ? (
                    <p className="grid-state">Summarizing audience reviews…</p>
                ) : summary.isError ? (
                    <p className="grid-state grid-state--error" role="alert">
                        Couldn’t load the review summary.
                    </p>
                ) : (
                    <ReviewSummary summary={summary.data} />
                )}
            </div>
        </main>
    )
}
