import { describe, expect, it } from 'bun:test'
import {
    ManageWatchlistInputSchema,
    WatchlistAddResultSchema,
    WatchlistAddSchema,
    WatchlistEntrySchema,
    WatchlistRemoveResultSchema,
    WatchlistStatusSchema,
} from './watchlist'

describe('WatchlistAddSchema', () => {
    it('parses a valid add body (feature)', () => {
        const parsed = WatchlistAddSchema.parse({ movieId: 5, title: 'Dune', posterPath: '/p.jpg' })
        expect(parsed.movieId).toBe(5)
    })

    it('allows a null/omitted posterPath (edge)', () => {
        expect(WatchlistAddSchema.parse({ movieId: 5, title: 'Dune' }).posterPath).toBeUndefined()
        expect(
            WatchlistAddSchema.parse({ movieId: 5, title: 'Dune', posterPath: null }).posterPath,
        ).toBeNull()
    })

    it('rejects a non-positive movieId and an empty title (edge)', () => {
        expect(() => WatchlistAddSchema.parse({ movieId: 0, title: 'x' })).toThrow()
        expect(() => WatchlistAddSchema.parse({ movieId: 5, title: '' })).toThrow()
    })
})

describe('ManageWatchlistInputSchema', () => {
    it('accepts a batch of movies to add (feature)', () => {
        const parsed = ManageWatchlistInputSchema.parse({
            action: 'add',
            movies: [
                { movieId: 5, title: 'Dune' },
                { movieId: 6, title: 'Dune: Part Two' },
            ],
        })
        expect(parsed.action).toBe('add')
        expect(parsed.movies.map((m) => m.movieId)).toEqual([5, 6])
    })

    it('accepts a single-movie remove batch (feature)', () => {
        expect(
            ManageWatchlistInputSchema.parse({ action: 'remove', movies: [{ movieId: 5 }] }).action,
        ).toBe('remove')
    })

    it('rejects an unknown action and an empty movie list (edge)', () => {
        expect(() =>
            ManageWatchlistInputSchema.parse({ action: 'clear', movies: [{ movieId: 5 }] }),
        ).toThrow()
        expect(() => ManageWatchlistInputSchema.parse({ action: 'add', movies: [] })).toThrow()
    })
})

describe('WatchlistEntrySchema', () => {
    it('parses a stored entry (feature)', () => {
        const parsed = WatchlistEntrySchema.parse({
            movieId: 5,
            title: 'Dune',
            posterPath: null,
            createdAt: '2026-01-01T00:00:00.000Z',
        })
        expect(parsed.title).toBe('Dune')
    })
})

describe('REST response schemas', () => {
    it('parses status, add, and remove results (feature)', () => {
        expect(WatchlistStatusSchema.parse({ inWatchlist: true }).inWatchlist).toBe(true)
        expect(WatchlistAddResultSchema.parse({ added: true, movieId: 5 }).added).toBe(true)
        expect(WatchlistRemoveResultSchema.parse({ removed: true, movieId: 5 }).removed).toBe(true)
    })

    it('rejects a malformed result (edge)', () => {
        expect(() => WatchlistStatusSchema.parse({ inWatchlist: 'yes' })).toThrow()
        expect(() => WatchlistAddResultSchema.parse({ added: true })).toThrow()
    })
})
