import { createFileRoute } from '@tanstack/react-router'
import { useEffect, useState } from 'react'
import { Button } from '@/components/ui/button'
import { ChatWindow } from '../components/ChatWindow'
import { requireSession } from '../lib/auth'
import { loadStoredConversationId, newConversationId, storeConversationId } from '../lib/chat'

export const Route = createFileRoute('/chat')({
    // The chat endpoint is auth-gated (the agent's tools are bound to the user).
    // Guard before the component renders — cache-first, no flash of protected UI.
    beforeLoad: ({ context, location }) => requireSession(context.queryClient, location.href),
    component: ChatScreen,
})

function ChatScreen() {
    // Resolve a stable conversation id on the client (localStorage isn't readable
    // during SSR), generating + persisting one on first visit. Persisting it is
    // what makes a reload resume the same thread — ChatWindow restores the turns.
    const [conversationId, setConversationId] = useState<string | null>(null)
    useEffect(() => {
        let id = loadStoredConversationId()
        if (!id) {
            id = newConversationId()
            storeConversationId(id)
        }
        setConversationId(id)
    }, [])

    function startNewChat() {
        const id = newConversationId()
        storeConversationId(id)
        setConversationId(id)
    }

    return (
        <main className="mx-auto w-full max-w-[1100px] px-6 py-10">
            <header className="mb-5 flex items-start justify-between gap-4">
                <div>
                    <h1 className="text-xl font-semibold tracking-tight">Chat</h1>
                    <p className="mt-1 text-muted-foreground">
                        Find films by describing them, get recommendations, and manage your
                        watchlist — conversationally.
                    </p>
                </div>
                <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    className="shrink-0"
                    onClick={startNewChat}
                    disabled={!conversationId}
                >
                    New chat
                </Button>
            </header>
            {/* Keyed by id so "New chat" fully remounts `useChat` with a fresh thread. */}
            {conversationId ? (
                <ChatWindow key={conversationId} conversationId={conversationId} />
            ) : null}
        </main>
    )
}
