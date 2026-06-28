import { describe, expect, it } from 'bun:test'
import {
    fetchTvFromTmdb,
    getTrendingTvShows,
    searchTvSql,
    semanticSearchTv,
    type TvRetrievalDeps,
} from './retrieval-tv'
import type { TvForIngest } from '../lib/tmdb'
import { SemanticSearchInputSchema, type ScoredMovieResult } from '@themovie/schemas'

const detail = (over: Partial<TvForIngest> = {}): TvForIngest =>
    ({
        id: 1396,
        name: 'Breaking Bad',
        overview: 'A chemistry teacher turns to making meth.',
        first_air_date: '2008-01-20',
        poster_path: '/p.jpg',
        genres: [{ id: 18, name: 'Drama' }],
        keywords: { results: [{ id: 1, name: 'drug empire' }] },
        ...over,
    }) as TvForIngest

const fakeDeps = (over: Partial<TvRetrievalDeps> = {}) => {
    const calls = {
        sqlSearch: [] as unknown[],
        embedQuery: [] as string[],
        knnSearch: [] as { vector: number[]; limit: number; field: string }[],
        tmdbSearchIds: [] as string[],
        tmdbDetail: [] as number[],
        writeBack: [] as TvForIngest[][],
        tmdbTrending: 0,
    }
    const deps: TvRetrievalDeps = {
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

const scoredShow = (tmdbId: number, similarity: number): ScoredMovieResult => ({
    tmdbId,
    title: `Show ${tmdbId}`,
    overview: null,
    releaseDate: null,
    genres: [],
    posterPath: null,
    similarity,
})

// ── searchTvSql ──────────────────────────────────────────────────────────────
describe('searchTvSql', () => {
    it('returns [] and skips the DB when no filter is given (edge: cost)', async () => {
        const { deps, calls } = fakeDeps()
        const out = await searchTvSql({ limit: 10 }, deps)
        expect(out).toEqual([])
        expect(calls.sqlSearch).toHaveLength(0)
    })

    it('runs the DB search when a filter is given (feature)', async () => {
        const { deps, calls } = fakeDeps()
        await searchTvSql({ title: 'Breaking', limit: 10 }, deps)
        expect(calls.sqlSearch).toHaveLength(1)
    })

    it('runs the DB search when only a genre is given (edge)', async () => {
        const { deps, calls } = fakeDeps()
        await searchTvSql({ genre: 'Drama', limit: 10 }, deps)
        expect(calls.sqlSearch).toHaveLength(1)
    })
})

// ── semanticSearchTv ─────────────────────────────────────────────────────────
describe('semanticSearchTv', () => {
    it("mode 'plot' embeds the query and runs a single plot-vector kNN over tv_shows (feature)", async () => {
        const scored = [scoredShow(1, 0.9)]
        const seen: { field: string; limit: number }[] = []
        const { deps, calls } = fakeDeps({
            knnSearch: async (_v, limit, field) => {
                seen.push({ field, limit })
                return scored
            },
        })
        const out = await semanticSearchTv(
            { query: 'a teacher builds a drug empire', limit: 6, mode: 'plot' },
            deps,
        )
        expect(calls.embedQuery).toEqual(['a teacher builds a drug empire'])
        expect(seen).toEqual([{ field: 'plot', limit: 6 }])
        expect(out).toEqual(scored)
    })

    it("mode 'both' (default) queries plot AND reception then fuses by RRF (feature)", async () => {
        // Show 2 ranks mid in plot but TOP in reception; show 1 tops plot only.
        // RRF rewards appearing high in BOTH rankings, so show 2 edges out show 1.
        const plot = [scoredShow(1, 0.95), scoredShow(2, 0.6), scoredShow(3, 0.55)]
        const reception = [scoredShow(2, 0.9), scoredShow(4, 0.8), scoredShow(1, 0.5)]
        const { deps } = fakeDeps({
            knnSearch: async (_v, _l, field) => (field === 'plot' ? plot : reception),
        })
        const out = await semanticSearchTv(
            SemanticSearchInputSchema.parse({ query: 'q', limit: 2 }),
            deps,
        )
        // Show 2 (high in BOTH) wins the fusion; deduped, capped at limit.
        expect(out[0]!.tmdbId).toBe(2)
        expect(out.map((m) => m.tmdbId)).toContain(1)
        expect(new Set(out.map((m) => m.tmdbId)).size).toBe(out.length)
    })

    it("mode 'both' degrades to plot-only when no TV summaries are embedded yet (edge)", async () => {
        const plot = [scoredShow(1, 0.9), scoredShow(2, 0.8)]
        const { deps } = fakeDeps({
            knnSearch: async (_v, _l, field) => (field === 'plot' ? plot : []),
        })
        const out = await semanticSearchTv(
            SemanticSearchInputSchema.parse({ query: 'q', limit: 5 }),
            deps,
        )
        expect(out.map((m) => m.tmdbId)).toEqual([1, 2])
    })

    it('drops sub-floor shows, and returns [] when none clear the floor (feature: quality floor)', async () => {
        // One real match (0.85) + noise (0.12); then an all-weak catalog.
        const mixed = fakeDeps({
            knnSearch: async (_v, _l, field) =>
                field === 'plot' ? [scoredShow(1, 0.85), scoredShow(2, 0.12)] : [],
        })
        const kept = await semanticSearchTv({ query: 'q', limit: 8, mode: 'plot' }, mixed.deps)
        expect(kept.map((m) => m.tmdbId)).toEqual([1])

        const weak = fakeDeps({
            knnSearch: async (_v, _l, field) =>
                field === 'plot' ? [scoredShow(3, 0.15), scoredShow(4, 0.05)] : [],
        })
        const empty = await semanticSearchTv(
            SemanticSearchInputSchema.parse({ query: 'q', limit: 8 }),
            weak.deps,
        )
        expect(empty).toEqual([]) // weak → miss → agent escalates (e.g. to find_similar_tv)
    })
})

// ── fetchTvFromTmdb ──────────────────────────────────────────────────────────
describe('fetchTvFromTmdb', () => {
    it('fetches a specific tmdbId, maps name→title, and writes it back (feature: self-heal)', async () => {
        const { deps, calls } = fakeDeps()
        const out = await fetchTvFromTmdb({ tmdbId: 1396, limit: 3 }, deps)
        expect(calls.tmdbDetail).toEqual([1396])
        expect(out[0]!.title).toBe('Breaking Bad') // mapped from `name`
        expect(out[0]!.releaseDate).toBe('2008-01-20') // mapped from `first_air_date`
        expect(out[0]!.genres).toEqual(['Drama'])
        expect(calls.writeBack).toHaveLength(1)
        expect(calls.writeBack[0]![0]!.id).toBe(1396)
    })

    it('searches by query, capping at limit, then enriches each (feature)', async () => {
        const { deps, calls } = fakeDeps({ tmdbSearchIds: async () => [1, 2, 3, 4, 5] })
        const out = await fetchTvFromTmdb({ query: 'breaking', limit: 2 }, deps)
        expect(calls.tmdbDetail).toEqual([1, 2])
        expect(out).toHaveLength(2)
    })

    it('uses the query path when tmdbId is a 0 placeholder (regression)', async () => {
        const { deps, calls } = fakeDeps({ tmdbSearchIds: async () => [1396] })
        const out = await fetchTvFromTmdb({ query: 'Breaking Bad', tmdbId: 0, limit: 3 }, deps)
        expect(calls.tmdbDetail).toEqual([1396])
        expect(out).toHaveLength(1)
    })

    it('throws when neither query nor tmdbId is provided (edge)', async () => {
        const { deps } = fakeDeps()
        expect(fetchTvFromTmdb({ limit: 3 }, deps)).rejects.toThrow(/query or a tmdbId/)
    })

    it('still returns results when write-back fails (edge: best-effort)', async () => {
        const { deps } = fakeDeps({
            writeBack: async () => {
                throw new Error('embed boom')
            },
        })
        const out = await fetchTvFromTmdb({ tmdbId: 1396, limit: 3 }, deps)
        expect(out[0]!.title).toBe('Breaking Bad')
    })
})

// ── getTrendingTvShows ───────────────────────────────────────────────────────
describe('getTrendingTvShows', () => {
    it('caps the trending list at the requested limit (feature)', async () => {
        const many = Array.from({ length: 10 }, (_, i) => ({
            tmdbId: i,
            title: `s${i}`,
            overview: null,
            releaseDate: null,
            genres: [],
            posterPath: null,
        }))
        const { deps } = fakeDeps({ tmdbTrending: async () => many })
        const out = await getTrendingTvShows({ limit: 3 }, deps)
        expect(out).toHaveLength(3)
    })
})
