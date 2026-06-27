import type { MovieResult } from '@themovie/schemas'
import { Alert, AlertAction, AlertDescription } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { Empty, EmptyHeader, EmptyTitle } from '@/components/ui/empty'
import { MovieCardLink } from './MovieCardLink'
import { POSTER_GRID_CLASS, PosterGridSkeleton } from './PosterGridSkeleton'

interface MovieGridProps {
    movies?: MovieResult[]
    isLoading?: boolean
    isError?: boolean
    emptyLabel?: string
    errorLabel?: string
    /** When provided, the error state offers a Retry button (NN/g "recover from errors"). */
    onRetry?: () => void
}

/**
 * Renders a responsive grid of clickable movie cards, with explicit
 * loading / error / empty states so every screen using it degrades gracefully.
 */
export function MovieGrid({
    movies,
    isLoading,
    isError,
    emptyLabel,
    errorLabel,
    onRetry,
}: MovieGridProps) {
    if (isLoading) {
        return <PosterGridSkeleton testId="movie-grid-loading" label="Loading movies" />
    }

    if (isError) {
        return (
            <Alert variant="destructive">
                <AlertDescription>
                    {errorLabel ?? 'Something went wrong loading movies. Please try again.'}
                </AlertDescription>
                {onRetry && (
                    <AlertAction>
                        <Button type="button" variant="outline" size="sm" onClick={onRetry}>
                            Retry
                        </Button>
                    </AlertAction>
                )}
            </Alert>
        )
    }

    if (!movies || movies.length === 0) {
        return (
            <Empty>
                <EmptyHeader>
                    <EmptyTitle>{emptyLabel ?? 'No movies found.'}</EmptyTitle>
                </EmptyHeader>
            </Empty>
        )
    }

    return (
        <div className={POSTER_GRID_CLASS}>
            {movies.map((movie) => (
                <MovieCardLink key={movie.tmdbId} movie={movie} />
            ))}
        </div>
    )
}
