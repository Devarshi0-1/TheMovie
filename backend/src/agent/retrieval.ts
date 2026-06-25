import { and, cosineDistance, ilike, isNotNull, like, sql } from 'drizzle-orm'
import { db } from '../db'
import { movies } from '../db/schema'
import { embedText } from '../lib/embeddings'
import { ingestMovies } from '../jobs/ingest'
import {
    getMovieForIngest,
    getTrendingMovies,
    searchMovie,
    type MovieForIngest,
    type MovieListItem,
} from '../lib/tmdb'
import type {
    FetchFromTmdbInput,
    MovieDetailsInput,
    MovieDetailsResult,
    MovieResult,
    ScoredMovieResult,
    SemanticSearchInput,
    SqlSearchInput,
    TrendingInput,
} from '../schemas/movie'

// The three retrieval tiers + details/trending, as plain functions with all IO
// behind injectable `deps` so each is unit-tested without a live DB / OpenAI /
// TMDB. The `tool()` wrappers in `tools.ts` are thin shells over these.

// ── Mapping helpers (DB rows / TMDB payloads → MovieResult) ──────────────────

// genres are stored as a jsonb string[] by the ingestion pipeline.
function asStringArray(value: unknown): string[] {
    return Array.isArray(value) ? value.filter((v): v is string => typeof v === 'string') : []
}

interface MovieRow {
    tmdbId: number
    title: string
    overview: string | null
    releaseDate: string | null
    genres: unknown
    posterPath: string | null
}

function rowToMovieResult(row: MovieRow): MovieResult {
    return {
        tmdbId: row.tmdbId,
        title: row.title,
        overview: row.overview,
        releaseDate: row.releaseDate,
        genres: asStringArray(row.genres),
        posterPath: row.posterPath,
    }
}

function detailGenres(detail: MovieForIngest): string[] {
    return (detail.genres ?? [])
        .map((g) => g?.name)
        .filter((n): n is string => typeof n === 'string' && n.length > 0)
}

function detailToMovieResult(detail: MovieForIngest): MovieResult {
    return {
        tmdbId: detail.id ?? 0,
        title: detail.title ?? '',
        overview: detail.overview ?? null,
        releaseDate: detail.release_date || null,
        genres: detailGenres(detail),
        posterPath: detail.poster_path ?? null,
    }
}

function detailToDetailsResult(detail: MovieForIngest): MovieDetailsResult {
    return {
        ...detailToMovieResult(detail),
        tagline: detail.tagline || null,
        runtime: detail.runtime ?? null,
        voteAverage: detail.vote_average ?? null,
    }
}

function listItemToMovieResult(item: MovieListItem): MovieResult {
    return {
        tmdbId: item.id ?? 0,
        title: item.title ?? '',
        overview: item.overview ?? null,
        releaseDate: item.release_date || null,
        genres: [], // list endpoints only carry genre_ids, not names
        posterPath: item.poster_path ?? null,
    }
}

// ── Injectable IO seams ──────────────────────────────────────────────────────

export interface RetrievalDeps {
    sqlSearch: (filters: SqlSearchInput) => Promise<MovieResult[]>
    embedQuery: (text: string) => Promise<number[]>
    knnSearch: (vector: number[], limit: number) => Promise<ScoredMovieResult[]>
    tmdbSearchIds: (query: string) => Promise<number[]>
    tmdbDetail: (tmdbId: number) => Promise<MovieForIngest>
    writeBack: (details: MovieForIngest[]) => Promise<void>
    tmdbTrending: () => Promise<MovieResult[]>
}

const MOVIE_COLUMNS = {
    tmdbId: movies.tmdbId,
    title: movies.title,
    overview: movies.overview,
    releaseDate: movies.releaseDate,
    genres: movies.genres,
    posterPath: movies.posterPath,
} as const

function defaultDeps(): RetrievalDeps {
    return {
        async sqlSearch(filters) {
            const conditions = []
            if (filters.title) conditions.push(ilike(movies.title, `%${filters.title}%`))
            if (filters.year) conditions.push(like(movies.releaseDate, `${filters.year}%`))
            if (filters.genre) {
                // jsonb containment against the stored genre-name array.
                conditions.push(sql`${movies.genres} @> ${JSON.stringify([filters.genre])}::jsonb`)
            }

            const rows = await db
                .select(MOVIE_COLUMNS)
                .from(movies)
                .where(conditions.length ? and(...conditions) : undefined)
                .limit(filters.limit)
            return rows.map(rowToMovieResult)
        },

        embedQuery: (text) => embedText(text),

        async knnSearch(vector, limit) {
            // Cosine distance over the HNSW index; ascending distance = closest
            // first. similarity = 1 - distance, in [0, 1].
            const distance = cosineDistance(movies.embedding, vector)
            const rows = await db
                .select({ ...MOVIE_COLUMNS, similarity: sql<number>`1 - (${distance})` })
                .from(movies)
                .where(isNotNull(movies.embedding))
                .orderBy(distance)
                .limit(limit)
            return rows.map((r) => ({ ...rowToMovieResult(r), similarity: r.similarity }))
        },

        async tmdbSearchIds(query) {
            const results = await searchMovie(query)
            return (results ?? [])
                .map((r) => r.id)
                .filter((id): id is number => typeof id === 'number')
        },

        tmdbDetail: (tmdbId) => getMovieForIngest(tmdbId),

        async writeBack(details) {
            await ingestMovies(details)
        },

        async tmdbTrending() {
            const results = await getTrendingMovies()
            return results.map(listItemToMovieResult)
        },
    }
}

// ── Retrieval tiers ──────────────────────────────────────────────────────────

/** Tier 1 — structured/exact lookup. Returns [] if no filter was provided. */
export async function searchMoviesSql(
    input: SqlSearchInput,
    deps: RetrievalDeps = defaultDeps(),
): Promise<MovieResult[]> {
    if (!input.title && !input.genre && input.year === undefined) return []
    return deps.sqlSearch(input)
}

/** Tier 2 — conceptual/thematic search via query embedding + pgvector kNN. */
export async function semanticSearchMovies(
    input: SemanticSearchInput,
    deps: RetrievalDeps = defaultDeps(),
): Promise<ScoredMovieResult[]> {
    const vector = await deps.embedQuery(input.query)
    return deps.knnSearch(vector, input.limit)
}

/** Tier 3 — last-resort TMDB lookup; writes back so the catalog self-heals. */
export async function fetchFromTmdb(
    input: FetchFromTmdbInput,
    deps: RetrievalDeps = defaultDeps(),
): Promise<MovieResult[]> {
    if (!input.query && input.tmdbId === undefined) {
        throw new Error('fetch_from_tmdb requires a query or a tmdbId')
    }

    let details: MovieForIngest[]
    if (input.tmdbId !== undefined) {
        details = [await deps.tmdbDetail(input.tmdbId)]
    } else {
        const ids = (await deps.tmdbSearchIds(input.query!)).slice(0, input.limit)
        details = await Promise.all(ids.map((id) => deps.tmdbDetail(id)))
    }

    const results = details.map(detailToMovieResult)

    // Self-heal: upsert + embed so the next query is served locally. Best-effort
    // — a write-back failure must not fail the user-facing answer.
    try {
        await deps.writeBack(details)
    } catch (err) {
        console.error('⚠️ fetch_from_tmdb write-back failed:', err)
    }

    return results
}

/** Full details for a specific movie (wraps the TMDB detail service). */
export async function getMovieDetails(
    input: MovieDetailsInput,
    deps: RetrievalDeps = defaultDeps(),
): Promise<MovieDetailsResult> {
    const detail = await deps.tmdbDetail(input.tmdbId)
    return detailToDetailsResult(detail)
}

/** Trending movies (wraps the cached TMDB trending service). */
export async function getTrending(
    input: TrendingInput,
    deps: RetrievalDeps = defaultDeps(),
): Promise<MovieResult[]> {
    const all = await deps.tmdbTrending()
    return all.slice(0, input.limit)
}
