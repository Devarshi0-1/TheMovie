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

    // /suggest returns 200 + [] for a blank query (it's typed-into, not submitted)
    // and only 400s on an abusive over-long query — both before any DB/TMDB call.
    it('returns an empty list for a blank suggest query (edge, no network)', async () => {
        const res = await moviesRoute.request('/suggest?q=%20%20')
        expect(res.status).toBe(200)
        expect(await res.json()).toEqual([])
    })

    it('returns an empty list when the suggest query is omitted (edge)', async () => {
        const res = await moviesRoute.request('/suggest')
        expect(res.status).toBe(200)
        expect(await res.json()).toEqual([])
    })

    it('rejects an over-long suggest query (edge: bounded input)', async () => {
        const res = await moviesRoute.request('/suggest?q=' + 'a'.repeat(201))
        expect(res.status).toBe(400)
    })

    it('returns the alphabetized movie genre list (feature, no network)', async () => {
        const res = await moviesRoute.request('/genres')
        expect(res.status).toBe(200)
        const genres = (await res.json()) as { id: number; name: string }[]
        expect(genres[0]).toEqual({ id: 28, name: 'Action' })
        expect(genres.map((g) => g.name)).toContain('Science Fiction')
        // Alphabetized.
        const names = genres.map((g) => g.name)
        expect(names).toEqual([...names].sort((a, b) => a.localeCompare(b)))
    })

    it('rejects a discover request with a missing/invalid genre (edge)', async () => {
        expect((await moviesRoute.request('/discover')).status).toBe(400)
        expect((await moviesRoute.request('/discover?genre=abc')).status).toBe(400)
        expect((await moviesRoute.request('/discover?genre=0')).status).toBe(400)
    })
})
