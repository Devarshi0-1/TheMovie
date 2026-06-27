import { useChat } from '@ai-sdk/react'
import { lastAssistantMessageIsCompleteWithToolCalls } from 'ai'
import { useEffect, useRef } from 'react'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { Empty, EmptyContent, EmptyDescription, EmptyHeader } from '@/components/ui/empty'
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
    const { messages, sendMessage, setMessages, status, stop, regenerate, error, addToolResult } =
        useChat<AppUIMessage>({
            // The persisted conversation id (when provided) keys the thread: it's
            // sent in each request body so the backend resumes the same history.
            id: conversationId,
            transport: createChatTransport(),
            // After the user confirms/denies, re-post so the agent sees the result.
            sendAutomaticallyWhen: lastAssistantMessageIsCompleteWithToolCalls,
            // Surface stream failures for observability (the UI shows a retry).
            onError: (err) => console.error('Chat stream error', err),
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
        // The watchlist mutations (and their cache reconciliation) already ran in
        // the confirm UI via the mutation hooks; here we only feed the result back
        // so the agent auto-continues.
        void addToolResult({ tool: MANAGE_WATCHLIST, toolCallId, output })
    }

    // Auto-scroll to the latest turn. The first run (mount / cross-session
    // restore) jumps instantly so it doesn't yank the viewport on initial paint;
    // subsequent appends animate.
    const endRef = useRef<HTMLDivElement>(null)
    const scrolledOnce = useRef(false)
    useEffect(() => {
        endRef.current?.scrollIntoView({ behavior: scrolledOnce.current ? 'smooth' : 'auto' })
        scrolledOnce.current = true
    }, [messages])

    return (
        <div className="flex h-[min(70vh,640px)] flex-col overflow-hidden rounded-2xl border border-border bg-card">
            <div
                className="flex flex-1 flex-col gap-4 overflow-y-auto p-5"
                // Streamed replies are appended async, so announce them politely to
                // screen readers without moving focus (A11Y Project: live regions).
                role="log"
                aria-live="polite"
                aria-label="Conversation"
            >
                {messages.length === 0 ? (
                    <Empty>
                        <EmptyHeader>
                            <EmptyDescription>
                                Ask in plain language — I’ll search the catalog, reason over themes,
                                and help you manage your watchlist.
                            </EmptyDescription>
                        </EmptyHeader>
                        <EmptyContent>
                            <div className="flex flex-wrap justify-center gap-2.5">
                                {SUGGESTIONS.map((text) => (
                                    <Button
                                        key={text}
                                        type="button"
                                        variant="outline"
                                        size="sm"
                                        onClick={() => void sendMessage({ text })}
                                    >
                                        {text}
                                    </Button>
                                ))}
                            </div>
                        </EmptyContent>
                    </Empty>
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
                    <Alert variant="destructive">
                        <AlertTitle>Something went wrong while answering.</AlertTitle>
                        <AlertDescription>
                            <Button
                                type="button"
                                variant="outline"
                                size="sm"
                                onClick={() => void regenerate()}
                            >
                                Retry
                            </Button>
                        </AlertDescription>
                    </Alert>
                )}

                <div ref={endRef} />
            </div>

            <ChatComposer
                onSend={(text) => void sendMessage({ text })}
                streaming={streaming}
                onStop={() => void stop()}
            />
        </div>
    )
}
