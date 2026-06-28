import { useQuery, useSuspenseQuery } from '@tanstack/react-query'
import { createFileRoute, Link, notFound } from '@tanstack/react-router'
import { ArrowLeft, Star } from 'lucide-react'
import { Alert, AlertAction, AlertDescription } from '@/components/ui/alert'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { MovieExtras, MovieExtrasSkeleton, MoreLikeThis } from '../components/MovieExtras'
import { ReviewSummary, ReviewSummarySkeleton } from '../components/ReviewSummary'
import { WatchlistButton } from '../components/WatchlistButton'
import {
    movieDetailsQueryOptions,
    movieExtrasQueryOptions,
    movieSummaryQueryOptions,
    releaseYear,
} from '../lib/movies'
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
        <main className="mx-auto w-full max-w-[1100px] px-6 py-10">
            <Alert variant="destructive">
                <AlertDescription>
                    We couldn’t load this movie. It may not exist, or the service is unavailable.
                </AlertDescription>
            </Alert>
            <p className="mt-4">
                <Button asChild variant="link">
                    <Link to="/">
                        <ArrowLeft data-icon aria-hidden="true" /> Back to discovery
                    </Link>
                </Button>
            </p>
        </main>
    ),
    notFoundComponent: () => (
        <main className="mx-auto w-full max-w-[1100px] px-6 py-10">
            <p className="text-muted-foreground">That movie isn’t a valid id.</p>
            <p className="mt-4">
                <Button asChild variant="link">
                    <Link to="/">
                        <ArrowLeft data-icon aria-hidden="true" /> Back to discovery
                    </Link>
                </Button>
            </p>
        </main>
    ),
})

function MovieDetail() {
    const { id } = Route.useParams()
    const movieId = Number(id)
    const { data: movie } = useSuspenseQuery(movieDetailsQueryOptions(movieId))
    const summary = useQuery(movieSummaryQueryOptions(movieId))
    const extras = useQuery(movieExtrasQueryOptions(movieId))

    const runtime = formatRuntime(movie.runtime)
    const rating = movie.voteAverage && movie.voteAverage > 0 ? movie.voteAverage.toFixed(1) : null

    return (
        <main className="mx-auto w-full max-w-[1100px] px-6 py-8">
            <Link
                to="/"
                className="mb-5 inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground"
            >
                <ArrowLeft className="size-4" aria-hidden="true" /> Back to discovery
            </Link>

            {/* Cinematic hero: the backdrop fills the band behind a gradient scrim,
                with the poster and metadata over it. */}
            <section className="relative overflow-hidden rounded-2xl border border-border bg-card">
                {movie.backdropPath && (
                    <div
                        className="pointer-events-none absolute inset-0 bg-cover bg-[center_20%] opacity-30"
                        style={{
                            backgroundImage: `url(${TMDB_BACKDROP_BASE}${movie.backdropPath})`,
                        }}
                        aria-hidden="true"
                    />
                )}
                <div
                    className="pointer-events-none absolute inset-0 bg-gradient-to-tr from-card via-card/95 to-card/65"
                    aria-hidden="true"
                />

                <div className="relative grid grid-cols-1 gap-6 p-6 sm:grid-cols-[210px_1fr] sm:gap-8 sm:p-8">
                    <div className="aspect-[2/3] overflow-hidden rounded-xl border border-border bg-muted shadow-md max-sm:max-w-[180px]">
                        {movie.posterPath ? (
                            <img
                                src={`${TMDB_POSTER_BASE}${movie.posterPath}`}
                                alt={`${movie.title} poster`}
                                width={342}
                                height={513}
                                // Matches the grid card's poster name so it morphs
                                // into place on navigation (View Transitions).
                                style={{ viewTransitionName: `movie-poster-${movie.tmdbId}` }}
                                className="h-full w-full object-cover"
                            />
                        ) : (
                            <div
                                className="grid h-full w-full place-items-center text-4xl opacity-40"
                                aria-hidden="true"
                            >
                                🎬
                            </div>
                        )}
                    </div>

                    <div className="sm:py-1">
                        <h1 className="mb-3 text-3xl font-semibold leading-tight tracking-tight sm:text-4xl lg:text-5xl">
                            {movie.title}
                        </h1>
                        <div className="mb-4 flex flex-wrap items-center gap-x-2.5 gap-y-1.5 text-sm text-muted-foreground">
                            <span>{releaseYear(movie)}</span>
                            {runtime && (
                                <>
                                    <span aria-hidden="true">·</span>
                                    <span>{runtime}</span>
                                </>
                            )}
                            {rating && (
                                <span
                                    className="inline-flex items-center gap-1 rounded-md bg-secondary px-2 py-0.5 font-medium text-secondary-foreground"
                                    aria-label={`Rated ${rating} out of 10`}
                                >
                                    <Star
                                        className="size-3.5 fill-primary text-primary"
                                        aria-hidden="true"
                                    />
                                    {rating}
                                </span>
                            )}
                        </div>

                        {movie.genres.length > 0 && (
                            <ul className="mb-5 flex list-none flex-wrap gap-2 p-0">
                                {movie.genres.map((genre) => (
                                    <li key={genre}>
                                        <Badge variant="secondary">{genre}</Badge>
                                    </li>
                                ))}
                            </ul>
                        )}

                        {movie.tagline && (
                            <p className="mb-4 italic text-muted-foreground">“{movie.tagline}”</p>
                        )}
                        {movie.overview && (
                            <p className="mb-7 max-w-[60ch] leading-relaxed">{movie.overview}</p>
                        )}

                        <WatchlistButton
                            movieId={movie.tmdbId}
                            title={movie.title}
                            posterPath={movie.posterPath}
                        />
                    </div>
                </div>
            </section>

            <div className="mt-12">
                {extras.isPending ? (
                    <MovieExtrasSkeleton />
                ) : extras.isError ? (
                    <Alert variant="destructive">
                        <AlertDescription>
                            Couldn’t load cast, trailer, and where-to-watch.
                        </AlertDescription>
                        <AlertAction>
                            <Button
                                variant="outline"
                                size="sm"
                                onClick={() => {
                                    void extras.refetch()
                                }}
                            >
                                Retry
                            </Button>
                        </AlertAction>
                    </Alert>
                ) : (
                    <MovieExtras extras={extras.data} />
                )}
            </div>

            <div className="mt-12">
                {summary.isPending ? (
                    <ReviewSummarySkeleton />
                ) : summary.isError ? (
                    <Alert variant="destructive">
                        <AlertDescription>Couldn’t load the review summary.</AlertDescription>
                    </Alert>
                ) : (
                    <ReviewSummary summary={summary.data} />
                )}
            </div>

            {extras.isSuccess && extras.data.recommendations.length > 0 && (
                <div className="mt-12">
                    <MoreLikeThis movies={extras.data.recommendations} />
                </div>
            )}
        </main>
    )
}
