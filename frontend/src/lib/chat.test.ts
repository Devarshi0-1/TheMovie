import { describe, expect, it } from 'vitest'
import { isToolPart, MANAGE_WATCHLIST, toolLabel, toolNameOf } from './chat'

describe('chat part helpers', () => {
    it('detects tool parts by type prefix', () => {
        expect(isToolPart({ type: 'tool-search_movies_sql' })).toBe(true)
        expect(isToolPart({ type: 'dynamic-tool' })).toBe(true)
        expect(isToolPart({ type: 'text' })).toBe(false)
        expect(isToolPart({ type: 'reasoning' })).toBe(false)
    })

    it('extracts the tool name from a tool part', () => {
        expect(toolNameOf({ type: 'tool-manage_watchlist', toolCallId: 't', state: 'x' })).toBe(
            MANAGE_WATCHLIST,
        )
        expect(
            toolNameOf({ type: 'dynamic-tool', toolName: 'whatever', toolCallId: 't', state: 'x' }),
        ).toBe('whatever')
    })

    it('maps known tools to friendly running/done labels', () => {
        expect(toolLabel('search_movies_sql', false)).toBe('Searching the catalog')
        expect(toolLabel('search_movies_sql', true)).toBe('Searched the catalog')
    })

    it('falls back to a humanized label for unknown tools', () => {
        expect(toolLabel('some_new_tool', false)).toBe('Running some new tool')
        expect(toolLabel('some_new_tool', true)).toBe('Ran some new tool')
    })
})
