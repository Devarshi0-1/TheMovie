import { ilike } from 'drizzle-orm'
import type { GroupedSuggestions, MovieResult } from '@themovie/schemas'
import { db } from '../db'
import { movies, tvShows } from '../db/schema'
import { toMovieResults, toTvResults } from './movieView'
import { searchMovie, searchTv } from './tmdb'

// Typeahead suggestions for the search box. Blends two sources so results feel
// instant AND broad:
//   • the LOCAL catalog (Postgres, title ILIKE) — already-ingested titles, no
//     network hop;
//   • TMDB search — breadth for anything not in the catalog (itself Redis-cached
//     for an hour by `searchMovie`/`searchTv`, so repeat keystrokes are cheap).
// Local hits rank first (they're in-catalog and the agent can answer about them
// without a write-back), then TMDB fills the rest, deduped by tmdbId. No OpenAI
// is involved — this is pure SQL + the cached TMDB proxy.
//
// The same blend serves movies and TV: only the table + TMDB fetcher differ, so
// the merge core is shared and `suggestMovies`/`suggestTvShows` just inject deps.
// `suggestAll` runs both in parallel for the grouped multi-suggest endpoint.

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

function movieDeps(): SuggestDeps {
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
                mediaType: 'movie' as const,
            }))
        },
        async tmdbSearch(query) {
            const results = await searchMovie(query)
            return results ? toMovieResults(results) : []
        },
    }
}

function tvDeps(): SuggestDeps {
    return {
        async localSearch(query, limit) {
            const rows = await db
                .select({
                    tmdbId: tvShows.tmdbId,
                    title: tvShows.title,
                    overview: tvShows.overview,
                    releaseDate: tvShows.releaseDate,
                    genres: tvShows.genres,
                    posterPath: tvShows.posterPath,
                })
                .from(tvShows)
                .where(ilike(tvShows.title, `%${escapeLike(query)}%`))
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
                // Mark every TV hit so the card routes to /tv/:id, not /movie/:id.
                mediaType: 'tv' as const,
            }))
        },
        async tmdbSearch(query) {
            const results = await searchTv(query)
            return toTvResults(results)
        },
    }
}

// Shared merge: local first, then TMDB fills the rest, deduped by tmdbId, capped
// at SUGGEST_LIMIT. A blank query short-circuits to []. Either source failing
// degrades to whatever the other returned (the box keeps working offline-ish).
async function gatherSuggestions(query: string, deps: SuggestDeps): Promise<MovieResult[]> {
    const q = query.trim()
    if (!q) return []

    const local = await deps.localSearch(q, SUGGEST_LIMIT).catch(() => [])
    const remote = local.length >= SUGGEST_LIMIT ? [] : await deps.tmdbSearch(q).catch(() => [])

    const seen = new Set<number>()
    const out: MovieResult[] = []
    for (const item of [...local, ...remote]) {
        if (out.length >= SUGGEST_LIMIT) break
        if (seen.has(item.tmdbId)) continue
        seen.add(item.tmdbId)
        out.push(item)
    }
    return out
}

/**
 * Up to `SUGGEST_LIMIT` movie suggestions for `query`: local catalog matches
 * first, then TMDB results, deduped by `tmdbId`. Returns `[]` for a blank query.
 */
export async function suggestMovies(
    query: string,
    deps: SuggestDeps = movieDeps(),
): Promise<MovieResult[]> {
    return gatherSuggestions(query, deps)
}

/**
 * Up to `SUGGEST_LIMIT` TV-show suggestions for `query` (mirror of
 * `suggestMovies` over the `tv_shows` catalog + TMDB `/search/tv`). Every result
 * carries `mediaType: 'tv'` so the card routes to the TV detail page.
 */
export async function suggestTvShows(
    query: string,
    deps: SuggestDeps = tvDeps(),
): Promise<MovieResult[]> {
    return gatherSuggestions(query, deps)
}

/**
 * The grouped multi-suggest payload — movies and TV shows in one call, each an
 * independent deduped/capped list. Runs both blends in parallel; a failure in
 * either group degrades that group to `[]` (handled inside `gatherSuggestions`).
 */
export async function suggestAll(
    query: string,
    deps: { movies?: SuggestDeps; tv?: SuggestDeps } = {},
): Promise<GroupedSuggestions> {
    const [movieResults, tvResults] = await Promise.all([
        suggestMovies(query, deps.movies ?? movieDeps()),
        suggestTvShows(query, deps.tv ?? tvDeps()),
    ])
    return { movies: movieResults, tv: tvResults }
}
