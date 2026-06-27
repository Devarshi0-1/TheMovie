import { describe, expect, it } from 'bun:test'
import {
    fetchFromTmdb,
    genreContains,
    getMovieDetails,
    getTrending,
    searchMoviesSql,
    semanticSearchMovies,
    type RetrievalDeps,
} from './retrieval'
import { db } from '../db'
import { movies } from '../db/schema'
import type { MovieForIngest } from '../lib/tmdb'
import { SemanticSearchInputSchema, type ScoredMovieResult } from '@themovie/schemas'

describe('genreContains (genre filter binds a jsonb membership test, not a string scalar)', () => {
    it('binds the bare genre name and never the double-encoded array string (regression)', () => {
        const { sql, params } = db.select().from(movies).where(genreContains('Action')).toSQL()
        // The bare genre is bound as a parameter…
        expect(params).toContain('Action')
        // …NOT the `JSON.stringify([genre])` form that the old `@> $1::jsonb`
        // filter bound, which Postgres parsed into a jsonb *string scalar* so the
        // containment matched nothing.
        expect(params).not.toContain('["Action"]')
        expect(sql).not.toContain('::jsonb')
    })
})

const detail = (over: Partial<MovieForIngest> = {}): MovieForIngest =>
    ({
        id: 27205,
        title: 'Inception',
        overview: 'A thief steals secrets through dreams.',
        release_date: '2010-07-16',
        poster_path: '/p.jpg',
        genres: [{ id: 878, name: 'Science Fiction' }],
        runtime: 148,
        vote_average: 8.4,
        tagline: 'Your mind is the scene of the crime.',
        keywords: { keywords: [{ id: 1, name: 'dream' }] },
        ...over,
    }) as MovieForIngest

// Fake deps that record calls; override individual seams per test.
const fakeDeps = (over: Partial<RetrievalDeps> = {}) => {
    const calls = {
        sqlSearch: [] as unknown[],
        embedQuery: [] as string[],
        knnSearch: [] as { vector: number[]; limit: number; field: string }[],
        tmdbSearchIds: [] as string[],
        tmdbDetail: [] as number[],
        writeBack: [] as MovieForIngest[][],
        tmdbTrending: 0,
    }
    const deps: RetrievalDeps = {
        async sqlSearch(f) {
            calls.sqlSearch.push(f)
            return []
        },
        async embedQuery(t) {
            calls.embedQuery.push(t)
            return [0.1, 0.2, 0.3]
        },
        async knnSearch(vector, limit, field) {
            calls.knnSearch.push({ vector, limit, field })
            return []
        },
        async tmdbSearchIds(q) {
            calls.tmdbSearchIds.push(q)
            return []
        },
        async tmdbDetail(id) {
            calls.tmdbDetail.push(id)
            return detail({ id })
        },
        async writeBack(d) {
            calls.writeBack.push(d)
        },
        async tmdbTrending() {
            calls.tmdbTrending++
            return []
        },
        ...over,
    }
    return { deps, calls }
}

// ── searchMoviesSql ──────────────────────────────────────────────────────────
describe('searchMoviesSql', () => {
    it('returns [] and skips the DB when no filter is given (edge: cost)', async () => {
        const { deps, calls } = fakeDeps()
        const out = await searchMoviesSql({ limit: 10 }, deps)
        expect(out).toEqual([])
        expect(calls.sqlSearch).toHaveLength(0)
    })

    it('passes filters through to the DB search (feature)', async () => {
        const result = [
            {
                tmdbId: 1,
                title: 'Dune',
                overview: null,
                releaseDate: '2021',
                genres: ['Sci-Fi'],
                posterPath: null,
            },
        ]
        const { deps, calls } = fakeDeps({ sqlSearch: async () => result })
        const out = await searchMoviesSql({ title: 'Dune', year: 2021, limit: 5 }, deps)
        expect(out).toEqual(result)
        expect(calls.sqlSearch).toHaveLength(0) // overridden impl doesn't record
    })

    it('runs the DB search when only a genre is given (edge)', async () => {
        const { deps, calls } = fakeDeps()
        await searchMoviesSql({ genre: 'Horror', limit: 10 }, deps)
        expect(calls.sqlSearch).toHaveLength(1)
    })
})

// ── semanticSearchMovies ─────────────────────────────────────────────────────
const scoredMovie = (tmdbId: number, similarity: number): ScoredMovieResult => ({
    tmdbId,
    title: `Movie ${tmdbId}`,
    overview: null,
    releaseDate: null,
    genres: [],
    posterPath: null,
    similarity,
})

describe('semanticSearchMovies', () => {
    it("mode 'plot' embeds the query and runs a single plot-vector kNN (feature)", async () => {
        const scored = [scoredMovie(1, 0.9)]
        const seen: { vector: number[]; limit: number; field: string }[] = []
        const { deps, calls } = fakeDeps({
            knnSearch: async (vector, limit, field) => {
                seen.push({ vector, limit, field })
                return scored
            },
        })
        const out = await semanticSearchMovies(
            { query: 'hero becomes villain', limit: 6, mode: 'plot' },
            deps,
        )
        expect(calls.embedQuery).toEqual(['hero becomes villain'])
        expect(seen).toEqual([{ vector: [0.1, 0.2, 0.3], limit: 6, field: 'plot' }])
        expect(out).toEqual(scored)
    })

    it("mode 'reception' runs a single reception-vector kNN (feature: audience search)", async () => {
        const { deps, calls } = fakeDeps()
        await semanticSearchMovies(
            { query: 'genuinely terrifying', limit: 5, mode: 'reception' },
            deps,
        )
        expect(calls.knnSearch).toHaveLength(1)
        expect(calls.knnSearch[0].field).toBe('reception')
    })

    it("mode 'both' (default) queries plot AND reception then fuses by RRF (feature)", async () => {
        // Movie 2 ranks mid in plot but TOP in reception; movie 1 tops plot only.
        // RRF rewards appearing in both rankings.
        const plot = [scoredMovie(1, 0.95), scoredMovie(2, 0.6), scoredMovie(3, 0.55)]
        const reception = [scoredMovie(2, 0.9), scoredMovie(4, 0.8), scoredMovie(1, 0.5)]
        const seen: { limit: number; field: string }[] = []
        const { deps } = fakeDeps({
            knnSearch: async (_vector, limit, field) => {
                seen.push({ limit, field })
                return field === 'plot' ? plot : reception
            },
        })
        // Built through the schema so the real default (mode → 'both') is applied.
        const out = await semanticSearchMovies(
            SemanticSearchInputSchema.parse({ query: 'q', limit: 3 }),
            deps,
        )

        // Both vectors were queried with a candidate pool larger than `limit`.
        expect(seen.map((c) => c.field).sort()).toEqual(['plot', 'reception'])
        expect(seen[0].limit).toBeGreaterThan(3)

        // Movie 2 (high in BOTH) wins; movie 1 (top of plot + present in reception)
        // is second; result is deduped and capped at the limit.
        expect(out).toHaveLength(3)
        expect(out[0].tmdbId).toBe(2)
        expect(out.map((m) => m.tmdbId)).toContain(1)
        // No duplicates across the fused rankings.
        expect(new Set(out.map((m) => m.tmdbId)).size).toBe(out.length)
        // Reported similarity is the best cosine the movie achieved (movie 1: 0.95).
        expect(out.find((m) => m.tmdbId === 1)?.similarity).toBe(0.95)
    })

    it("mode 'both' tolerates an empty reception ranking (edge: no summaries embedded yet)", async () => {
        const plot = [scoredMovie(1, 0.9), scoredMovie(2, 0.8)]
        const { deps } = fakeDeps({
            knnSearch: async (_v, _l, field) => (field === 'plot' ? plot : []),
        })
        const out = await semanticSearchMovies(
            SemanticSearchInputSchema.parse({ query: 'q', limit: 5 }),
            deps,
        )
        expect(out.map((m) => m.tmdbId)).toEqual([1, 2]) // degrades to plot-only ranking
    })
})

// ── fetchFromTmdb ────────────────────────────────────────────────────────────
describe('fetchFromTmdb', () => {
    it('fetches a specific tmdbId and writes it back (feature: self-heal)', async () => {
        const { deps, calls } = fakeDeps()
        const out = await fetchFromTmdb({ tmdbId: 27205, limit: 3 }, deps)
        expect(calls.tmdbDetail).toEqual([27205])
        expect(out[0].title).toBe('Inception')
        expect(out[0].genres).toEqual(['Science Fiction'])
        expect(calls.writeBack).toHaveLength(1)
        expect(calls.writeBack[0][0].id).toBe(27205)
    })

    it('searches by query, capping at limit, then enriches each (feature)', async () => {
        const { deps, calls } = fakeDeps({ tmdbSearchIds: async () => [1, 2, 3, 4, 5] })
        const out = await fetchFromTmdb({ query: 'dune', limit: 2 }, deps)
        expect(calls.tmdbDetail).toEqual([1, 2]) // capped at limit
        expect(out).toHaveLength(2)
        expect(calls.writeBack).toHaveLength(1)
    })

    it('throws when neither query nor tmdbId is provided (edge)', async () => {
        const { deps } = fakeDeps()
        expect(fetchFromTmdb({ limit: 3 }, deps)).rejects.toThrow(/query or a tmdbId/)
    })

    it('uses the query path when tmdbId is a 0 placeholder (regression)', async () => {
        // gpt-5 frequently fills the optional `tmdbId` with `0` alongside a real
        // query. `0` must NOT be treated as a real id (fetching movie id 0 is a
        // 404); the query path must win.
        const { deps, calls } = fakeDeps({ tmdbSearchIds: async () => [41428] })
        const out = await fetchFromTmdb(
            { query: 'Tetsuo: The Iron Man', tmdbId: 0, limit: 3 },
            deps,
        )
        // tmdbDetail is reached via the search path with the searched id, never 0.
        expect(calls.tmdbDetail).toEqual([41428])
        expect(out).toHaveLength(1)
    })

    it('throws when tmdbId is 0 and no query is given (edge)', async () => {
        const { deps } = fakeDeps()
        expect(fetchFromTmdb({ tmdbId: 0, limit: 3 }, deps)).rejects.toThrow(/query or a tmdbId/)
    })

    it('still returns results when write-back fails (edge: best-effort)', async () => {
        const { deps } = fakeDeps({
            writeBack: async () => {
                throw new Error('embed boom')
            },
        })
        const out = await fetchFromTmdb({ tmdbId: 27205, limit: 3 }, deps)
        expect(out[0].title).toBe('Inception')
    })
})

// ── getMovieDetails ──────────────────────────────────────────────────────────
describe('getMovieDetails', () => {
    it('maps full details including tagline/runtime/rating (feature)', async () => {
        const { deps } = fakeDeps()
        const out = await getMovieDetails({ tmdbId: 27205 }, deps)
        expect(out.runtime).toBe(148)
        expect(out.voteAverage).toBe(8.4)
        expect(out.tagline).toBe('Your mind is the scene of the crime.')
        expect(out.genres).toEqual(['Science Fiction'])
    })
})

// ── getTrending ──────────────────────────────────────────────────────────────
describe('getTrending', () => {
    it('caps the trending list at the requested limit (feature)', async () => {
        const many = Array.from({ length: 10 }, (_, i) => ({
            tmdbId: i,
            title: `m${i}`,
            overview: null,
            releaseDate: null,
            genres: [],
            posterPath: null,
        }))
        const { deps } = fakeDeps({ tmdbTrending: async () => many })
        const out = await getTrending({ limit: 3 }, deps)
        expect(out).toHaveLength(3)
    })
})
