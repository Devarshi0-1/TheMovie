import type { MovieDetailView, MovieResult } from '@themovie/schemas'

// Maps TMDB's raw snake_case payloads onto the shared camelCase display schemas
// (DL-10). This used to live in the frontend, which forced every consumer of the
// movie endpoints to re-map raw TMDB data; the proxy is the right place for it,
// so the API now speaks `MovieResult` / `MovieDetailView` and the frontend just
// validates. Fields are read defensively because TMDB omits/nulls many of them.

// TMDB's movie-genre list is a small, stable lookup. The list/search endpoints
// only return numeric `genre_ids`, so we resolve them to names here rather than
// making an extra round-trip per movie.
export const TMDB_MOVIE_GENRES: Record<number, string> = {
    28: 'Action',
    12: 'Adventure',
    16: 'Animation',
    35: 'Comedy',
    80: 'Crime',
    99: 'Documentary',
    18: 'Drama',
    10751: 'Family',
    14: 'Fantasy',
    36: 'History',
    27: 'Horror',
    10402: 'Music',
    9648: 'Mystery',
    10749: 'Romance',
    878: 'Science Fiction',
    10770: 'TV Movie',
    53: 'Thriller',
    10752: 'War',
    37: 'Western',
}

/** Resolve TMDB genre ids to names, silently dropping any unknown id. */
export function genreNames(ids: number[] | null | undefined): string[] {
    if (!ids) return []
    return ids.map((id) => TMDB_MOVIE_GENRES[id]).filter((name): name is string => Boolean(name))
}

// Structural shapes of the raw TMDB items we read — kept local (rather than the
// huge generated path types) so the mappers depend only on the fields they use.
interface TmdbListItemLike {
    id?: number
    title?: string | null
    overview?: string | null
    release_date?: string | null
    poster_path?: string | null
    genre_ids?: number[] | null
}

interface TmdbDetailLike extends TmdbListItemLike {
    backdrop_path?: string | null
    genres?: { id?: number; name?: string }[] | null
    runtime?: number | null
    tagline?: string | null
    vote_average?: number | null
}

/**
 * A TMDB list/search item → the compact `MovieResult`. Returns null for an item
 * with no numeric id (malformed/partial) so the caller can drop it rather than
 * emit a movie with a bogus id.
 */
export function toMovieResult(raw: TmdbListItemLike): MovieResult | null {
    if (typeof raw.id !== 'number') return null
    return {
        tmdbId: raw.id,
        title: raw.title ?? 'Untitled',
        overview: raw.overview ?? null,
        releaseDate: raw.release_date ?? null,
        genres: genreNames(raw.genre_ids),
        posterPath: raw.poster_path ?? null,
    }
}

/** Map a raw TMDB list/search payload to display movies, dropping id-less items. */
export function toMovieResults(raw: TmdbListItemLike[]): MovieResult[] {
    return raw.map(toMovieResult).filter((m): m is MovieResult => m !== null)
}

/**
 * A full TMDB details payload → the detail view model. `fallbackId` is the
 * validated route id, used when TMDB's body omits its own id (it shouldn't, but
 * the response shape allows it). The details endpoint returns genres as
 * `{ id, name }[]`, so names come straight through (no id lookup needed).
 */
export function toMovieDetailView(raw: TmdbDetailLike, fallbackId: number): MovieDetailView {
    return {
        tmdbId: typeof raw.id === 'number' ? raw.id : fallbackId,
        title: raw.title ?? 'Untitled',
        overview: raw.overview ?? null,
        releaseDate: raw.release_date ?? null,
        genres: (raw.genres ?? [])
            .map((g) => g.name)
            .filter((name): name is string => Boolean(name)),
        posterPath: raw.poster_path ?? null,
        backdropPath: raw.backdrop_path ?? null,
        tagline: raw.tagline ?? null,
        runtime: raw.runtime ?? null,
        voteAverage: raw.vote_average ?? null,
    }
}
