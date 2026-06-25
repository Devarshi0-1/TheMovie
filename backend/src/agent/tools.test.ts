import { describe, expect, it } from 'bun:test'
import { retrievalTools } from './tools'

describe('retrievalTools', () => {
    it('exposes the retrieval + summary tools (feature)', () => {
        expect(Object.keys(retrievalTools).sort()).toEqual([
            'fetch_from_tmdb',
            'get_movie_details',
            'get_trending',
            'search_movies_sql',
            'semantic_search_movies',
            'summarize_reviews',
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
})
