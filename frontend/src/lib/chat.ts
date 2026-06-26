import type { ManageWatchlistInput } from '@themovie/schemas'
import { DefaultChatTransport, type UIDataTypes, type UIMessage } from 'ai'
import { API_BASE, apiFetch } from './api'

// The chat agent is hosted at POST /api/v1/chat and is auth-gated, so the
// transport sends the session cookie. `useChat` posts the full thread; the
// backend streams a UI-message response (and a refusal arrives as plain text).
export function createChatTransport() {
    return new DefaultChatTransport<AppUIMessage>({
        api: `${API_BASE}/api/v1/chat`,
        credentials: 'include',
    })
}

// The one human-in-the-loop tool: the model proposes a watchlist change and the
// user confirms before anything happens. Typing the message with this tool lets
// `addToolResult` accept the tool name + a well-formed output.
export const MANAGE_WATCHLIST = 'manage_watchlist'

export interface ManageWatchlistOutput {
    status: 'added' | 'removed' | 'declined'
    movieId: number
    title?: string
}

export interface AppUITools {
    manage_watchlist: { input: ManageWatchlistInput; output: ManageWatchlistOutput }
    [tool: string]: { input: unknown; output: unknown }
}

export type AppUIMessage = UIMessage<unknown, UIDataTypes, AppUITools>

// ── Message-part helpers ────────────────────────────────────────────────────
// Tool parts arrive as `{ type: 'tool-<name>' | 'dynamic-tool', toolCallId,
// state, input, output, errorText }`. We narrow them loosely (the default part
// typing is wide) so rendering can branch on tool name + state.

export interface ToolPartLike {
    type: string
    toolCallId: string
    state: string
    input?: unknown
    output?: unknown
    errorText?: string
    toolName?: string
}

export function isToolPart(part: { type: string }): part is ToolPartLike {
    return (
        typeof part.type === 'string' &&
        (part.type.startsWith('tool-') || part.type === 'dynamic-tool')
    )
}

export function toolNameOf(part: ToolPartLike): string {
    if (part.type === 'dynamic-tool') return part.toolName ?? 'tool'
    return part.type.slice('tool-'.length)
}

// Friendly running/done labels for the retrieval + read tools, shown as a small
// activity trail so the user sees the agent escalating across tiers.
export const TOOL_LABELS: Record<string, { running: string; done: string }> = {
    search_movies_sql: { running: 'Searching the catalog', done: 'Searched the catalog' },
    semantic_search_movies: { running: 'Searching by theme', done: 'Searched by theme' },
    fetch_from_tmdb: { running: 'Checking TMDB', done: 'Checked TMDB' },
    get_movie_details: { running: 'Fetching details', done: 'Fetched details' },
    get_trending: { running: 'Loading what’s trending', done: 'Loaded trending' },
    summarize_reviews: { running: 'Summarizing reviews', done: 'Summarized reviews' },
    get_user_watchlist: { running: 'Reading your watchlist', done: 'Read your watchlist' },
    get_recommendations: { running: 'Building recommendations', done: 'Built recommendations' },
}

export function toolLabel(name: string, done: boolean): string {
    const labels = TOOL_LABELS[name]
    if (labels) return done ? labels.done : labels.running
    const pretty = name.replace(/_/g, ' ')
    return done ? `Ran ${pretty}` : `Running ${pretty}`
}

// ── Cross-session resume ────────────────────────────────────────────────────
// The conversation id is generated client-side and sent on every turn —
// `DefaultChatTransport` puts the chat `id` in the request body, and the backend
// keys per-user history by it — so persisting the id lets a reload continue the
// same server-side thread. The prior turns are rehydrated via the GET endpoint.

const CONVERSATION_STORAGE_KEY = 'themovie:chat:conversation-id'

/** A fresh conversation id. */
export function newConversationId(): string {
    return crypto.randomUUID()
}

/** The persisted conversation id, or null (no window / unset / storage blocked). */
export function loadStoredConversationId(): string | null {
    if (typeof window === 'undefined') return null
    try {
        return window.localStorage.getItem(CONVERSATION_STORAGE_KEY)
    } catch {
        return null
    }
}

/** Persist the conversation id so a reload resumes the same thread. */
export function storeConversationId(id: string): void {
    if (typeof window === 'undefined') return
    try {
        window.localStorage.setItem(CONVERSATION_STORAGE_KEY, id)
    } catch {
        // Storage may be unavailable (private mode / quota) — resume just degrades.
    }
}

/** Forget the current conversation (used by "New chat"). */
export function clearStoredConversationId(): void {
    if (typeof window === 'undefined') return
    try {
        window.localStorage.removeItem(CONVERSATION_STORAGE_KEY)
    } catch {
        // ignore
    }
}

/**
 * Restore a conversation's prior turns from the backend. Auth + ownership are
 * checked server-side, so an unknown or foreign id yields []. Used to rehydrate
 * the chat window after a reload.
 */
export async function fetchConversationMessages(id: string): Promise<AppUIMessage[]> {
    const data = await apiFetch<{ id: string; messages: AppUIMessage[] }>(
        `/api/v1/chat/${encodeURIComponent(id)}`,
    )
    return data.messages ?? []
}
