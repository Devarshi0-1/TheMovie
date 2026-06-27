import { useChat } from '@ai-sdk/react'
import { lastAssistantMessageIsCompleteWithToolCalls } from 'ai'
import { useEffect } from 'react'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { Empty, EmptyContent, EmptyDescription, EmptyHeader } from '@/components/ui/empty'
import { Marker, MarkerContent, MarkerIcon } from '@/components/ui/marker'
import {
    MessageScroller,
    MessageScrollerButton,
    MessageScrollerContent,
    MessageScrollerItem,
    MessageScrollerProvider,
    MessageScrollerViewport,
} from '@/components/ui/message-scroller'
import { Spinner } from '@/components/ui/spinner'
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
 *
 * The transcript is built on the shadcn `MessageScroller`: it anchors each user
 * turn, sticks to the live edge as replies stream (`autoScroll`), fades the top
 * edge as a scroll hint (`scroll-fade`), and surfaces a jump-to-latest button
 * when the user scrolls up — replacing the previous hand-rolled scroll effect.
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

    return (
        <div className="flex h-[min(70vh,640px)] flex-col overflow-hidden rounded-2xl border border-border bg-card">
            <MessageScrollerProvider autoScroll defaultScrollPosition="last-anchor">
                <MessageScroller className="flex-1">
                    <MessageScrollerViewport
                        className="p-5"
                        // Streamed replies are appended async, so announce them
                        // politely to screen readers without moving focus (A11Y
                        // Project: live regions).
                        role="log"
                        aria-live="polite"
                        aria-label="Conversation"
                    >
                        <MessageScrollerContent>
                            {messages.length === 0 ? (
                                <Empty>
                                    <EmptyHeader>
                                        <EmptyDescription>
                                            Ask in plain language — I’ll search the catalog, reason
                                            over themes, and help you manage your watchlist.
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
                                    // Anchor each user turn so the viewport opens on
                                    // the latest exchange and streamed replies stay
                                    // pinned to the live edge.
                                    <MessageScrollerItem
                                        key={message.id}
                                        messageId={message.id}
                                        scrollAnchor={message.role === 'user'}
                                    >
                                        <ChatMessage
                                            message={message}
                                            onToolResult={handleToolResult}
                                        />
                                    </MessageScrollerItem>
                                ))
                            )}

                            {/* Pre-token "Thinking…" cue: the agent has the request
                                but hasn't streamed any part yet. */}
                            {status === 'submitted' && (
                                <Marker className="px-3">
                                    <MarkerIcon>
                                        <Spinner />
                                    </MarkerIcon>
                                    <MarkerContent className="shimmer">Thinking…</MarkerContent>
                                </Marker>
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
                        </MessageScrollerContent>
                    </MessageScrollerViewport>

                    <MessageScrollerButton />
                </MessageScroller>
            </MessageScrollerProvider>

            <ChatComposer
                onSend={(text) => void sendMessage({ text })}
                streaming={streaming}
                onStop={() => void stop()}
            />
        </div>
    )
}
