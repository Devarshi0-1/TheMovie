import { describe, expect, it } from 'bun:test'
import type { MovieResult } from '@themovie/schemas'
import {
    SUGGEST_LIMIT,
    suggestAll,
    suggestMovies,
    suggestTvShows,
    type SuggestDeps,
} from './suggest'

const movie = (tmdbId: number, title: string): MovieResult => ({
    tmdbId,
    title,
    overview: null,
    releaseDate: null,
    genres: [],
    posterPath: null,
})

const show = (tmdbId: number, title: string): MovieResult => ({
    ...movie(tmdbId, title),
    mediaType: 'tv',
})

function deps(over: Partial<SuggestDeps> = {}): SuggestDeps {
    return {
        localSearch: async () => [],
        tmdbSearch: async () => [],
        ...over,
    }
}

describe('suggestMovies', () => {
    // ── Feature / happy path ──────────────────────────────────────────────
    it('returns local catalog hits first, then TMDB fills the rest', async () => {
        const result = await suggestMovies(
            'matrix',
            deps({
                localSearch: async () => [movie(1, 'The Matrix')],
                tmdbSearch: async () => [movie(2, 'The Matrix Reloaded')],
            }),
        )
        expect(result.map((m) => m.tmdbId)).toEqual([1, 2])
    })

    it('dedupes a title that appears in both sources, keeping the local one', async () => {
        const result = await suggestMovies(
            'dune',
            deps({
                localSearch: async () => [movie(10, 'Dune (local)')],
                tmdbSearch: async () => [movie(10, 'Dune (tmdb)'), movie(11, 'Dune: Part Two')],
            }),
        )
        expect(result.map((m) => m.tmdbId)).toEqual([10, 11])
        expect(result[0]!.title).toBe('Dune (local)')
    })

    // ── Edge cases ────────────────────────────────────────────────────────
    it('returns an empty list for a blank query without touching either source', async () => {
        let called = false
        const result = await suggestMovies(
            '   ',
            deps({
                localSearch: async () => {
                    called = true
                    return [movie(1, 'x')]
                },
            }),
        )
        expect(result).toEqual([])
        expect(called).toBe(false)
    })

    it('skips TMDB entirely once local already fills the limit', async () => {
        let tmdbCalled = false
        const full = Array.from({ length: SUGGEST_LIMIT }, (_, i) => movie(i + 1, `Local ${i}`))
        const result = await suggestMovies(
            'a',
            deps({
                localSearch: async () => full,
                tmdbSearch: async () => {
                    tmdbCalled = true
                    return [movie(99, 'Remote')]
                },
            }),
        )
        expect(result).toHaveLength(SUGGEST_LIMIT)
        expect(tmdbCalled).toBe(false)
    })

    it('caps the merged result at SUGGEST_LIMIT', async () => {
        const many = (offset: number) =>
            Array.from({ length: 6 }, (_, i) => movie(offset + i, `M${offset + i}`))
        const result = await suggestMovies(
            'a',
            deps({ localSearch: async () => many(0), tmdbSearch: async () => many(100) }),
        )
        expect(result).toHaveLength(SUGGEST_LIMIT)
    })

    it('degrades to local-only when TMDB throws', async () => {
        const result = await suggestMovies(
            'a',
            deps({
                localSearch: async () => [movie(1, 'Local')],
                tmdbSearch: async () => {
                    throw new Error('TMDB down')
                },
            }),
        )
        expect(result.map((m) => m.tmdbId)).toEqual([1])
    })

    it('returns an empty list when both sources fail', async () => {
        const result = await suggestMovies(
            'a',
            deps({
                localSearch: async () => {
                    throw new Error('db down')
                },
                tmdbSearch: async () => {
                    throw new Error('tmdb down')
                },
            }),
        )
        expect(result).toEqual([])
    })
})

describe('suggestTvShows', () => {
    // Shares the merge core with suggestMovies; verify it blends + dedupes the
    // same way and that results carry the TV mediaType through.
    it('returns local TV hits first, then TMDB fills the rest', async () => {
        const result = await suggestTvShows(
            'breaking',
            deps({
                localSearch: async () => [show(1, 'Breaking Bad')],
                tmdbSearch: async () => [show(2, 'Breaking Pointe')],
            }),
        )
        expect(result.map((m) => m.tmdbId)).toEqual([1, 2])
        expect(result.every((m) => m.mediaType === 'tv')).toBe(true)
    })

    it('returns an empty list for a blank query', async () => {
        const result = await suggestTvShows('   ', deps())
        expect(result).toEqual([])
    })
})

describe('suggestAll', () => {
    // ── Feature / happy path ──────────────────────────────────────────────
    it('groups movies and TV shows in one call', async () => {
        const result = await suggestAll('matrix', {
            movies: deps({ localSearch: async () => [movie(1, 'The Matrix')] }),
            tv: deps({ localSearch: async () => [show(10, 'The Matrix (series)')] }),
        })
        expect(result.movies.map((m) => m.tmdbId)).toEqual([1])
        expect(result.tv.map((m) => m.tmdbId)).toEqual([10])
        expect(result.tv[0]!.mediaType).toBe('tv')
    })

    // ── Edge cases ────────────────────────────────────────────────────────
    it('degrades one group to [] without affecting the other', async () => {
        const result = await suggestAll('a', {
            movies: deps({ localSearch: async () => [movie(1, 'Local Movie')] }),
            tv: deps({
                localSearch: async () => {
                    throw new Error('tv db down')
                },
                tmdbSearch: async () => {
                    throw new Error('tv tmdb down')
                },
            }),
        })
        expect(result.movies.map((m) => m.tmdbId)).toEqual([1])
        expect(result.tv).toEqual([])
    })

    it('returns empty groups for a blank query', async () => {
        const result = await suggestAll('  ', { movies: deps(), tv: deps() })
        expect(result).toEqual({ movies: [], tv: [] })
    })
})
