import { describe, expect, it } from 'bun:test'
import { createWatchlistTools } from './watchlistTools'

describe('createWatchlistTools', () => {
    const tools = createWatchlistTools('user-1')

    it('exposes get_user_watchlist and manage_watchlist (feature)', () => {
        expect(Object.keys(tools).sort()).toEqual(['get_user_watchlist', 'manage_watchlist'])
    })

    it('get_user_watchlist auto-executes (read is safe) (feature)', () => {
        expect(typeof tools.get_user_watchlist.execute).toBe('function')
        expect(tools.get_user_watchlist.description).toBeTruthy()
    })

    it('manage_watchlist has NO executor — mutations require confirmation (feature: HITL)', () => {
        // The absence of `execute` is what forces client-side confirmation
        // before any watchlist change is applied.
        expect(tools.manage_watchlist.execute).toBeUndefined()
        expect(tools.manage_watchlist.inputSchema).toBeDefined()
        expect(tools.manage_watchlist.description).toContain('confirm')
    })
})
