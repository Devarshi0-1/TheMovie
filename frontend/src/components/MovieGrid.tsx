import type { MovieResult } from '@themovie/schemas'
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

/**
 * Renders a responsive grid of clickable movie cards, with explicit
 * loading / error / empty states so every screen using it degrades gracefully.
 */
export function MovieGrid({ movies, isLoading, isError, emptyLabel, errorLabel }: MovieGridProps) {
    if (isLoading) {
        return (
            <div className="movie-grid" aria-busy="true" data-testid="movie-grid-loading">
                {SKELETON_KEYS.map((key) => (
                    <div key={key} className="movie-card movie-card--skeleton" aria-hidden="true" />
                ))}
            </div>
        )
    }

    if (isError) {
        return (
            <p className="grid-state grid-state--error" role="alert">
                {errorLabel ?? 'Something went wrong loading movies. Please try again.'}
            </p>
        )
    }

    if (!movies || movies.length === 0) {
        return <p className="grid-state">{emptyLabel ?? 'No movies found.'}</p>
    }

    return (
        <div className="movie-grid">
            {movies.map((movie) => (
                <MovieCardLink key={movie.tmdbId} movie={movie} />
            ))}
        </div>
    )
}
