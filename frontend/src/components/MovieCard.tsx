import type { MovieResult } from '@themovie/schemas'
import { Star } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { releaseYear } from '../lib/movies'

const TMDB_POSTER_BASE = 'https://image.tmdb.org/t/p/w342'
// TMDB's 0–10 audience score at/above which we flag a title as "Recommended".
const RECOMMENDED_THRESHOLD = 7.5
// How many genre chips to show before the row gets noisy.
const GENRE_LIMIT = 3

/**
 * Presentational movie card. Pure — takes a (schema-validated) movie and renders
 * a poster with an overlaid rating chip and an optional "Recommended" flag, then
 * title / year / a short overview / genre chips. Reused by the discovery grid,
 * search results, watchlist, and the "more like this" rail.
 */
export function MovieCard({ movie }: { movie: MovieResult }) {
    // TMDB returns 0 for unrated titles; treat that as "no rating" rather than 0.0.
    const rating =
        typeof movie.voteAverage === 'number' && movie.voteAverage > 0 ? movie.voteAverage : null
    const recommended = rating !== null && rating >= RECOMMENDED_THRESHOLD

    return (
        <article className="group flex h-full flex-col overflow-hidden rounded-xl border border-border bg-card shadow-sm transition hover:-translate-y-0.5 hover:border-primary hover:shadow-md">
            <div className="relative aspect-[2/3] bg-muted">
                {movie.posterPath ? (
                    <img
                        src={`${TMDB_POSTER_BASE}${movie.posterPath}`}
                        alt={`${movie.title} poster`}
                        loading="lazy"
                        // Intrinsic dimensions (w342 poster is 342×513, 2:3) give the
                        // browser the aspect ratio up front — no layout shift (web.dev CLS).
                        width={342}
                        height={513}
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

                {recommended && (
                    <Badge className="absolute left-2 top-2 shadow-sm">Recommended</Badge>
                )}
                {rating !== null && (
                    <Badge
                        variant="secondary"
                        className="absolute right-2 top-2 shadow-sm"
                        aria-label={`Rated ${rating.toFixed(1)} out of 10`}
                    >
                        <Star className="fill-primary text-primary" aria-hidden="true" />
                        {rating.toFixed(1)}
                    </Badge>
                )}
            </div>

            <div className="flex flex-1 flex-col gap-2.5 p-3.5">
                <div>
                    <h3 className="line-clamp-1 text-sm font-medium leading-tight">
                        {movie.title}
                    </h3>
                    <p className="mt-0.5 text-xs text-muted-foreground">{releaseYear(movie)}</p>
                </div>
                {movie.overview && (
                    <p className="line-clamp-2 text-xs leading-relaxed text-muted-foreground">
                        {movie.overview}
                    </p>
                )}
                {movie.genres.length > 0 && (
                    <ul className="mt-auto flex list-none flex-wrap gap-1.5 p-0">
                        {movie.genres.slice(0, GENRE_LIMIT).map((genre) => (
                            <li key={genre}>
                                <Badge variant="secondary">{genre}</Badge>
                            </li>
                        ))}
                    </ul>
                )}
            </div>
        </article>
    )
}
