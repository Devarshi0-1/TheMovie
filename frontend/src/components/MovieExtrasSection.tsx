import type { MovieExtras as MovieExtrasData } from '@themovie/schemas'
import type { UseQueryResult } from '@tanstack/react-query'
import { Alert, AlertAction, AlertDescription } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { MovieExtras, MovieExtrasSkeleton } from './MovieExtras'

/**
 * The detail-page enrichment block (cast / trailer / where-to-watch) with its
 * loading, error+retry, and ready states. Shared by the movie and TV detail
 * routes — both fetch the same `MovieExtras` shape from their own `/extras`
 * endpoint.
 */
export function MovieExtrasSection({ extras }: { extras: UseQueryResult<MovieExtrasData> }) {
    if (extras.isPending) return <MovieExtrasSkeleton />
    if (extras.isError) {
        return (
            <Alert variant="destructive">
                <AlertDescription>
                    Couldn’t load cast, trailer, and where-to-watch.
                </AlertDescription>
                <AlertAction>
                    <Button variant="outline" size="sm" onClick={() => void extras.refetch()}>
                        Retry
                    </Button>
                </AlertAction>
            </Alert>
        )
    }
    return <MovieExtras extras={extras.data} />
}
