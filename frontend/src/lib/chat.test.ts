import { afterEach, describe, expect, it } from 'vitest'
import {
    clearStoredConversationId,
    extractSuggestedMovies,
    fetchConversationMessages,
    isToolPart,
    loadStoredConversationId,
    MANAGE_WATCHLIST,
    newConversationId,
    storeConversationId,
    toolLabel,
    toolNameOf,
    type AppUIMessage,
} from './chat'

const aMovie = (tmdbId: number, title: string) => ({
    tmdbId,
    title,
    overview: null,
    releaseDate: '2020-01-01',
    genres: [],
    posterPath: null,
})

const assistant = (parts: unknown[]): AppUIMessage =>
    ({ id: 'm', role: 'assistant', parts }) as unknown as AppUIMessage

describe('extractSuggestedMovies', () => {
    it('collects movies from a retrieval tool output (feature)', () => {
        const movies = extractSuggestedMovies(
            assistant([
                { type: 'text', text: 'Here are some picks.' },
                {
                    type: 'tool-search_movies_sql',
                    toolCallId: 't1',
                    state: 'output-available',
                    output: [aMovie(1, 'Dune'), aMovie(2, 'Arrival')],
                },
            ]),
        )
        expect(movies.map((m) => m.title)).toEqual(['Dune', 'Arrival'])
    })

    it('dedupes across multiple tool calls, preserving order (feature)', () => {
        const movies = extractSuggestedMovies(
            assistant([
                {
                    type: 'tool-search_movies_sql',
                    toolCallId: 't1',
                    state: 'output-available',
                    output: [aMovie(1, 'Dune')],
                },
                {
                    type: 'tool-find_similar_movies',
                    toolCallId: 't2',
                    state: 'output-available',
                    output: [aMovie(1, 'Dune'), aMovie(3, 'Sicario')],
                },
            ]),
        )
        expect(movies.map((m) => m.tmdbId)).toEqual([1, 3])
    })

    it('accepts a single-movie details output too (feature)', () => {
        const movies = extractSuggestedMovies(
            assistant([
                {
                    type: 'tool-get_movie_details',
                    toolCallId: 't1',
                    state: 'output-available',
                    output: {
                        ...aMovie(7, 'Tenet'),
                        tagline: null,
                        runtime: 150,
                        voteAverage: 7.3,
                    },
                },
            ]),
        )
        expect(movies.map((m) => m.title)).toEqual(['Tenet'])
    })

    // ── Edge cases ────────────────────────────────────────────────────────
    it('ignores non-movie tool outputs and unresolved calls (edge)', () => {
        const movies = extractSuggestedMovies(
            assistant([
                // A review summary — not a movie.
                {
                    type: 'tool-summarize_reviews',
                    toolCallId: 't1',
                    state: 'output-available',
                    output: { vibe: 'Loved it', pros: [], cons: [] },
                },
                // A still-running search — no output yet.
                { type: 'tool-search_movies_sql', toolCallId: 't2', state: 'input-available' },
            ]),
        )
        expect(movies).toEqual([])
    })

    it('excludes the manage_watchlist tool and user turns (edge)', () => {
        const fromWatchlist = extractSuggestedMovies(
            assistant([
                {
                    type: 'tool-manage_watchlist',
                    toolCallId: 't1',
                    state: 'output-available',
                    output: [aMovie(1, 'Dune')],
                },
            ]),
        )
        expect(fromWatchlist).toEqual([])

        const userTurn = extractSuggestedMovies({
            id: 'u',
            role: 'user',
            parts: [{ type: 'text', text: 'hi' }],
        } as unknown as AppUIMessage)
        expect(userTurn).toEqual([])
    })
})

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
