import { useChat } from '@ai-sdk/react'
import { QueryClientProvider } from '@tanstack/react-query'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { fetchConversationMessages } from '../lib/chat'
import { makeTestQueryClient } from '../test/providers'
import { ChatWindow } from './ChatWindow'

vi.mock('@ai-sdk/react', () => ({ useChat: vi.fn() }))

// Keep the real chat helpers (transport, labels, …) but stub the history fetch
// so the cross-session restore can be driven without a backend.
vi.mock('../lib/chat', async (importOriginal) => {
    const actual = await importOriginal<typeof import('../lib/chat')>()
    return { ...actual, fetchConversationMessages: vi.fn().mockResolvedValue([]) }
})

// ChatWindow only needs a QueryClient (no router), so render it directly for a
// synchronous mount.
function renderChat() {
    return render(
        <QueryClientProvider client={makeTestQueryClient()}>
            <ChatWindow />
        </QueryClientProvider>,
    )
}

type ChatReturn = ReturnType<typeof useChat>

function mockChat(over: Partial<ChatReturn>): ChatReturn {
    return {
        messages: [],
        sendMessage: vi.fn(),
        setMessages: vi.fn(),
        status: 'ready',
        stop: vi.fn(),
        regenerate: vi.fn(),
        error: undefined,
        addToolResult: vi.fn(),
        ...over,
    } as unknown as ChatReturn
}

function jsonResponse(body: unknown, status = 200) {
    return new Response(JSON.stringify(body), {
        status,
        headers: { 'Content-Type': 'application/json' },
    })
}

afterEach(() => {
    vi.unstubAllGlobals()
    vi.clearAllMocks()
})

describe('<ChatWindow />', () => {
    // ── Feature / happy path ──────────────────────────────────────────────
    it('shows suggestion chips when empty and sends one on click', () => {
        const sendMessage = vi.fn()
        vi.mocked(useChat).mockReturnValue(mockChat({ messages: [], sendMessage }))
        renderChat()

        const chip = screen.getByRole('button', { name: 'What should I watch tonight?' })
        fireEvent.click(chip)
        expect(sendMessage).toHaveBeenCalledWith({ text: 'What should I watch tonight?' })
    })

    it('renders the conversation messages', () => {
        vi.mocked(useChat).mockReturnValue(
            mockChat({
                messages: [
                    { id: 'u1', role: 'user', parts: [{ type: 'text', text: 'hi' }] },
                    { id: 'a1', role: 'assistant', parts: [{ type: 'text', text: 'hello there' }] },
                ] as never,
            }),
        )
        renderChat()
        expect(screen.getByText('hi')).toBeInTheDocument()
        expect(screen.getByText('hello there')).toBeInTheDocument()
    })

    // ── HITL wiring ───────────────────────────────────────────────────────
    it('approving a watchlist proposal applies it and feeds the result back via addToolResult', async () => {
        vi.stubGlobal(
            'fetch',
            vi.fn(() => jsonResponse({ added: true, movieId: 27205 }, 201)),
        )
        const addToolResult = vi.fn()
        vi.mocked(useChat).mockReturnValue(
            mockChat({
                addToolResult,
                messages: [
                    {
                        id: 'a1',
                        role: 'assistant',
                        parts: [
                            {
                                type: 'tool-manage_watchlist',
                                toolCallId: 'tc1',
                                state: 'input-available',
                                input: {
                                    action: 'add',
                                    movies: [{ movieId: 27205, title: 'Inception' }],
                                },
                            },
                        ],
                    },
                ] as never,
            }),
        )
        renderChat()

        fireEvent.click(screen.getByRole('button', { name: 'Yes, add it' }))
        await waitFor(() =>
            expect(addToolResult).toHaveBeenCalledWith({
                tool: 'manage_watchlist',
                toolCallId: 'tc1',
                output: { status: 'added', movies: [{ movieId: 27205, title: 'Inception' }] },
            }),
        )
    })

    // ── Cross-session resume ──────────────────────────────────────────────
    it('restores the prior turns on mount when given a conversation id (feature)', async () => {
        const prior = [{ id: 'p1', role: 'user', parts: [{ type: 'text', text: 'earlier' }] }]
        vi.mocked(fetchConversationMessages).mockResolvedValue(prior as never)
        const setMessages = vi.fn()
        vi.mocked(useChat).mockReturnValue(mockChat({ messages: [], setMessages }))

        render(
            <QueryClientProvider client={makeTestQueryClient()}>
                <ChatWindow conversationId="conv-1" />
            </QueryClientProvider>,
        )

        await waitFor(() => expect(fetchConversationMessages).toHaveBeenCalledWith('conv-1'))
        await waitFor(() => expect(setMessages).toHaveBeenCalled())
        // Restores via the updater form, replacing only an empty thread.
        const updater = setMessages.mock.calls[0]![0] as (m: unknown[]) => unknown[]
        expect(updater([])).toEqual(prior)
    })

    it('does not fetch history without a conversation id (edge)', () => {
        vi.mocked(useChat).mockReturnValue(mockChat({}))
        renderChat() // <ChatWindow /> with no id
        expect(fetchConversationMessages).not.toHaveBeenCalled()
    })

    // ── Edge cases ────────────────────────────────────────────────────────
    it('surfaces an error with a retry that regenerates', () => {
        const regenerate = vi.fn()
        vi.mocked(useChat).mockReturnValue(mockChat({ error: new Error('boom'), regenerate }))
        renderChat()
        fireEvent.click(screen.getByRole('button', { name: 'Retry' }))
        expect(regenerate).toHaveBeenCalledOnce()
    })
})
