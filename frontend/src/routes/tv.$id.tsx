import { useQuery, useSuspenseQuery } from '@tanstack/react-query'
import { createFileRoute, Link, notFound } from '@tanstack/react-router'
import { ArrowLeft } from 'lucide-react'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { MoreLikeThis } from '../components/MovieExtras'
import { MovieExtrasSection } from '../components/MovieExtrasSection'
import { MovieHero } from '../components/MovieHero'
import { tvDetailsQueryOptions, tvExtrasQueryOptions } from '../lib/movies'

function parseId(raw: string): number {
    const id = Number(raw)
    if (!Number.isInteger(id) || id <= 0) throw notFound()
    return id
}

const BackToTv = () => (
    <Button asChild variant="link">
        <Link to="/tv">
            <ArrowLeft data-icon aria-hidden="true" /> Back to TV shows
        </Link>
    </Button>
)

export const Route = createFileRoute('/tv/$id')({
    loader: ({ context, params }) =>
        context.queryClient.ensureQueryData(tvDetailsQueryOptions(parseId(params.id))),
    component: TvDetail,
    errorComponent: () => (
        <main className="mx-auto w-full max-w-[1100px] px-6 py-10">
            <Alert variant="destructive">
                <AlertDescription>
                    We couldn’t load this show. It may not exist, or the service is unavailable.
                </AlertDescription>
            </Alert>
            <p className="mt-4">
                <BackToTv />
            </p>
        </main>
    ),
    notFoundComponent: () => (
        <main className="mx-auto w-full max-w-[1100px] px-6 py-10">
            <p className="text-muted-foreground">That show isn’t a valid id.</p>
            <p className="mt-4">
                <BackToTv />
            </p>
        </main>
    ),
})

function TvDetail() {
    const { id } = Route.useParams()
    const tvId = Number(id)
    const { data: show } = useSuspenseQuery(tvDetailsQueryOptions(tvId))
    const extras = useQuery(tvExtrasQueryOptions(tvId))

    return (
        <main className="mx-auto w-full max-w-[1100px] px-6 py-8">
            <Link
                to="/tv"
                className="mb-5 inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground"
            >
                <ArrowLeft className="size-4" aria-hidden="true" /> Back to TV shows
            </Link>

            <MovieHero movie={show} />

            <div className="mt-12">
                <MovieExtrasSection extras={extras} />
            </div>

            {extras.isSuccess && extras.data.recommendations.length > 0 && (
                <div className="mt-12">
                    <MoreLikeThis movies={extras.data.recommendations} />
                </div>
            )}
        </main>
    )
}
