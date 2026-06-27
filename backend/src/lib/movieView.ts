import type {
    CastMember,
    MovieDetailView,
    MovieExtras,
    MovieResult,
    MovieVideo,
    WatchProvider,
    WatchProviders,
} from '@themovie/schemas'

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
    backdrop_path?: string | null
    genre_ids?: number[] | null
    vote_average?: number | null
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
        backdropPath: raw.backdrop_path ?? null,
        voteAverage: typeof raw.vote_average === 'number' ? raw.vote_average : null,
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

// ── Movie extras (cast, trailer, where-to-watch, recommendations) ────────────

// Top-billed cast shown on the detail screen; TMDB already returns cast in
// billing order, so we take the first slice and drop any malformed entry.
const CAST_LIMIT = 12
const RECOMMENDATIONS_LIMIT = 12
// Default region for where-to-watch; the route accepts a `?region=` override.
export const DEFAULT_WATCH_REGION = 'US'

type RawVideo = { key?: string; name?: string; site?: string; type?: string; official?: boolean }

/**
 * Pick the single best trailer to embed: prefer YouTube `Trailer`s over teasers,
 * and official over fan-uploaded. Returns null when there's no embeddable video.
 */
export function pickTrailer(videos: RawVideo[] | undefined): MovieVideo | null {
    const youtube = (videos ?? []).filter(
        (v): v is RawVideo & { key: string } =>
            v.site === 'YouTube' && typeof v.key === 'string' && v.key.length > 0,
    )
    if (youtube.length === 0) return null

    const score = (v: RawVideo): number =>
        (v.type === 'Trailer' ? 2
        : v.type === 'Teaser' ? 1
        : 0) + (v.official ? 0.5 : 0)
    const best = youtube.reduce((a, b) => (score(b) > score(a) ? b : a))

    return {
        key: best.key,
        name: best.name ?? 'Trailer',
        site: 'YouTube',
        type: best.type ?? 'Trailer',
    }
}

interface RawProvider {
    provider_id?: number
    provider_name?: string
    logo_path?: string | null
}

interface RawRegionProviders {
    link?: string | null
    flatrate?: RawProvider[]
    rent?: RawProvider[]
    buy?: RawProvider[]
}

const mapProviders = (list: RawProvider[] | undefined): WatchProvider[] =>
    (list ?? [])
        .filter((p) => typeof p.provider_id === 'number' && typeof p.provider_name === 'string')
        .map((p) => ({
            id: p.provider_id as number,
            name: p.provider_name as string,
            logoPath: p.logo_path ?? null,
        }))

/**
 * Where-to-watch for one region. TMDB keys providers by country code; we read
 * the requested region (default US) and return null when that region has no
 * offers at all, so the UI can omit the section rather than render an empty one.
 */
export function toWatchProviders(
    raw: Record<string, RawRegionProviders> | undefined,
    region: string = DEFAULT_WATCH_REGION,
): WatchProviders | null {
    const entry = raw?.[region]
    if (!entry) return null

    const flatrate = mapProviders(entry.flatrate)
    const rent = mapProviders(entry.rent)
    const buy = mapProviders(entry.buy)
    if (flatrate.length === 0 && rent.length === 0 && buy.length === 0) return null

    return { region, link: entry.link ?? null, flatrate, rent, buy }
}

// Structural shape of the append_to_response payload — only the fields the
// mapper reads (kept local, like TmdbDetailLike, rather than the full generated
// detail type which demands `adult`, `budget`, … the mapper never touches).
interface TmdbExtrasLike {
    credits?: {
        cast?: {
            id?: number
            name?: string
            character?: string | null
            profile_path?: string | null
        }[]
        crew?: { name?: string; job?: string }[]
    }
    videos?: { results?: RawVideo[] }
    recommendations?: { results?: TmdbListItemLike[] }
    'watch/providers'?: { results?: Record<string, RawRegionProviders> }
}

/**
 * Map TMDB's append_to_response payload onto the `MovieExtras` view model:
 * top-billed cast, the director, the best trailer, where-to-watch (for `region`),
 * and "more like this" recommendations.
 */
export function toMovieExtrasView(
    raw: TmdbExtrasLike,
    region: string = DEFAULT_WATCH_REGION,
): MovieExtras {
    const cast: CastMember[] = (raw.credits?.cast ?? [])
        .slice(0, CAST_LIMIT)
        .filter((c) => typeof c.id === 'number' && typeof c.name === 'string')
        .map((c) => ({
            id: c.id as number,
            name: c.name as string,
            character: c.character ?? null,
            profilePath: c.profile_path ?? null,
        }))

    const director = (raw.credits?.crew ?? []).find((c) => c.job === 'Director')?.name ?? null

    return {
        cast,
        director,
        trailer: pickTrailer(raw.videos?.results),
        watchProviders: toWatchProviders(raw['watch/providers']?.results, region),
        recommendations: toMovieResults(raw.recommendations?.results ?? []).slice(
            0,
            RECOMMENDATIONS_LIMIT,
        ),
    }
}
