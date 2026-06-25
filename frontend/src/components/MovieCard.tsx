import type { MovieResult } from '@themovie/schemas'
import { releaseYear } from '../lib/movies'

const TMDB_POSTER_BASE = 'https://image.tmdb.org/t/p/w342'

/**
 * Presentational movie card. Pure — takes a (schema-validated) movie and renders
 * it. Reused by the discovery grid and detail screens in Phase 7.2.
 */
export function MovieCard({ movie }: { movie: MovieResult }) {
    return (
        <article className="movie-card">
            <div className="movie-card__poster">
                {movie.posterPath ? (
                    <img
                        src={`${TMDB_POSTER_BASE}${movie.posterPath}`}
                        alt={`${movie.title} poster`}
                        loading="lazy"
                    />
                ) : (
                    <div className="movie-card__poster--empty" aria-hidden="true">
                        🎬
                    </div>
                )}
            </div>
            <div className="movie-card__body">
                <h3 className="movie-card__title">{movie.title}</h3>
                <p className="movie-card__year">{releaseYear(movie)}</p>
                <ul className="movie-card__genres">
                    {movie.genres.map((genre) => (
                        <li key={genre}>{genre}</li>
                    ))}
                </ul>
            </div>
        </article>
    )
}
