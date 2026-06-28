import type { MovieResult } from '@themovie/schemas'
import { Link } from '@tanstack/react-router'
import { Star } from 'lucide-react'
import { releaseYear } from '../lib/movies'

// Compact poster for the chat card strip (TMDB serves posters at w185).
const TMDB_POSTER_CARD_BASE = 'https://image.tmdb.org/t/p/w185'

/**
 * The movies and TV shows an assistant turn surfaced, as a horizontally-
 * scrollable strip of clickable poster cards — so the agent's picks are tappable
 * shortcuts to each title's detail page instead of plain text the user has to
 * re-search. Each card routes by `mediaType` (`/tv/$id` for a show, `/movie/$id`
 * otherwise), so a TV result from the TV tools lands on the show's page. Renders
 * nothing when the turn produced no results.
 */
export function ChatMovieResults({ movies }: { movies: MovieResult[] }) {
    if (movies.length === 0) return null

    return (
        <ul
            aria-label="Suggested titles"
            className="-mx-1 mt-1 flex list-none gap-3 overflow-x-auto px-1 pb-2"
        >
            {movies.map((movie) => {
                const rating =
                    typeof movie.voteAverage === 'number' && movie.voteAverage > 0
                        ? movie.voteAverage.toFixed(1)
                        : null
                const to = movie.mediaType === 'tv' ? '/tv/$id' : '/movie/$id'
                return (
                    <li key={`${movie.mediaType ?? 'movie'}-${movie.tmdbId}`} className="shrink-0">
                        <Link
                            to={to}
                            params={{ id: String(movie.tmdbId) }}
                            className="block w-28 rounded-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                            aria-label={movie.title}
                        >
                            <div className="relative aspect-[2/3] overflow-hidden rounded-lg border border-border bg-muted">
                                {movie.posterPath ? (
                                    <img
                                        src={`${TMDB_POSTER_CARD_BASE}${movie.posterPath}`}
                                        alt=""
                                        loading="lazy"
                                        width={185}
                                        height={278}
                                        className="h-full w-full object-cover"
                                    />
                                ) : (
                                    <div
                                        className="grid h-full w-full place-items-center text-2xl opacity-40"
                                        aria-hidden="true"
                                    >
                                        🎬
                                    </div>
                                )}
                                {rating && (
                                    <span className="absolute right-1 top-1 inline-flex items-center gap-0.5 rounded-md bg-secondary px-1.5 py-0.5 text-xs font-medium text-secondary-foreground shadow-sm">
                                        <Star className="size-3 fill-primary text-primary" />
                                        {rating}
                                    </span>
                                )}
                            </div>
                            <p className="mt-1.5 line-clamp-2 text-xs font-medium leading-tight">
                                {movie.title}
                            </p>
                            <p className="text-xs text-muted-foreground">{releaseYear(movie)}</p>
                        </Link>
                    </li>
                )
            })}
        </ul>
    )
}
