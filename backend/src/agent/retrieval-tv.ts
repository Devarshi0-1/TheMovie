import { and, cosineDistance, ilike, isNotNull, like, sql } from 'drizzle-orm'
import { db } from '../db'
import { tvShows } from '../db/schema'
import { embedText } from '../lib/embeddings'
import { ingestTvShows } from '../jobs/ingest-tv'
import {
    getTvForIngest,
    getTrendingTv,
    searchTv,
    type TvForIngest,
    type TvListItem,
} from '../lib/tmdb'
import type {
    FetchFromTmdbInput,
    MovieResult,
    ScoredMovieResult,
    SemanticSearchInput,
    SqlSearchInput,
    TrendingInput,
} from '@themovie/schemas'
import {
    aboveFloor,
    escapeLike,
    fuseByReciprocalRank,
    rowToMovieResult,
    type SemanticSearchField,
} from './retrieval'

// The TV counterpart of `retrieval.ts` (Phase 10). Identical retrieval tiers —
// SQL filter, semantic kNN (plot/reception/both via RRF), TMDB write-back — but
// over the `tv_shows` table. Results map onto the SAME shared `MovieResult`
// shape (TV's `name`/`first_air_date` were normalized to title/releaseDate at
// ingest), so the agent and UI treat shows and films uniformly. The generic RRF
// fusion + row mapper are reused from the movie module; only the table differs.

// ── TMDB payload → MovieResult mappers (TV uses name/first_air_date) ──────────

function detailGenres(detail: TvForIngest): string[] {
    return (detail.genres ?? [])
        .map((g) => g?.name)
        .filter((n): n is string => typeof n === 'string' && n.length > 0)
}

function detailToMovieResult(detail: TvForIngest): MovieResult {
    return {
        tmdbId: detail.id ?? 0,
        title: detail.name ?? '',
        overview: detail.overview ?? null,
        releaseDate: detail.first_air_date || null,
        genres: detailGenres(detail),
        posterPath: detail.poster_path ?? null,
    }
}

function listItemToMovieResult(item: TvListItem): MovieResult {
    return {
        tmdbId: item.id ?? 0,
        title: item.name ?? '',
        overview: item.overview ?? null,
        releaseDate: item.first_air_date || null,
        genres: [], // list endpoints only carry genre_ids, not names
        posterPath: item.poster_path ?? null,
    }
}

// ── Injectable IO seams ──────────────────────────────────────────────────────

export interface TvRetrievalDeps {
    sqlSearch: (filters: SqlSearchInput) => Promise<MovieResult[]>
    embedQuery: (text: string) => Promise<number[]>
    knnSearch: (
        vector: number[],
        limit: number,
        field: SemanticSearchField,
    ) => Promise<ScoredMovieResult[]>
    tmdbSearchIds: (query: string) => Promise<number[]>
    tmdbDetail: (tmdbId: number) => Promise<TvForIngest>
    writeBack: (details: TvForIngest[]) => Promise<void>
    tmdbTrending: () => Promise<MovieResult[]>
}

const TV_COLUMNS = {
    tmdbId: tvShows.tmdbId,
    title: tvShows.title,
    overview: tvShows.overview,
    releaseDate: tvShows.releaseDate,
    genres: tvShows.genres,
    posterPath: tvShows.posterPath,
} as const

function defaultDeps(): TvRetrievalDeps {
    return {
        async sqlSearch(filters) {
            const conditions = []
            if (filters.title)
                conditions.push(ilike(tvShows.title, `%${escapeLike(filters.title)}%`))
            if (filters.year) conditions.push(like(tvShows.releaseDate, `${filters.year}%`))
            // jsonb array membership — GIN-indexable, same binding as movies.
            if (filters.genre) conditions.push(sql`${tvShows.genres} ? ${filters.genre}`)

            const rows = await db
                .select(TV_COLUMNS)
                .from(tvShows)
                .where(conditions.length ? and(...conditions) : undefined)
                .limit(filters.limit)
            return rows.map(rowToMovieResult)
        },

        embedQuery: (text) => embedText(text),

        async knnSearch(vector, limit, field) {
            const column =
                field === 'reception' ? tvShows.reviewSummaryEmbedding : tvShows.embedding
            const distance = cosineDistance(column, vector)
            const rows = await db
                .select({ ...TV_COLUMNS, similarity: sql<number>`1 - (${distance})` })
                .from(tvShows)
                .where(isNotNull(column))
                .orderBy(distance)
                .limit(limit)
            return rows.map((r) => ({ ...rowToMovieResult(r), similarity: r.similarity }))
        },

        async tmdbSearchIds(query) {
            const results = await searchTv(query)
            return (results ?? [])
                .map((r) => r.id)
                .filter((id): id is number => typeof id === 'number')
        },

        tmdbDetail: (tmdbId) => getTvForIngest(tmdbId),

        async writeBack(details) {
            await ingestTvShows(details)
        },

        async tmdbTrending() {
            const results = await getTrendingTv()
            return results.map(listItemToMovieResult)
        },
    }
}

// ── Retrieval tiers ──────────────────────────────────────────────────────────

/** Tier 1 — structured/exact lookup. Returns [] if no filter was provided. */
export async function searchTvSql(
    input: SqlSearchInput,
    deps: TvRetrievalDeps = defaultDeps(),
): Promise<MovieResult[]> {
    if (!input.title && !input.genre && input.year === undefined) return []
    return deps.sqlSearch(input)
}

/**
 * Tier 2 — conceptual/thematic search via query embedding + pgvector kNN over
 * the TV catalog. `mode` selects the signal: 'plot', 'reception', or 'both'
 * (fuse two index-accelerated kNN by reciprocal-rank fusion).
 */
export async function semanticSearchTv(
    input: SemanticSearchInput,
    deps: TvRetrievalDeps = defaultDeps(),
): Promise<ScoredMovieResult[]> {
    const vector = await deps.embedQuery(input.query)
    const mode = input.mode ?? 'both'

    if (mode === 'plot') return aboveFloor(await deps.knnSearch(vector, input.limit, 'plot'))
    if (mode === 'reception')
        return aboveFloor(await deps.knnSearch(vector, input.limit, 'reception'))

    const pool = Math.min(20, input.limit * 2)
    const [plot, reception] = await Promise.all([
        deps.knnSearch(vector, pool, 'plot'),
        deps.knnSearch(vector, pool, 'reception'),
    ])
    return fuseByReciprocalRank([aboveFloor(plot), aboveFloor(reception)], input.limit)
}

/** Tier 3 — last-resort TMDB lookup; writes back so the TV catalog self-heals. */
export async function fetchTvFromTmdb(
    input: FetchFromTmdbInput,
    deps: TvRetrievalDeps = defaultDeps(),
): Promise<MovieResult[]> {
    const hasTmdbId = typeof input.tmdbId === 'number' && input.tmdbId > 0
    const hasQuery = typeof input.query === 'string' && input.query.trim().length > 0
    if (!hasQuery && !hasTmdbId) {
        throw new Error('fetch_tv_from_tmdb requires a query or a tmdbId')
    }

    let details: TvForIngest[]
    if (hasTmdbId) {
        details = [await deps.tmdbDetail(input.tmdbId!)]
    } else {
        const ids = (await deps.tmdbSearchIds(input.query!)).slice(0, input.limit)
        details = await Promise.all(ids.map((id) => deps.tmdbDetail(id)))
    }

    const results = details.map(detailToMovieResult)

    try {
        await deps.writeBack(details)
    } catch (err) {
        console.error('⚠️ fetch_tv_from_tmdb write-back failed:', err)
    }

    return results
}

/** Trending TV shows (wraps the cached TMDB trending service). */
export async function getTrendingTvShows(
    input: TrendingInput,
    deps: TvRetrievalDeps = defaultDeps(),
): Promise<MovieResult[]> {
    const all = await deps.tmdbTrending()
    return all.slice(0, input.limit)
}
