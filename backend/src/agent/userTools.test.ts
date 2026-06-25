import { describe, expect, it } from 'bun:test'
import { createUserTools } from './userTools'

describe('createUserTools', () => {
    const tools = createUserTools('user-1')

    it('exposes watchlist + recommendation tools (feature)', () => {
        expect(Object.keys(tools).sort()).toEqual([
            'get_recommendations',
            'get_user_watchlist',
            'manage_watchlist',
        ])
    })

    it('read tools auto-execute (reads are safe) (feature)', () => {
        expect(typeof tools.get_user_watchlist.execute).toBe('function')
        expect(typeof tools.get_recommendations.execute).toBe('function')
    })

    it('manage_watchlist has NO executor — mutations require confirmation (feature: HITL)', () => {
        // The absence of `execute` is what forces client-side confirmation
        // before any watchlist change is applied.
        expect(tools.manage_watchlist.execute).toBeUndefined()
        expect(tools.manage_watchlist.inputSchema).toBeDefined()
        expect(tools.manage_watchlist.description).toContain('confirm')
    })
})
