import { afterEach, describe, expect, it } from 'vitest'
import {
    clearStoredConversationId,
    fetchConversationMessages,
    isToolPart,
    loadStoredConversationId,
    MANAGE_WATCHLIST,
    newConversationId,
    storeConversationId,
    toolLabel,
    toolNameOf,
} from './chat'

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

describe('conversation id persistence (cross-session resume)', () => {
    afterEach(() => window.localStorage.clear())

    it('generates distinct conversation ids (feature)', () => {
        const a = newConversationId()
        const b = newConversationId()
        expect(a).not.toBe(b)
        expect(a.length).toBeGreaterThan(10)
    })

    it('round-trips the id through localStorage and clears it (feature)', () => {
        expect(loadStoredConversationId()).toBeNull()
        storeConversationId('conv-xyz')
        expect(loadStoredConversationId()).toBe('conv-xyz')
        clearStoredConversationId()
        expect(loadStoredConversationId()).toBeNull()
    })
})

describe('fetchConversationMessages', () => {
    const originalFetch = globalThis.fetch
    afterEach(() => {
        globalThis.fetch = originalFetch
    })

    it('GETs the conversation by id and returns its prior turns (feature)', async () => {
        const messages = [{ id: 'u1', role: 'user', parts: [{ type: 'text', text: 'hi' }] }]
        let calledUrl = ''
        globalThis.fetch = (async (url: string) => {
            calledUrl = String(url)
            return {
                ok: true,
                status: 200,
                text: async () => JSON.stringify({ id: 'conv-1', messages }),
            } as Response
        }) as unknown as typeof fetch

        const out = await fetchConversationMessages('conv-1')
        expect(calledUrl).toContain('/api/v1/chat/conv-1')
        expect(out).toEqual(messages)
    })

    it('returns [] for an empty / unknown conversation (edge)', async () => {
        globalThis.fetch = (async () => ({
            ok: true,
            status: 200,
            text: async () => JSON.stringify({ id: 'conv-1', messages: [] }),
        })) as unknown as typeof fetch
        expect(await fetchConversationMessages('conv-1')).toEqual([])
    })

    it('throws on a malformed restore envelope (edge)', async () => {
        // A turn missing `role`/`parts` fails validation rather than flowing into
        // the chat state — the caller degrades to an empty thread.
        globalThis.fetch = (async () => ({
            ok: true,
            status: 200,
            text: async () => JSON.stringify({ id: 'conv-1', messages: [{ id: 'x' }] }),
        })) as unknown as typeof fetch
        await expect(fetchConversationMessages('conv-1')).rejects.toThrow()
    })
})
