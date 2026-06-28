import type {
    FindMoviesByPersonInput,
    MovieResult,
    SimilarMoviesInput,
    WatchProviders,
    WatchProvidersInput,
} from '@themovie/schemas'
import { toMovieExtrasView, toMovieResult, toTvExtrasView } from '../lib/movieView'
import {
    getMovieExtras,
    getPersonMovieCredits,
    getTvExtras,
    searchPerson,
    type MovieExtrasResponse,
    type PersonMovieCredits,
    type PersonSearchResult,
    type TvExtrasResponse,
} from '../lib/tmdb'

// Auxiliary agent lookups built on the movie-extras + person endpoints (Phase 9):
// "movies starring X", "where can I watch X", and "more like X". IO is behind
// injectable `deps` so each is unit-tested without a live TMDB. The tool()
// wrappers in tools.ts are thin shells over these.

// ── find_movies_by_person ────────────────────────────────────────────────────

// A filmography credit carries list-item fields plus a popularity score we sort
// by; `toMovieResult` reads the shared subset (genre_ids → names, etc.).
type CreditItem = {
    id?: number
    title?: string | null
    overview?: string | null
    release_date?: string | null
    poster_path?: string | null
    genre_ids?: number[] | null
    popularity?: number | null
}

export interface PersonLookupDeps {
    searchPerson: (name: string) => Promise<PersonSearchResult[]>
    personMovieCredits: (personId: number) => Promise<PersonMovieCredits>
}

function defaultPersonDeps(): PersonLookupDeps {
    return {
        searchPerson: (name) => searchPerson(name),
        personMovieCredits: (personId) => getPersonMovieCredits(personId),
    }
}

/**
 * "Movies starring / directed by X." Resolve the best-matching person by name,
 * then return their most notable movies (acting + directing credits, deduped by
 * tmdbId, ranked by TMDB popularity). Returns [] when no person matches.
 */
export async function findMoviesByPerson(
    input: FindMoviesByPersonInput,
    deps: PersonLookupDeps = defaultPersonDeps(),
): Promise<MovieResult[]> {
    const people = await deps.searchPerson(input.name)
    // TMDB returns people ranked by relevance; take the first with a usable id.
    const top = people.find(
        (p): p is PersonSearchResult & { id: number } => typeof p.id === 'number',
    )
    if (!top) return []

    const credits = await deps.personMovieCredits(top.id)
    // Combine the roles they acted in with the films they directed/wrote, so a
    // query about a director surfaces their filmography, not just cameo roles.
    const cast = (credits.cast ?? []) as CreditItem[]
    const crew = (credits.crew ?? []) as CreditItem[]

    // Dedupe by tmdbId, keeping the highest popularity seen for each film.
    const byId = new Map<number, CreditItem>()
    for (const item of [...cast, ...crew]) {
        if (typeof item.id !== 'number') continue
        const existing = byId.get(item.id)
        if (!existing || (item.popularity ?? 0) > (existing.popularity ?? 0)) {
            byId.set(item.id, item)
        }
    }

    return [...byId.values()]
        .sort((a, b) => (b.popularity ?? 0) - (a.popularity ?? 0))
        .slice(0, input.limit)
        .map(toMovieResult)
        .filter((m): m is MovieResult => m !== null)
}

// ── get_watch_providers ──────────────────────────────────────────────────────

export interface ExtrasLookupDeps {
    movieExtras: (tmdbId: string) => Promise<MovieExtrasResponse>
}

function defaultExtrasDeps(): ExtrasLookupDeps {
    return { movieExtras: (tmdbId) => getMovieExtras(tmdbId) }
}

/** Where-to-watch (stream/rent/buy) for a movie in a region. Null when none. */
export async function getWatchProviders(
    input: WatchProvidersInput,
    deps: ExtrasLookupDeps = defaultExtrasDeps(),
): Promise<WatchProviders | null> {
    const region = (input.region ?? 'US').toUpperCase()
    const extras = await deps.movieExtras(String(input.tmdbId))
    return toMovieExtrasView(extras, region).watchProviders
}

/** TMDB-graph recommendations for a movie ("more like this"). */
export async function findSimilarMovies(
    input: SimilarMoviesInput,
    deps: ExtrasLookupDeps = defaultExtrasDeps(),
): Promise<MovieResult[]> {
    const extras = await deps.movieExtras(String(input.tmdbId))
    return toMovieExtrasView(extras).recommendations.slice(0, input.limit)
}

// ── find_similar_tv ──────────────────────────────────────────────────────────
// The TV twin of find_similar_movies. TMDB's curated recommendation graph is far
// better than free-form embedding search for "shows like <a specific title>",
// and it isn't bounded by our local catalog. Recommendations already arrive in
// the TV-extras append_to_response; `toTvExtrasView` maps them via `toTvResults`,
// which stamps `mediaType: 'tv'` so cards route to /tv/:id.

export interface TvExtrasLookupDeps {
    tvExtras: (tvId: string) => Promise<TvExtrasResponse>
}

function defaultTvExtrasDeps(): TvExtrasLookupDeps {
    return { tvExtras: (tvId) => getTvExtras(tvId) }
}

/** TMDB-graph recommendations for a TV show ("more like this"). */
export async function findSimilarTv(
    input: SimilarMoviesInput,
    deps: TvExtrasLookupDeps = defaultTvExtrasDeps(),
): Promise<MovieResult[]> {
    const extras = await deps.tvExtras(String(input.tmdbId))
    return toTvExtrasView(extras).recommendations.slice(0, input.limit)
}
