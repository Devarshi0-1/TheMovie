import { describe, expect, it } from 'bun:test'
import {
    addToWatchlist,
    getWatchlist,
    isInWatchlist,
    removeFromWatchlist,
    type WatchlistDeps,
} from './watchlist'
import type { WatchlistEntry } from '../schemas/watchlist'

const entry = (movieId: number): WatchlistEntry => ({
    movieId,
    title: `Movie ${movieId}`,
    posterPath: null,
    createdAt: '2026-01-01T00:00:00.000Z',
})

// Fake deps over an in-memory list + membership set; override seams per test.
const fakeDeps = (rows: WatchlistEntry[] = []) => {
    const list = [...rows]
    const set = new Set<number>(rows.map((r) => r.movieId))
    let populated = rows.length > 0
    const calls = { hydrate: 0, cacheAdd: 0, cacheRemove: 0 }
    const deps: WatchlistDeps = {
        async dbInsert(_userId, item) {
            if (list.some((r) => r.movieId === item.movieId)) return false
            list.unshift(entry(item.movieId))
            return true
        },
        async dbDelete(_userId, movieId) {
            const i = list.findIndex((r) => r.movieId === movieId)
            if (i === -1) return false
            list.splice(i, 1)
            return true
        },
        async dbList() {
            return list
        },
        async cacheAdd(_userId, movieId) {
            calls.cacheAdd++
            set.add(movieId)
            populated = true
        },
        async cacheRemove(_userId, movieId) {
            calls.cacheRemove++
            set.delete(movieId)
        },
        async cacheHas(_userId, movieId) {
            return populated ? set.has(movieId) : undefined
        },
        async cacheHydrate(_userId, movieIds) {
            calls.hydrate++
            for (const id of movieIds) set.add(id)
            populated = true
        },
    }
    return { deps, list, set, calls }
}

describe('addToWatchlist', () => {
    it('adds a new movie and reports added=true (feature)', async () => {
        const { deps, list, set, calls } = fakeDeps()
        const res = await addToWatchlist('u1', { movieId: 5, title: 'Dune' }, deps)
        expect(res.added).toBe(true)
        expect(list.map((r) => r.movieId)).toContain(5)
        expect(set.has(5)).toBe(true) // mirrored to the membership set
        expect(calls.cacheAdd).toBe(1)
    })

    it('is idempotent: adding an existing movie reports added=false (edge: unique_user_movie)', async () => {
        const { deps } = fakeDeps([entry(5)])
        const res = await addToWatchlist('u1', { movieId: 5, title: 'Dune' }, deps)
        expect(res.added).toBe(false)
    })
})

describe('removeFromWatchlist', () => {
    it('removes a present movie and reports removed=true (feature)', async () => {
        const { deps, set } = fakeDeps([entry(5)])
        const res = await removeFromWatchlist('u1', 5, deps)
        expect(res.removed).toBe(true)
        expect(set.has(5)).toBe(false)
    })

    it('is idempotent: removing an absent movie reports removed=false (edge)', async () => {
        const { deps } = fakeDeps()
        expect((await removeFromWatchlist('u1', 999, deps)).removed).toBe(false)
    })
})

describe('getWatchlist', () => {
    it('returns the user entries (feature)', async () => {
        const { deps } = fakeDeps([entry(1), entry(2)])
        expect((await getWatchlist('u1', deps)).map((e) => e.movieId)).toEqual([1, 2])
    })
})

describe('isInWatchlist', () => {
    it('returns true via the membership set without touching the DB (feature: O(1))', async () => {
        const { deps, calls } = fakeDeps([entry(5)])
        expect(await isInWatchlist('u1', 5, deps)).toBe(true)
        expect(calls.hydrate).toBe(0) // set was already populated
    })

    it('returns false for a non-member when the set is populated (feature)', async () => {
        const { deps } = fakeDeps([entry(5)])
        expect(await isInWatchlist('u1', 404, deps)).toBe(false)
    })

    it('hydrates from Postgres on a cold cache, then answers (edge: cold start)', async () => {
        // Seed rows but force a cold set by starting empty-populated.
        const { deps, calls, set } = fakeDeps()
        // Simulate DB having the row but cache cold:
        deps.dbList = async () => [entry(7)]
        deps.cacheHas = async () => undefined
        const present = await isInWatchlist('u1', 7, deps)
        expect(present).toBe(true)
        expect(calls.hydrate).toBe(1)
        expect(set.has(7)).toBe(true) // membership set rebuilt
    })
})
