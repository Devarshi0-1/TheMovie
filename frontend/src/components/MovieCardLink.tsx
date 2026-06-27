import type { MovieResult } from '@themovie/schemas'
import { Link } from '@tanstack/react-router'
import { MovieCard } from './MovieCard'

/** A `MovieCard` that navigates to the movie's detail route when clicked. */
export function MovieCardLink({ movie }: { movie: MovieResult }) {
    return (
        <Link to="/movie/$id" params={{ id: String(movie.tmdbId) }} className="movie-card-link">
            <MovieCard movie={movie} />
        </Link>
    )
}
