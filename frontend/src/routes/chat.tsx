import { createFileRoute } from '@tanstack/react-router'
import { ChatWindow } from '../components/ChatWindow'
import { RequireAuth } from '../components/RequireAuth'

export const Route = createFileRoute('/chat')({
    component: ChatRoute,
})

function ChatRoute() {
    // The chat endpoint is auth-gated (the agent's tools are bound to the user),
    // so the screen requires a session. `useChat` is client-only, which suits the
    // client-side guard.
    return (
        <RequireAuth redirect="/chat">
            <main className="page chat-page">
                <header className="chat-page__head">
                    <h1 className="section-title">Chat</h1>
                    <p className="chat-page__sub">
                        Find films by describing them, get recommendations, and manage your
                        watchlist — conversationally.
                    </p>
                </header>
                <ChatWindow />
            </main>
        </RequireAuth>
    )
}
