import { describe, expect, it } from 'bun:test'
import moviesRoute from './movies'

// Boundary-validation tests only — these all return 400 BEFORE any TMDB call,
// so they're deterministic and network-free.
describe('movies route input validation', () => {
    it('rejects a search with no query (edge)', async () => {
        const res = await moviesRoute.request('/search')
        expect(res.status).toBe(400)
    })

    it('rejects a blank/whitespace query (edge)', async () => {
        const res = await moviesRoute.request('/search?q=%20%20')
        expect(res.status).toBe(400)
    })

    it('rejects an over-long query (edge: bounded input)', async () => {
        const res = await moviesRoute.request('/search?q=' + 'a'.repeat(201))
        expect(res.status).toBe(400)
    })

    it('rejects a non-numeric movie id (edge: injection-safe param)', async () => {
        const res = await moviesRoute.request('/not-a-number')
        expect(res.status).toBe(400)
    })

    it('rejects a non-numeric id for the summary route (edge)', async () => {
        const res = await moviesRoute.request('/abc/summary')
        expect(res.status).toBe(400)
    })

    it('rejects a non-numeric id for the extras route (edge)', async () => {
        const res = await moviesRoute.request('/abc/extras')
        expect(res.status).toBe(400)
    })
})
