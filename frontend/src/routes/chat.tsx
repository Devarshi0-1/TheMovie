import { createFileRoute } from '@tanstack/react-router'
import { useEffect, useState } from 'react'
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
        <main className="page chat-page">
            <header className="chat-page__head">
                <div>
                    <h1 className="section-title">Chat</h1>
                    <p className="chat-page__sub">
                        Find films by describing them, get recommendations, and manage your
                        watchlist — conversationally.
                    </p>
                </div>
                <button
                    type="button"
                    className="chat-page__new"
                    onClick={startNewChat}
                    disabled={!conversationId}
                >
                    New chat
                </button>
            </header>
            {/* Keyed by id so "New chat" fully remounts `useChat` with a fresh thread. */}
            {conversationId ? (
                <ChatWindow key={conversationId} conversationId={conversationId} />
            ) : null}
        </main>
    )
}
