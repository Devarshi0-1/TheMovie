import { useQuery, useSuspenseQuery } from '@tanstack/react-query'
import { createFileRoute, Link, notFound } from '@tanstack/react-router'
import { ArrowLeft } from 'lucide-react'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { MoreLikeThis } from '../components/MovieExtras'
import { MovieExtrasSection } from '../components/MovieExtrasSection'
import { MovieHero } from '../components/MovieHero'
import { ReviewSummary, ReviewSummarySkeleton } from '../components/ReviewSummary'
import { WatchlistButton } from '../components/WatchlistButton'
import {
    movieDetailsQueryOptions,
    movieExtrasQueryOptions,
    movieSummaryQueryOptions,
} from '../lib/movies'

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

    return (
        <main className="mx-auto w-full max-w-[1100px] px-6 py-8">
            <Link
                to="/"
                className="mb-5 inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground"
            >
                <ArrowLeft className="size-4" aria-hidden="true" /> Back to discovery
            </Link>

            <MovieHero
                movie={movie}
                action={
                    <WatchlistButton
                        movieId={movie.tmdbId}
                        title={movie.title}
                        posterPath={movie.posterPath}
                    />
                }
            />

            <div className="mt-12">
                <MovieExtrasSection extras={extras} />
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
