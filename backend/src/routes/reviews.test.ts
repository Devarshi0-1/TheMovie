import { describe, expect, it } from 'bun:test'
import reviewsRoute from './reviews'

// Boundary-validation tests only — these reject BEFORE any DB/Redis call, so
// they're deterministic and network-free. The media-type path segment doubles
// as the discriminator on the public recent-reviews read.
describe('reviews route input validation', () => {
    it('rejects an unknown media type on the recent-reviews read (edge)', async () => {
        const res = await reviewsRoute.request('/podcast/123')
        expect(res.status).toBe(400)
    })

    it('rejects a non-numeric id on the recent-reviews read (edge)', async () => {
        const res = await reviewsRoute.request('/tv/not-a-number')
        expect(res.status).toBe(400)
    })

    it('rejects an unauthenticated review upsert (edge: auth gate)', async () => {
        const res = await reviewsRoute.request('/', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ movieId: 5, content: 'great', mediaType: 'tv' }),
        })
        expect(res.status).toBe(401)
    })
})
