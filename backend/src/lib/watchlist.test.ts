import { describe, expect, it } from 'bun:test'
import {
    addToWatchlist,
    getWatchlist,
    isInWatchlist,
    removeFromWatchlist,
    type WatchlistDeps,
} from './watchlist'
import type { MediaType, WatchlistEntry } from '@themovie/schemas'

const entry = (movieId: number, mediaType: MediaType = 'movie'): WatchlistEntry => ({
    movieId,
    mediaType,
    title: `${mediaType === 'tv' ? 'Show' : 'Movie'} ${movieId}`,
    posterPath: null,
    createdAt: '2026-01-01T00:00:00.000Z',
})

const member = (movieId: number, mediaType: MediaType) => `${mediaType}:${movieId}`

// Fake deps over an in-memory list + membership set; override seams per test.
// The set stores `mediaType:id` members, mirroring the real Redis representation.
const fakeDeps = (rows: WatchlistEntry[] = []) => {
    const list = [...rows]
    const set = new Set<string>(rows.map((r) => member(r.movieId, r.mediaType)))
    let populated = rows.length > 0
    const calls = { hydrate: 0, cacheAdd: 0, cacheRemove: 0 }
    const deps: WatchlistDeps = {
        async dbInsert(_userId, item) {
            if (list.some((r) => r.movieId === item.movieId && r.mediaType === item.mediaType))
                return false
            list.unshift(entry(item.movieId, item.mediaType))
            return true
        },
        async dbDelete(_userId, movieId, mediaType) {
            const i = list.findIndex((r) => r.movieId === movieId && r.mediaType === mediaType)
            if (i === -1) return false
            list.splice(i, 1)
            return true
        },
        async dbList() {
            return list
        },
        async cacheAdd(_userId, movieId, mediaType) {
            calls.cacheAdd++
            // Models the real impl: only mirror into an ALREADY-populated set; a
            // cold set is left absent so the next read hydrates it wholesale.
            if (!populated) return
            set.add(member(movieId, mediaType))
        },
        async cacheRemove(_userId, movieId, mediaType) {
            calls.cacheRemove++
            set.delete(member(movieId, mediaType))
        },
        async cacheHas(_userId, movieId, mediaType) {
            return populated ? set.has(member(movieId, mediaType)) : undefined
        },
        async cacheHydrate(_userId, members) {
            calls.hydrate++
            for (const m of members) set.add(m)
            populated = true
        },
    }
    return { deps, list, set, calls }
}

describe('addToWatchlist', () => {
    it('adds a new movie and mirrors it into an already-warm set (feature)', async () => {
        // Start warm (an existing entry) so the membership set is populated.
        const { deps, list, set, calls } = fakeDeps([entry(1)])
        const res = await addToWatchlist(
            'u1',
            { movieId: 5, title: 'Dune', mediaType: 'movie' },
            deps,
        )
        expect(res.added).toBe(true)
        expect(list.map((r) => r.movieId)).toContain(5)
        expect(set.has('movie:5')).toBe(true) // mirrored to the warm membership set
        expect(calls.cacheAdd).toBe(1)
    })

    it('does not partially populate a cold set on add (regression)', async () => {
        // Cold cache, but the user already has title 9 in Postgres. Adding title 5
        // must NOT create a one-member set (movie:5 only) — that would make a later
        // membership check for title 9 a false negative. Instead the cold set is
        // left absent so the next isInWatchlist rebuilds it in full from Postgres.
        const { deps, set } = fakeDeps()
        deps.dbList = async () => [entry(9), entry(5)]
        await addToWatchlist('u1', { movieId: 5, title: 'Dune', mediaType: 'movie' }, deps)
        expect(set.size).toBe(0) // cold set untouched, not half-filled

        // The next membership check hydrates the whole set and answers correctly.
        expect(await isInWatchlist('u1', 9, 'movie', deps)).toBe(true)
        expect(set.has('movie:9')).toBe(true)
        expect(set.has('movie:5')).toBe(true)
    })

    it('is idempotent: adding an existing entry reports added=false (edge: unique_user_media)', async () => {
        const { deps } = fakeDeps([entry(5)])
        const res = await addToWatchlist(
            'u1',
            { movieId: 5, title: 'Dune', mediaType: 'movie' },
            deps,
        )
        expect(res.added).toBe(false)
    })

    it('treats a show and a movie with the same id as distinct (feature: mediaType)', async () => {
        const { deps, set } = fakeDeps([entry(1396, 'movie')])
        // Same id, different media type → a NEW entry, not a duplicate.
        const res = await addToWatchlist(
            'u1',
            { movieId: 1396, title: 'Breaking Bad', mediaType: 'tv' },
            deps,
        )
        expect(res.added).toBe(true)
        expect(set.has('movie:1396')).toBe(true)
        expect(set.has('tv:1396')).toBe(true)
    })
})

describe('removeFromWatchlist', () => {
    it('removes a present movie and reports removed=true (feature)', async () => {
        const { deps, set } = fakeDeps([entry(5)])
        const res = await removeFromWatchlist('u1', 5, 'movie', deps)
        expect(res.removed).toBe(true)
        expect(set.has('movie:5')).toBe(false)
    })

    it('removes the show without touching the same-id movie (edge: mediaType-scoped)', async () => {
        const { deps, set } = fakeDeps([entry(1396, 'movie'), entry(1396, 'tv')])
        const res = await removeFromWatchlist('u1', 1396, 'tv', deps)
        expect(res.removed).toBe(true)
        expect(set.has('tv:1396')).toBe(false)
        expect(set.has('movie:1396')).toBe(true) // the movie stays
    })

    it('is idempotent: removing an absent movie reports removed=false (edge)', async () => {
        const { deps } = fakeDeps()
        expect((await removeFromWatchlist('u1', 999, 'movie', deps)).removed).toBe(false)
    })
})

describe('getWatchlist', () => {
    it('returns the user entries with their media types (feature)', async () => {
        const { deps } = fakeDeps([entry(1, 'movie'), entry(2, 'tv')])
        const list = await getWatchlist('u1', deps)
        expect(list.map((e) => [e.movieId, e.mediaType])).toEqual([
            [1, 'movie'],
            [2, 'tv'],
        ])
    })
})

describe('isInWatchlist', () => {
    it('returns true via the membership set without touching the DB (feature: O(1))', async () => {
        const { deps, calls } = fakeDeps([entry(5)])
        expect(await isInWatchlist('u1', 5, 'movie', deps)).toBe(true)
        expect(calls.hydrate).toBe(0) // set was already populated
    })

    it('distinguishes media types in the membership check (edge)', async () => {
        const { deps } = fakeDeps([entry(1396, 'tv')])
        expect(await isInWatchlist('u1', 1396, 'tv', deps)).toBe(true)
        expect(await isInWatchlist('u1', 1396, 'movie', deps)).toBe(false)
    })

    it('returns false for a non-member when the set is populated (feature)', async () => {
        const { deps } = fakeDeps([entry(5)])
        expect(await isInWatchlist('u1', 404, 'movie', deps)).toBe(false)
    })

    it('hydrates from Postgres on a cold cache, then answers (edge: cold start)', async () => {
        const { deps, calls, set } = fakeDeps()
        // Simulate DB having the row but cache cold:
        deps.dbList = async () => [entry(7, 'tv')]
        deps.cacheHas = async () => undefined
        const present = await isInWatchlist('u1', 7, 'tv', deps)
        expect(present).toBe(true)
        expect(calls.hydrate).toBe(1)
        expect(set.has('tv:7')).toBe(true) // membership set rebuilt
    })
})
