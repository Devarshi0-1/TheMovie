import { describe, expect, it } from 'bun:test'
import { RecommendationSchema, RecommendationsSchema } from './recommendation'

describe('RecommendationSchema', () => {
    it('parses a single recommendation (feature)', () => {
        const parsed = RecommendationSchema.parse({
            tmdbId: 10,
            title: 'Aliens',
            reason: 'Because you watched Alien.',
        })
        expect(parsed.tmdbId).toBe(10)
    })

    it('rejects a missing reason (edge: incomplete model output)', () => {
        expect(() => RecommendationSchema.parse({ tmdbId: 10, title: 'Aliens' })).toThrow()
    })

    it('wraps a ranked list (feature: generateObject envelope)', () => {
        const parsed = RecommendationsSchema.parse({
            recommendations: [{ tmdbId: 10, title: 'Aliens', reason: 'r' }],
        })
        expect(parsed.recommendations).toHaveLength(1)
    })
})
