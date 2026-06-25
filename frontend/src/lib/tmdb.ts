import type { MovieDetailsResult, MovieResult } from '@themovie/schemas'
import { z } from 'zod'

// The movie endpoints (`/api/v1/movies/...`) proxy TMDB and return TMDB's raw
// snake_case shapes — NOT the camelCase `MovieResult` the agent tools use. This
// module is the boundary that validates those raw payloads and maps them onto
// the shared display schemas, so the rest of the UI only ever sees `MovieResult`
// / `MovieDetailsResult`. Fields are liberally `.nullish()` because TMDB omits
// or nulls many of them depending on the title.

export const TmdbListItemSchema = z.object({
    id: z.number(),
    title: z.string().nullish(),
    overview: z.string().nullish(),
    release_date: z.string().nullish(),
    poster_path: z.string().nullish(),
    genre_ids: z.array(z.number()).nullish(),
    vote_average: z.number().nullish(),
})
export type TmdbListItem = z.infer<typeof TmdbListItemSchema>

export const TmdbListSchema = z.array(TmdbListItemSchema)

const TmdbGenreSchema = z.object({ id: z.number(), name: z.string() })

export const TmdbDetailsSchema = z.object({
    id: z.number(),
    title: z.string().nullish(),
    overview: z.string().nullish(),
    release_date: z.string().nullish(),
    poster_path: z.string().nullish(),
    backdrop_path: z.string().nullish(),
    genres: z.array(TmdbGenreSchema).nullish(),
    runtime: z.number().nullish(),
    tagline: z.string().nullish(),
    vote_average: z.number().nullish(),
})
export type TmdbDetails = z.infer<typeof TmdbDetailsSchema>

// TMDB's movie genre list is a small, stable lookup. The list/search endpoints
// only return numeric `genre_ids`, so we resolve them to names client-side for
// the genre chips rather than making an extra round-trip per card.
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

/** A TMDB list/search item → the shared compact `MovieResult` display shape. */
export function toMovieResult(raw: TmdbListItem): MovieResult {
    return {
        tmdbId: raw.id,
        title: raw.title ?? 'Untitled',
        overview: raw.overview ?? null,
        releaseDate: raw.release_date ?? null,
        genres: genreNames(raw.genre_ids),
        posterPath: raw.poster_path ?? null,
    }
}

/** Validate a raw TMDB list/search payload and map it to display movies. */
export function parseMovieList(input: unknown): MovieResult[] {
    return TmdbListSchema.parse(input).map(toMovieResult)
}

/** Detail view model: the shared detail schema plus a backdrop for the hero. */
export type DetailMovie = MovieDetailsResult & { backdropPath: string | null }

/** A full TMDB movie-details payload → the detail view model. */
export function toMovieDetails(raw: TmdbDetails): DetailMovie {
    return {
        tmdbId: raw.id,
        title: raw.title ?? 'Untitled',
        overview: raw.overview ?? null,
        releaseDate: raw.release_date ?? null,
        genres: (raw.genres ?? []).map((g) => g.name),
        posterPath: raw.poster_path ?? null,
        backdropPath: raw.backdrop_path ?? null,
        tagline: raw.tagline ?? null,
        runtime: raw.runtime ?? null,
        voteAverage: raw.vote_average ?? null,
    }
}

/** Validate a raw TMDB details payload and map it to the detail view model. */
export function parseMovieDetails(input: unknown): DetailMovie {
    return toMovieDetails(TmdbDetailsSchema.parse(input))
}

// TMDB image CDN bases (the API returns only the path segment).
export const TMDB_POSTER_BASE = 'https://image.tmdb.org/t/p/w342'
export const TMDB_BACKDROP_BASE = 'https://image.tmdb.org/t/p/w1280'

/** A human runtime label ("2h 28m"), or null when TMDB has no runtime. */
export function formatRuntime(minutes: number | null): string | null {
    if (!minutes || minutes <= 0) return null
    const hours = Math.floor(minutes / 60)
    const mins = minutes % 60
    return hours > 0 ? `${hours}h ${mins}m` : `${mins}m`
}
