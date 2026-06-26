import { useChat } from '@ai-sdk/react'
import { useQueryClient } from '@tanstack/react-query'
import { lastAssistantMessageIsCompleteWithToolCalls } from 'ai'
import { useEffect, useRef } from 'react'
import {
    createChatTransport,
    fetchConversationMessages,
    MANAGE_WATCHLIST,
    type AppUIMessage,
    type ManageWatchlistOutput,
} from '../lib/chat'
import { ChatComposer } from './ChatComposer'
import { ChatMessage } from './ChatMessage'

const SUGGESTIONS = [
    'A movie where the hero later becomes the villain',
    'Slow-burn sci-fi from the 2010s',
    'What should I watch tonight?',
    'Add Inception to my watchlist',
]

/**
 * The chat window. Wires `useChat` to the auth-gated `POST /api/v1/chat`,
 * streams the agent's reply, renders retrieval/tool activity, and drives the
 * HITL watchlist confirmation: when the user approves a `manage_watchlist`
 * proposal, the change is applied via REST (in the confirm UI), the watchlist
 * caches are refreshed, and the result is fed back so the agent auto-continues.
 */
export function ChatWindow({ conversationId }: { conversationId?: string }) {
    const queryClient = useQueryClient()
    const { messages, sendMessage, setMessages, status, stop, regenerate, error, addToolResult } =
        useChat<AppUIMessage>({
            // The persisted conversation id (when provided) keys the thread: it's
            // sent in each request body so the backend resumes the same history.
            id: conversationId,
            transport: createChatTransport(),
            // After the user confirms/denies, re-post so the agent sees the result.
            sendAutomaticallyWhen: lastAssistantMessageIsCompleteWithToolCalls,
        })

    // Cross-session resume: rehydrate this conversation's prior turns on mount.
    // Skipped without an id (e.g. standalone use). `cancelled` ignores a result
    // that arrives after unmount (incl. React's dev double-mount), and the
    // empty-thread check means a turn the user already started is never clobbered.
    useEffect(() => {
        if (!conversationId) return
        let cancelled = false
        void fetchConversationMessages(conversationId)
            .then((prior) => {
                if (!cancelled && prior.length > 0) {
                    setMessages((current) => (current.length === 0 ? prior : current))
                }
            })
            .catch(() => {
                // A failed restore just starts an empty thread.
            })
        return () => {
            cancelled = true
        }
    }, [conversationId, setMessages])

    const streaming = status === 'submitted' || status === 'streaming'

    function handleToolResult(toolCallId: string, output: ManageWatchlistOutput) {
        // The REST mutation already ran inside the confirm UI; keep the watchlist
        // query caches consistent with it.
        if (output.status === 'added' || output.status === 'removed') {
            queryClient.setQueryData(
                ['watchlist', 'status', output.movieId],
                output.status === 'added',
            )
            void queryClient.invalidateQueries({ queryKey: ['watchlist'] })
        }
        void addToolResult({ tool: MANAGE_WATCHLIST, toolCallId, output })
    }

    const endRef = useRef<HTMLDivElement>(null)
    useEffect(() => {
        endRef.current?.scrollIntoView({ behavior: 'smooth' })
    }, [messages])

    return (
        <div className="chat">
            <div className="chat__scroll">
                {messages.length === 0 ? (
                    <div className="chat__empty">
                        <p className="chat__empty-lede">
                            Ask in plain language — I’ll search the catalog, reason over themes, and
                            help you manage your watchlist.
                        </p>
                        <div className="chat__suggestions">
                            {SUGGESTIONS.map((text) => (
                                <button
                                    key={text}
                                    type="button"
                                    className="chat__suggestion"
                                    onClick={() => sendMessage({ text })}
                                >
                                    {text}
                                </button>
                            ))}
                        </div>
                    </div>
                ) : (
                    messages.map((message) => (
                        <ChatMessage
                            key={message.id}
                            message={message}
                            onToolResult={handleToolResult}
                        />
                    ))
                )}

                {error && (
                    <div className="chat__error" role="alert">
                        <span>Something went wrong while answering.</span>
                        <button type="button" onClick={() => void regenerate()}>
                            Retry
                        </button>
                    </div>
                )}

                <div ref={endRef} />
            </div>

            <ChatComposer
                onSend={(text) => sendMessage({ text })}
                streaming={streaming}
                onStop={() => void stop()}
            />
        </div>
    )
}
