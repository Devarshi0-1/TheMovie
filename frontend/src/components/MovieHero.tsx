import type { MovieDetailView } from '@themovie/schemas'
import { Star } from 'lucide-react'
import type { ReactNode } from 'react'
import { Badge } from '@/components/ui/badge'
import { releaseYear } from '../lib/movies'
import { formatRuntime, TMDB_BACKDROP_BASE, TMDB_POSTER_BASE } from '../lib/tmdb'

/**
 * The cinematic detail-page hero — backdrop behind a gradient scrim, poster, and
 * metadata (year · runtime · rating). Shared by the movie and TV detail routes
 * (both speak the `MovieDetailView` shape). The `action` slot holds the route's
 * primary control (e.g. the watchlist button for movies). The poster shares a
 * `view-transition-name` with its grid card so it morphs into place.
 */
export function MovieHero({ movie, action }: { movie: MovieDetailView; action?: ReactNode }) {
    const runtime = formatRuntime(movie.runtime)
    const rating = movie.voteAverage && movie.voteAverage > 0 ? movie.voteAverage.toFixed(1) : null

    return (
        <section className="relative overflow-hidden rounded-2xl border border-border bg-card">
            {movie.backdropPath && (
                <div
                    className="pointer-events-none absolute inset-0 bg-cover bg-[center_20%] opacity-30"
                    style={{ backgroundImage: `url(${TMDB_BACKDROP_BASE}${movie.backdropPath})` }}
                    aria-hidden="true"
                />
            )}
            <div
                className="pointer-events-none absolute inset-0 bg-gradient-to-tr from-card via-card/95 to-card/65"
                aria-hidden="true"
            />

            <div className="relative grid grid-cols-1 gap-6 p-6 sm:grid-cols-[210px_1fr] sm:gap-8 sm:p-8">
                <div className="aspect-[2/3] overflow-hidden rounded-xl border border-border bg-muted shadow-md max-sm:max-w-[180px]">
                    {movie.posterPath ? (
                        <img
                            src={`${TMDB_POSTER_BASE}${movie.posterPath}`}
                            alt={`${movie.title} poster`}
                            width={342}
                            height={513}
                            // Matches the grid card's poster name so it morphs into
                            // place on navigation (View Transitions).
                            style={{ viewTransitionName: `movie-poster-${movie.tmdbId}` }}
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

                <div className="sm:py-1">
                    <h1 className="mb-3 text-3xl font-semibold leading-tight tracking-tight sm:text-4xl lg:text-5xl">
                        {movie.title}
                    </h1>
                    <div className="mb-4 flex flex-wrap items-center gap-x-2.5 gap-y-1.5 text-sm text-muted-foreground">
                        <span>{releaseYear(movie)}</span>
                        {runtime && (
                            <>
                                <span aria-hidden="true">·</span>
                                <span>{runtime}</span>
                            </>
                        )}
                        {rating && (
                            <span
                                className="inline-flex items-center gap-1 rounded-md bg-secondary px-2 py-0.5 font-medium text-secondary-foreground"
                                aria-label={`Rated ${rating} out of 10`}
                            >
                                <Star
                                    className="size-3.5 fill-primary text-primary"
                                    aria-hidden="true"
                                />
                                {rating}
                            </span>
                        )}
                    </div>

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

                    {action}
                </div>
            </div>
        </section>
    )
}
