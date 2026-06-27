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
} from '@themovie/schemas'

// The three retrieval tiers + details/trending, as plain functions with all IO
// behind injectable `deps` so each is unit-tested without a live DB / OpenAI /
// TMDB. The `tool()` wrappers in `tools.ts` are thin shells over these.

// ── Mapping helpers (DB rows / TMDB payloads → MovieResult) ──────────────────

// genres are stored as a jsonb string[] by the ingestion pipeline.
function asStringArray(value: unknown): string[] {
    return Array.isArray(value) ? value.filter((v): v is string => typeof v === 'string') : []
}

// Escape LIKE/ILIKE metacharacters so a user-supplied title is matched as a
// literal substring. Without this, a `%` or `_` in the query acts as a wildcard
// (e.g. "50% off" would match far more than intended). The value is still
// parameter-bound by Drizzle — this is a search-semantics fix, not injection.
// Backslash is Postgres LIKE's default escape char, so escape it first.
export function escapeLike(value: string): string {
    return value.replace(/[\\%_]/g, (ch) => `\\${ch}`)
}

/**
 * SQL predicate: the stored `genres` jsonb array contains `genre` as an element.
 *
 * `?` binds the bare genre name as a text param and tests array membership
 * directly (GIN-indexable via the genres index). Do NOT revert to
 * `@> ${JSON.stringify([genre])}::jsonb`: bun-sql binds the JS string
 * `'["Action"]'` as a parameter, which `::jsonb` parses into a jsonb *string
 * scalar* (`"[\"Action\"]"`, jsonb_typeof = string), so `array @> string`
 * silently matches NOTHING — the exact bug this replaces.
 */
export function genreContains(genre: string) {
    return sql`${movies.genres} ? ${genre}`
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

// Which embedding column a kNN runs against: the plot vector (title/overview/
// genre) or the audience-reception vector (review-summary). 'both' is handled a
// level up by fusing two single-field rankings.
export type SemanticSearchField = 'plot' | 'reception'

export interface RetrievalDeps {
    sqlSearch: (filters: SqlSearchInput) => Promise<MovieResult[]>
    embedQuery: (text: string) => Promise<number[]>
    knnSearch: (
        vector: number[],
        limit: number,
        field: SemanticSearchField,
    ) => Promise<ScoredMovieResult[]>
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
            if (filters.title)
                conditions.push(ilike(movies.title, `%${escapeLike(filters.title)}%`))
            if (filters.year) conditions.push(like(movies.releaseDate, `${filters.year}%`))
            if (filters.genre) conditions.push(genreContains(filters.genre))

            const rows = await db
                .select(MOVIE_COLUMNS)
                .from(movies)
                .where(conditions.length ? and(...conditions) : undefined)
                .limit(filters.limit)
            return rows.map(rowToMovieResult)
        },

        embedQuery: (text) => embedText(text),

        async knnSearch(vector, limit, field) {
            // Pick the vector column for this field. Both live in the same
            // embedding space (text-embedding-3-small), so a query embedding can
            // be compared against either; rows with a NULL vector are excluded so
            // the HNSW index isn't asked to rank missing values.
            const column = field === 'reception' ? movies.reviewSummaryEmbedding : movies.embedding
            // Cosine distance over the HNSW index; ascending distance = closest
            // first. similarity = 1 - distance, in [-1, 1] in general (≈[0, 1]
            // for these normalized text-embedding-3-small vectors).
            const distance = cosineDistance(column, vector)
            const rows = await db
                .select({ ...MOVIE_COLUMNS, similarity: sql<number>`1 - (${distance})` })
                .from(movies)
                .where(isNotNull(column))
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

// Reciprocal-rank-fusion damping constant (the standard k=60). Larger k flattens
// the contribution gap between ranks; 60 is the well-established default.
const RRF_K = 60

/**
 * Fuse several rankings of the same items into one, by reciprocal rank: each
 * ranking contributes 1/(k + rank) to an item's score, so an item ranked highly
 * by BOTH the plot and reception vectors floats to the top. Items are deduped by
 * tmdbId; the reported `similarity` is the best (max) cosine an item achieved in
 * any ranking (kept meaningful), while ORDER follows the fused score.
 */
function fuseByReciprocalRank(rankings: ScoredMovieResult[][], limit: number): ScoredMovieResult[] {
    const acc = new Map<number, { movie: ScoredMovieResult; rrf: number; bestSim: number }>()
    for (const ranking of rankings) {
        ranking.forEach((movie, idx) => {
            const contribution = 1 / (RRF_K + idx + 1) // idx is 0-based → rank = idx+1
            const existing = acc.get(movie.tmdbId)
            if (existing) {
                existing.rrf += contribution
                existing.bestSim = Math.max(existing.bestSim, movie.similarity)
            } else {
                acc.set(movie.tmdbId, { movie, rrf: contribution, bestSim: movie.similarity })
            }
        })
    }
    return [...acc.values()]
        .sort((a, b) => b.rrf - a.rrf)
        .slice(0, limit)
        .map(({ movie, bestSim }) => ({ ...movie, similarity: bestSim }))
}

/**
 * Tier 2 — conceptual/thematic search via query embedding + pgvector kNN.
 * `mode` selects the signal: 'plot' (what the film is about), 'reception' (how
 * audiences received it), or 'both' (fuse two index-accelerated kNN by RRF).
 */
export async function semanticSearchMovies(
    input: SemanticSearchInput,
    deps: RetrievalDeps = defaultDeps(),
): Promise<ScoredMovieResult[]> {
    const vector = await deps.embedQuery(input.query)
    const mode = input.mode ?? 'both'

    if (mode === 'plot') return deps.knnSearch(vector, input.limit, 'plot')
    if (mode === 'reception') return deps.knnSearch(vector, input.limit, 'reception')

    // 'both': pull a candidate pool from each vector (more than `limit` so the
    // fusion has material to re-rank), then merge by reciprocal rank.
    const pool = Math.min(20, input.limit * 2)
    const [plot, reception] = await Promise.all([
        deps.knnSearch(vector, pool, 'plot'),
        deps.knnSearch(vector, pool, 'reception'),
    ])
    return fuseByReciprocalRank([plot, reception], input.limit)
}

/** Tier 3 — last-resort TMDB lookup; writes back so the catalog self-heals. */
export async function fetchFromTmdb(
    input: FetchFromTmdbInput,
    deps: RetrievalDeps = defaultDeps(),
): Promise<MovieResult[]> {
    // A TMDB id counts as "provided" only when it's a positive integer. The model
    // often fills the optional `tmdbId` with a `0` placeholder alongside a
    // real `query`; treating `0` as a valid id (it `!== undefined`) would fetch the
    // non-existent movie id 0 (404) and ignore the query. Require > 0 so the query
    // path wins in that case.
    const hasTmdbId = typeof input.tmdbId === 'number' && input.tmdbId > 0
    const hasQuery = typeof input.query === 'string' && input.query.trim().length > 0
    if (!hasQuery && !hasTmdbId) {
        throw new Error('fetch_from_tmdb requires a query or a tmdbId')
    }

    let details: MovieForIngest[]
    if (hasTmdbId) {
        details = [await deps.tmdbDetail(input.tmdbId!)]
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
