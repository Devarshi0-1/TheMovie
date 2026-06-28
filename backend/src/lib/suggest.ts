import { ilike } from 'drizzle-orm'
import type { MovieResult } from '@themovie/schemas'
import { db } from '../db'
import { movies } from '../db/schema'
import { toMovieResults } from './movieView'
import { searchMovie } from './tmdb'

// Typeahead suggestions for the search box. Blends two sources so results feel
// instant AND broad:
//   • the LOCAL catalog (Postgres `movies`, title ILIKE) — already-ingested
//     titles, no network hop;
//   • TMDB search — breadth for anything not in the catalog (itself Redis-cached
//     for an hour by `searchMovie`, so repeat keystrokes are cheap).
// Local hits rank first (they're in-catalog and the agent can answer about them
// without a write-back), then TMDB fills the rest, deduped by tmdbId. No OpenAI
// is involved — this is pure SQL + the cached TMDB proxy.

export const SUGGEST_LIMIT = 8

// Escape LIKE/ILIKE metacharacters so a user-typed title matches as a literal
// substring (a `%`/`_` shouldn't act as a wildcard). The value is still
// parameter-bound by Drizzle — this is search semantics, not injection defense.
function escapeLike(value: string): string {
    return value.replace(/[\\%_]/g, (ch) => `\\${ch}`)
}

export interface SuggestDeps {
    /** Local catalog title search (Postgres). */
    localSearch: (query: string, limit: number) => Promise<MovieResult[]>
    /** Breadth search (TMDB, Redis-cached). */
    tmdbSearch: (query: string) => Promise<MovieResult[]>
}

function defaultDeps(): SuggestDeps {
    return {
        async localSearch(query, limit) {
            const rows = await db
                .select({
                    tmdbId: movies.tmdbId,
                    title: movies.title,
                    overview: movies.overview,
                    releaseDate: movies.releaseDate,
                    genres: movies.genres,
                    posterPath: movies.posterPath,
                })
                .from(movies)
                .where(ilike(movies.title, `%${escapeLike(query)}%`))
                .limit(limit)

            return rows.map((row) => ({
                tmdbId: row.tmdbId,
                title: row.title,
                overview: row.overview,
                releaseDate: row.releaseDate,
                genres:
                    Array.isArray(row.genres) ?
                        row.genres.filter((g): g is string => typeof g === 'string')
                    :   [],
                posterPath: row.posterPath,
            }))
        },
        async tmdbSearch(query) {
            const results = await searchMovie(query)
            return results ? toMovieResults(results) : []
        },
    }
}

/**
 * Up to `SUGGEST_LIMIT` suggestions for `query`: local catalog matches first,
 * then TMDB results, deduped by `tmdbId`. Returns `[]` for a blank query. Any
 * TMDB failure degrades to local-only rather than throwing — the box keeps
 * working offline-ish.
 */
export async function suggestMovies(
    query: string,
    deps: SuggestDeps = defaultDeps(),
): Promise<MovieResult[]> {
    const q = query.trim()
    if (!q) return []

    const local = await deps.localSearch(q, SUGGEST_LIMIT).catch(() => [])
    const remote = local.length >= SUGGEST_LIMIT ? [] : await deps.tmdbSearch(q).catch(() => [])

    const seen = new Set<number>()
    const out: MovieResult[] = []
    for (const movie of [...local, ...remote]) {
        if (out.length >= SUGGEST_LIMIT) break
        if (seen.has(movie.tmdbId)) continue
        seen.add(movie.tmdbId)
        out.push(movie)
    }
    return out
}
