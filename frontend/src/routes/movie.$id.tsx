import { useQuery, useSuspenseQuery } from '@tanstack/react-query'
import { createFileRoute, Link, notFound } from '@tanstack/react-router'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { ReviewSummary, ReviewSummarySkeleton } from '../components/ReviewSummary'
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
        <main className="mx-auto w-full max-w-[1100px] px-6 py-10">
            <Alert variant="destructive">
                <AlertDescription>
                    We couldn’t load this movie. It may not exist, or the service is unavailable.
                </AlertDescription>
            </Alert>
            <p className="mt-4">
                <Button asChild variant="link">
                    <Link to="/">← Back to discovery</Link>
                </Button>
            </p>
        </main>
    ),
    notFoundComponent: () => (
        <main className="mx-auto w-full max-w-[1100px] px-6 py-10">
            <p className="text-muted-foreground">That movie isn’t a valid id.</p>
            <p className="mt-4">
                <Button asChild variant="link">
                    <Link to="/">← Back to discovery</Link>
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

    const runtime = formatRuntime(movie.runtime)
    const rating = movie.voteAverage && movie.voteAverage > 0 ? movie.voteAverage.toFixed(1) : null

    return (
        <main className="relative mx-auto w-full max-w-[1100px] px-6 py-10">
            <div
                className="pointer-events-none absolute inset-x-0 top-0 z-0 h-[340px] bg-cover bg-[center_20%] opacity-20 [mask-image:linear-gradient(to_bottom,black,transparent)]"
                style={
                    movie.backdropPath
                        ? { backgroundImage: `url(${TMDB_BACKDROP_BASE}${movie.backdropPath})` }
                        : undefined
                }
                aria-hidden="true"
            />

            <Link
                to="/"
                className="relative z-10 mb-6 inline-block text-sm text-muted-foreground hover:text-foreground"
            >
                ← Back to discovery
            </Link>

            <div className="relative z-10 grid grid-cols-1 gap-8 sm:grid-cols-[240px_1fr] sm:items-start">
                <div className="aspect-[2/3] overflow-hidden rounded-xl border border-border bg-muted max-sm:max-w-[200px]">
                    {movie.posterPath ? (
                        <img
                            src={`${TMDB_POSTER_BASE}${movie.posterPath}`}
                            alt={`${movie.title} poster`}
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

                <div>
                    <h1 className="mb-3 text-3xl font-semibold leading-tight tracking-tight sm:text-4xl">
                        {movie.title}
                    </h1>
                    <p className="mb-4 flex items-center gap-2.5 text-sm text-muted-foreground">
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
                                <span className="font-semibold text-primary">★ {rating}</span>
                            </>
                        )}
                    </p>

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

                    <div className="mt-2">
                        <WatchlistButton
                            movieId={movie.tmdbId}
                            title={movie.title}
                            posterPath={movie.posterPath}
                        />
                    </div>
                </div>
            </div>

            <div className="relative z-10 mt-12">
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
        </main>
    )
}
