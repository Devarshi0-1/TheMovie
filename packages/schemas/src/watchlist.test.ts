import { describe, expect, it } from 'bun:test'
import { ManageWatchlistInputSchema, WatchlistAddSchema, WatchlistEntrySchema } from './watchlist'

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
    it('accepts add/remove actions (feature)', () => {
        expect(
            ManageWatchlistInputSchema.parse({ action: 'add', movieId: 5, title: 'Dune' }).action,
        ).toBe('add')
        expect(ManageWatchlistInputSchema.parse({ action: 'remove', movieId: 5 }).action).toBe(
            'remove',
        )
    })

    it('rejects an unknown action (edge)', () => {
        expect(() => ManageWatchlistInputSchema.parse({ action: 'clear', movieId: 5 })).toThrow()
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
