import { describe, expect, it } from 'bun:test'
import { asTvResults, retrievalTools } from './tools'

describe('retrievalTools', () => {
    it('exposes the retrieval + summary + lookup tools, movies AND TV (feature)', () => {
        expect(Object.keys(retrievalTools).sort()).toEqual([
            'fetch_from_tmdb',
            'fetch_tv_from_tmdb',
            'find_movies_by_person',
            'find_similar_movies',
            'get_movie_details',
            'get_trending',
            'get_trending_tv',
            'get_watch_providers',
            'search_movies_sql',
            'search_tv_sql',
            'semantic_search_movies',
            'semantic_search_tv',
            'summarize_reviews',
            'summarize_tv_reviews',
        ])
    })

    it('every tool has a description, input schema, and executor (feature)', () => {
        for (const t of Object.values(retrievalTools)) {
            expect(typeof t.description).toBe('string')
            expect(t.description!.length).toBeGreaterThan(20)
            expect(t.inputSchema).toBeDefined()
            expect(typeof t.execute).toBe('function')
        }
    })

    it('descriptions encode the cheapest-first escalation (feature: agent guidance)', () => {
        // SQL is tier 1 / first; TMDB is the explicit last resort.
        expect(retrievalTools.search_movies_sql.description).toContain('FIRST')
        expect(retrievalTools.semantic_search_movies.description?.toLowerCase()).toContain(
            'semantic',
        )
        expect(retrievalTools.fetch_from_tmdb.description).toContain('LAST RESORT')
    })

    it('TV tools mirror the movie tiers and stay scoped to TV (feature: TV parity)', () => {
        // The TV tier descriptions encode the same FIRST → semantic → LAST RESORT
        // escalation, and name TV so the agent picks them for show queries.
        expect(retrievalTools.search_tv_sql.description).toContain('FIRST')
        expect(retrievalTools.search_tv_sql.description).toContain('TV')
        expect(retrievalTools.semantic_search_tv.description?.toLowerCase()).toContain('semantic')
        expect(retrievalTools.fetch_tv_from_tmdb.description).toContain('LAST RESORT')
        expect(retrievalTools.summarize_tv_reviews.description).toContain('TV')
    })
})

describe('asTvResults', () => {
    it("stamps every hit with mediaType 'tv' so cards route to /tv/:id (feature)", () => {
        const tagged = asTvResults([
            {
                tmdbId: 1,
                title: 'A',
                overview: null,
                releaseDate: null,
                genres: [],
                posterPath: null,
            },
            {
                tmdbId: 2,
                title: 'B',
                overview: 'x',
                releaseDate: '2020-01-01',
                genres: ['Drama'],
                posterPath: '/p.jpg',
            },
        ])
        expect(tagged.every((r) => r.mediaType === 'tv')).toBe(true)
    })

    it('preserves extra fields like similarity (edge: scored results)', () => {
        const [hit] = asTvResults([
            {
                tmdbId: 7,
                title: 'C',
                overview: null,
                releaseDate: null,
                genres: [],
                posterPath: null,
                similarity: 0.91,
            },
        ])
        expect(hit).toMatchObject({ tmdbId: 7, mediaType: 'tv', similarity: 0.91 })
    })

    it('returns an empty array unchanged (edge: no hits)', () => {
        expect(asTvResults([])).toEqual([])
    })
})
