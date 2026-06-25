import { describe, expect, it } from 'bun:test'
import { ReviewEntrySchema, ReviewInputSchema } from './review'

describe('ReviewInputSchema', () => {
    it('parses a valid review (feature)', () => {
        const parsed = ReviewInputSchema.parse({ movieId: 5, rating: 8, content: 'Loved it.' })
        expect(parsed.rating).toBe(8)
    })

    it('allows a null/omitted rating (edge)', () => {
        expect(ReviewInputSchema.parse({ movieId: 5, content: 'ok' }).rating).toBeUndefined()
        expect(
            ReviewInputSchema.parse({ movieId: 5, content: 'ok', rating: null }).rating,
        ).toBeNull()
    })

    it('rejects out-of-range rating, empty content, and bad movieId (edge)', () => {
        expect(() => ReviewInputSchema.parse({ movieId: 5, content: 'x', rating: 11 })).toThrow()
        expect(() => ReviewInputSchema.parse({ movieId: 5, content: '' })).toThrow()
        expect(() => ReviewInputSchema.parse({ movieId: 0, content: 'x' })).toThrow()
    })
})

describe('ReviewEntrySchema', () => {
    it('parses a stored entry with a null rating (feature)', () => {
        const parsed = ReviewEntrySchema.parse({
            id: 'r1',
            userId: 'u1',
            movieId: 5,
            rating: null,
            content: 'meh',
            createdAt: '2026-01-01T00:00:00.000Z',
        })
        expect(parsed.rating).toBeNull()
    })
})
