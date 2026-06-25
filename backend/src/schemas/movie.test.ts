import { describe, expect, it } from 'bun:test'
import {
    FetchFromTmdbInputSchema,
    MovieResultSchema,
    ReviewSummarySchema,
    ScoredMovieResultSchema,
    SemanticSearchInputSchema,
    SqlSearchInputSchema,
    TrendingInputSchema,
} from './movie'

describe('MovieResultSchema', () => {
    const valid = {
        tmdbId: 1,
        title: 'Inception',
        overview: 'Dreams.',
        releaseDate: '2010-07-16',
        genres: ['Sci-Fi'],
        posterPath: '/p.jpg',
    }

    it('parses a well-formed result (feature)', () => {
        expect(MovieResultSchema.parse(valid).title).toBe('Inception')
    })

    it('allows null overview/poster/release (edge: partial row)', () => {
        const parsed = MovieResultSchema.parse({
            ...valid,
            overview: null,
            posterPath: null,
            releaseDate: null,
        })
        expect(parsed.overview).toBeNull()
    })

    it('rejects a missing title (edge)', () => {
        const { title: _omit, ...rest } = valid
        expect(() => MovieResultSchema.parse(rest)).toThrow()
    })

    it('ScoredMovieResultSchema requires a similarity number (feature)', () => {
        expect(ScoredMovieResultSchema.parse({ ...valid, similarity: 0.83 }).similarity).toBe(0.83)
        expect(() => ScoredMovieResultSchema.parse(valid)).toThrow()
    })
})

describe('tool input schemas', () => {
    it('SqlSearch applies the default limit and bounds it (feature)', () => {
        expect(SqlSearchInputSchema.parse({ title: 'Dune' }).limit).toBe(10)
        expect(() => SqlSearchInputSchema.parse({ title: 'Dune', limit: 99 })).toThrow()
    })

    it('SqlSearch bounds the year (edge)', () => {
        expect(() => SqlSearchInputSchema.parse({ year: 1700 })).toThrow()
        expect(SqlSearchInputSchema.parse({ year: 2010 }).year).toBe(2010)
    })

    it('SemanticSearch requires a non-empty query, defaults limit to 8 (feature)', () => {
        expect(SemanticSearchInputSchema.parse({ query: 'hero becomes villain' }).limit).toBe(8)
        expect(() => SemanticSearchInputSchema.parse({ query: '' })).toThrow()
    })

    it('FetchFromTmdb defaults limit to 3 (feature)', () => {
        expect(FetchFromTmdbInputSchema.parse({ query: 'dune' }).limit).toBe(3)
    })

    it('Trending defaults limit to 10 (feature)', () => {
        expect(TrendingInputSchema.parse({}).limit).toBe(10)
    })
})

describe('ReviewSummarySchema', () => {
    it('parses a well-formed summary (feature)', () => {
        const parsed = ReviewSummarySchema.parse({
            vibe: 'Tense and well-acted.',
            pros: ['Great acting'],
            cons: [],
        })
        expect(parsed.pros).toEqual(['Great acting'])
        expect(parsed.cons).toEqual([])
    })

    it('rejects a missing vibe (edge: incomplete model output)', () => {
        expect(() => ReviewSummarySchema.parse({ pros: [], cons: [] })).toThrow()
    })
})
