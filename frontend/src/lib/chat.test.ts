import { afterEach, describe, expect, it } from 'vitest'
import {
    clearStoredConversationId,
    extractSuggestedMovies,
    fetchConversationMessages,
    isToolPart,
    loadStoredConversationId,
    MANAGE_WATCHLIST,
    messageText,
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

    // ── Quality filtering (suggestion-strip cleanup) ──────────────────────────
    it('drops semantic hits below the similarity floor (feature: no junk cards)', () => {
        const movies = extractSuggestedMovies(
            assistant([
                {
                    type: 'tool-semantic_search_tv',
                    toolCallId: 't1',
                    state: 'output-available',
                    output: [
                        { ...aMovie(1, 'House of the Dragon'), mediaType: 'tv', similarity: 0.46 },
                        { ...aMovie(2, 'The Simpsons'), mediaType: 'tv', similarity: 0.17 },
                    ],
                },
            ]),
        )
        // The strong match stays; the 0.17 noise is filtered out.
        expect(movies.map((m) => m.title)).toEqual(['House of the Dragon'])
    })

    it('keeps unscored exact/curated results regardless of floor (edge)', () => {
        const movies = extractSuggestedMovies(
            assistant([
                {
                    type: 'tool-search_tv_sql',
                    toolCallId: 't1',
                    state: 'output-available',
                    output: [{ ...aMovie(1, 'Bones'), mediaType: 'tv' }], // no similarity field
                },
            ]),
        )
        expect(movies.map((m) => m.title)).toEqual(['Bones'])
    })

    it('drops the title the user named in their query (feature: no self-recommend)', () => {
        const movies = extractSuggestedMovies(
            assistant([
                {
                    type: 'tool-semantic_search_tv',
                    toolCallId: 't1',
                    state: 'output-available',
                    output: [
                        { ...aMovie(1, 'Game of Thrones'), mediaType: 'tv', similarity: 0.5 },
                        { ...aMovie(2, 'House of the Dragon'), mediaType: 'tv', similarity: 0.45 },
                    ],
                },
            ]),
            'Best TV shows like Game of Thrones',
        )
        // GoT itself is removed; the genuine suggestion remains.
        expect(movies.map((m) => m.title)).toEqual(['House of the Dragon'])
    })

    it('does not dedupe a movie and a show sharing a tmdb id (edge: cross-media key)', () => {
        const movies = extractSuggestedMovies(
            assistant([
                {
                    type: 'tool-search_movies_sql',
                    toolCallId: 't1',
                    state: 'output-available',
                    output: [aMovie(1396, 'A Movie')],
                },
                {
                    type: 'tool-search_tv_sql',
                    toolCallId: 't2',
                    state: 'output-available',
                    output: [{ ...aMovie(1396, 'A Show'), mediaType: 'tv' }],
                },
            ]),
        )
        expect(movies.map((m) => m.title)).toEqual(['A Movie', 'A Show'])
    })
})

describe('messageText', () => {
    it('joins text parts and ignores tool/reasoning parts (feature)', () => {
        const msg = {
            id: 'u',
            role: 'user',
            parts: [
                { type: 'text', text: 'shows like' },
                { type: 'tool-search_tv_sql', toolCallId: 't', state: 'input-available' },
                { type: 'text', text: 'Game of Thrones' },
            ],
        } as unknown as AppUIMessage
        expect(messageText(msg)).toBe('shows like Game of Thrones')
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

    it('labels the TV retrieval tools distinctly from the movie ones (TV parity)', () => {
        expect(toolLabel('search_tv_sql', false)).toBe('Searching TV shows')
        expect(toolLabel('semantic_search_tv', true)).toBe('Searched TV by theme')
        expect(toolLabel('summarize_tv_reviews', false)).toBe('Summarizing TV reviews')
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
