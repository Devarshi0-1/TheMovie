import type { MovieResult } from '@themovie/schemas'
import { Badge } from '@/components/ui/badge'
import { releaseYear } from '../lib/movies'

const TMDB_POSTER_BASE = 'https://image.tmdb.org/t/p/w342'

/**
 * Presentational movie card. Pure — takes a (schema-validated) movie and renders
 * it. Reused by the discovery grid and detail screens in Phase 7.2.
 */
export function MovieCard({ movie }: { movie: MovieResult }) {
    return (
        <article className="overflow-hidden rounded-xl border border-border bg-card transition hover:-translate-y-0.5 hover:border-primary">
            <div className="aspect-[2/3] bg-muted">
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
            </div>
            <div className="p-3.5">
                <h3 className="mb-0.5 text-sm leading-tight">{movie.title}</h3>
                <p className="mb-2.5 text-xs text-muted-foreground">{releaseYear(movie)}</p>
                <ul className="flex list-none flex-wrap gap-1.5 p-0">
                    {movie.genres.map((genre) => (
                        <li key={genre}>
                            <Badge variant="secondary">{genre}</Badge>
                        </li>
                    ))}
                </ul>
            </div>
        </article>
    )
}
