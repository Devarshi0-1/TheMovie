import { describe, expect, it } from 'bun:test'
import {
    FetchFromTmdbInputSchema,
    MovieDetailsInputSchema,
    MovieExtrasSchema,
    MovieResultSchema,
    ReviewSummaryInputSchema,
    ReviewSummarySchema,
    ScoredMovieResultSchema,
    SemanticSearchInputSchema,
    SqlSearchInputSchema,
    TrendingInputSchema,
    WatchProvidersSchema,
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

    it('SemanticSearch mode defaults to "both" and rejects unknown modes (feature: reception search)', () => {
        expect(SemanticSearchInputSchema.parse({ query: 'scary' }).mode).toBe('both')
        expect(SemanticSearchInputSchema.parse({ query: 'scary', mode: 'reception' }).mode).toBe(
            'reception',
        )
        expect(() => SemanticSearchInputSchema.parse({ query: 'scary', mode: 'vibes' })).toThrow()
    })

    it('FetchFromTmdb defaults limit to 3 (feature)', () => {
        expect(FetchFromTmdbInputSchema.parse({ query: 'dune' }).limit).toBe(3)
    })

    it('FetchFromTmdb tolerates a tmdbId:0 placeholder alongside a query (regression)', () => {
        // gpt-5 fills the optional tmdbId with 0; the schema must NOT reject it
        // (retrieval.ts treats a non-positive id as absent so the query wins).
        expect(FetchFromTmdbInputSchema.parse({ query: 'dune', tmdbId: 0 }).tmdbId).toBe(0)
    })

    it('required-id tools reject a 0/negative tmdbId at the boundary (regression)', () => {
        // A 0 id 404s against TMDB; validate positivity at the Zod boundary
        // rather than fetching movie id 0.
        expect(MovieDetailsInputSchema.parse({ tmdbId: 27205 }).tmdbId).toBe(27205)
        expect(() => MovieDetailsInputSchema.parse({ tmdbId: 0 })).toThrow()
        expect(() => MovieDetailsInputSchema.parse({ tmdbId: -5 })).toThrow()
        expect(ReviewSummaryInputSchema.parse({ tmdbId: 27205 }).tmdbId).toBe(27205)
        expect(() => ReviewSummaryInputSchema.parse({ tmdbId: 0 })).toThrow()
    })

    it('Trending defaults limit to 10 (feature)', () => {
        expect(TrendingInputSchema.parse({}).limit).toBe(10)
    })
})

describe('MovieExtrasSchema', () => {
    it('parses a full extras payload (feature)', () => {
        const parsed = MovieExtrasSchema.parse({
            cast: [{ id: 1, name: 'Leo', character: 'Cobb', profilePath: '/p.jpg' }],
            director: 'Nolan',
            trailer: { key: 'abc', name: 'Trailer', site: 'YouTube', type: 'Trailer' },
            watchProviders: {
                region: 'US',
                link: 'https://x',
                flatrate: [{ id: 8, name: 'Netflix', logoPath: '/nf.jpg' }],
                rent: [],
                buy: [],
            },
            recommendations: [],
        })
        expect(parsed.cast[0]?.name).toBe('Leo')
        expect(parsed.trailer?.key).toBe('abc')
    })

    it('accepts an empty/null extras payload (edge: nothing to show)', () => {
        const parsed = MovieExtrasSchema.parse({
            cast: [],
            director: null,
            trailer: null,
            watchProviders: null,
            recommendations: [],
        })
        expect(parsed.watchProviders).toBeNull()
    })

    it('WatchProvidersSchema requires the offer-type arrays (edge)', () => {
        expect(() =>
            WatchProvidersSchema.parse({ region: 'US', link: null, flatrate: [] }),
        ).toThrow()
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
