import { describe, expect, it } from 'bun:test'
import tvRoute from './tv'

// Boundary-validation tests only — these all return 400 BEFORE any TMDB call,
// so they're deterministic and network-free.
describe('tv route input validation', () => {
    it('rejects a search with no query (edge)', async () => {
        const res = await tvRoute.request('/search')
        expect(res.status).toBe(400)
    })

    it('rejects a blank/whitespace search query (edge)', async () => {
        const res = await tvRoute.request('/search?q=%20%20')
        expect(res.status).toBe(400)
    })

    it('rejects an over-long search query (edge: bounded input)', async () => {
        const res = await tvRoute.request('/search?q=' + 'a'.repeat(201))
        expect(res.status).toBe(400)
    })

    it('rejects a non-numeric tv id (edge: injection-safe param)', async () => {
        const res = await tvRoute.request('/not-a-number')
        expect(res.status).toBe(400)
    })

    it('rejects a non-numeric id for the extras route (edge)', async () => {
        const res = await tvRoute.request('/abc/extras')
        expect(res.status).toBe(400)
    })
})
