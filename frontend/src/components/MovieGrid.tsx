import type { MovieResult } from '@themovie/schemas'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Empty, EmptyHeader, EmptyTitle } from '@/components/ui/empty'
import { Skeleton } from '@/components/ui/skeleton'
import { MovieCardLink } from './MovieCardLink'

interface MovieGridProps {
    movies?: MovieResult[]
    isLoading?: boolean
    isError?: boolean
    emptyLabel?: string
    errorLabel?: string
}

// Fixed (index-free) keys for skeleton placeholders.
const SKELETON_KEYS = ['sk0', 'sk1', 'sk2', 'sk3', 'sk4', 'sk5', 'sk6', 'sk7', 'sk8', 'sk9']

const GRID_CLASS = 'grid grid-cols-[repeat(auto-fill,minmax(170px,1fr))] gap-5'

/**
 * Renders a responsive grid of clickable movie cards, with explicit
 * loading / error / empty states so every screen using it degrades gracefully.
 */
export function MovieGrid({ movies, isLoading, isError, emptyLabel, errorLabel }: MovieGridProps) {
    if (isLoading) {
        return (
            <div className={GRID_CLASS} aria-busy="true" data-testid="movie-grid-loading">
                {SKELETON_KEYS.map((key) => (
                    <Skeleton key={key} className="aspect-[2/3] rounded-xl" aria-hidden="true" />
                ))}
            </div>
        )
    }

    if (isError) {
        return (
            <Alert variant="destructive">
                <AlertDescription>
                    {errorLabel ?? 'Something went wrong loading movies. Please try again.'}
                </AlertDescription>
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
        <div className={GRID_CLASS}>
            {movies.map((movie) => (
                <MovieCardLink key={movie.tmdbId} movie={movie} />
            ))}
        </div>
    )
}
