import type { MovieResult } from '@themovie/schemas'
import { Link } from '@tanstack/react-router'
import { MovieCard } from './MovieCard'

/**
 * A `MovieCard` that navigates to the title's detail route when clicked —
 * `/tv/$id` for a TV show, `/movie/$id` otherwise (a card with no `mediaType`
 * is treated as a movie, matching the agent/DB paths that don't set it).
 */
export function MovieCardLink({ movie }: { movie: MovieResult }) {
    const to = movie.mediaType === 'tv' ? '/tv/$id' : '/movie/$id'
    return (
        <Link
            to={to}
            params={{ id: String(movie.tmdbId) }}
            className="block rounded-xl focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            aria-label={movie.title}
        >
            <MovieCard movie={movie} />
        </Link>
    )
}
