import { describe, expect, it } from 'bun:test'
import searchRoute from './search'

// Boundary-validation tests only — a blank/omitted query returns empty groups
// (200) BEFORE any DB/TMDB call, and only an abusive over-long query 400s. All
// deterministic and network-free.
describe('search/suggest route input validation', () => {
    it('returns empty groups for a blank query (edge, no network)', async () => {
        const res = await searchRoute.request('/suggest?q=%20%20')
        expect(res.status).toBe(200)
        expect(await res.json()).toEqual({ movies: [], tv: [] })
    })

    it('returns empty groups when the query is omitted (edge)', async () => {
        const res = await searchRoute.request('/suggest')
        expect(res.status).toBe(200)
        expect(await res.json()).toEqual({ movies: [], tv: [] })
    })

    it('rejects an over-long query (edge: bounded input)', async () => {
        const res = await searchRoute.request('/suggest?q=' + 'a'.repeat(201))
        expect(res.status).toBe(400)
    })
})
