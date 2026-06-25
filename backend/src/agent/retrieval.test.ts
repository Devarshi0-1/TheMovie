import { describe, expect, it } from 'bun:test'
import {
    fetchFromTmdb,
    getMovieDetails,
    getTrending,
    searchMoviesSql,
    semanticSearchMovies,
    type RetrievalDeps,
} from './retrieval'
import type { MovieForIngest } from '../lib/tmdb'
import type { ScoredMovieResult } from '../schemas/movie'

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
        knnSearch: [] as { vector: number[]; limit: number }[],
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
        async knnSearch(vector, limit) {
            calls.knnSearch.push({ vector, limit })
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
describe('semanticSearchMovies', () => {
    it('embeds the query then runs kNN with that vector + limit (feature)', async () => {
        const scored: ScoredMovieResult[] = [
            {
                tmdbId: 1,
                title: 'X',
                overview: null,
                releaseDate: null,
                genres: [],
                posterPath: null,
                similarity: 0.9,
            },
        ]
        const seen: { vector: number[]; limit: number }[] = []
        const { deps, calls } = fakeDeps({
            knnSearch: async (vector, limit) => {
                seen.push({ vector, limit })
                return scored
            },
        })
        const out = await semanticSearchMovies({ query: 'hero becomes villain', limit: 6 }, deps)
        expect(calls.embedQuery).toEqual(['hero becomes villain'])
        expect(seen[0]).toEqual({ vector: [0.1, 0.2, 0.3], limit: 6 })
        expect(out).toEqual(scored)
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
