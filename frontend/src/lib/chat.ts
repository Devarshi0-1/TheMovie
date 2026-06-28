import {
    MovieResultSchema,
    SEMANTIC_MATCH_FLOOR,
    type ManageWatchlistInput,
    type MovieResult,
} from '@themovie/schemas'
import { DefaultChatTransport, type UIDataTypes, type UIMessage } from 'ai'
import { z } from 'zod'
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

export interface ManageWatchlistMovie {
    movieId: number
    title?: string
}

export interface ManageWatchlistOutput {
    // `partial` = some of a batch succeeded; the agent reports it and can offer
    // to retry the rest. `movies` is the set that succeeded (or, for `declined`,
    // the proposed set); `failed` is present only for `partial`.
    status: 'added' | 'removed' | 'declined' | 'partial'
    action?: 'add' | 'remove'
    movies: ManageWatchlistMovie[]
    failed?: ManageWatchlistMovie[]
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
    find_similar_movies: { running: 'Finding similar movies', done: 'Found similar movies' },
    // TV parity (Phase 10.4) — same trail, over the TV catalog.
    search_tv_sql: { running: 'Searching TV shows', done: 'Searched TV shows' },
    semantic_search_tv: { running: 'Searching TV by theme', done: 'Searched TV by theme' },
    fetch_tv_from_tmdb: { running: 'Checking TMDB for TV', done: 'Checked TMDB for TV' },
    get_trending_tv: { running: 'Loading trending TV', done: 'Loaded trending TV' },
    summarize_tv_reviews: { running: 'Summarizing TV reviews', done: 'Summarized TV reviews' },
    find_similar_tv: { running: 'Finding similar shows', done: 'Found similar shows' },
}

export function toolLabel(name: string, done: boolean): string {
    const labels = TOOL_LABELS[name]
    if (labels) return done ? labels.done : labels.running
    const pretty = name.replace(/_/g, ' ')
    return done ? `Ran ${pretty}` : `Running ${pretty}`
}

// ── Suggested movies (chat result cards) ─────────────────────────────────────
// The retrieval tools (search/semantic/tmdb/person/similar/trending/details)
// return titles as their tool output. We harvest those so the chat can render
// the agent's picks as clickable cards instead of leaving them buried in prose.
// Non-title tool outputs (review summaries, watch providers) simply don't parse
// as a title and are skipped; manage_watchlist is excluded explicitly.

// Keep `similarity` when present (semantic-search hits carry it) so the strip can
// drop weak matches; the plain MovieResultSchema would silently strip it.
const SuggestedMovieSchema = MovieResultSchema.extend({ similarity: z.number().optional() })
type SuggestedMovie = z.infer<typeof SuggestedMovieSchema>
const SuggestedArraySchema = z.array(SuggestedMovieSchema)
const SUGGESTED_MOVIES_CAP = 12

function moviesFromOutput(output: unknown): SuggestedMovie[] {
    const asArray = SuggestedArraySchema.safeParse(output)
    if (asArray.success) return asArray.data
    const asSingle = SuggestedMovieSchema.safeParse(output)
    return asSingle.success ? [asSingle.data] : []
}

/** Concatenate a message's text parts (ignoring tool/reasoning/file parts). */
export function messageText(message: AppUIMessage): string {
    return message.parts
        .filter(
            (p): p is { type: 'text'; text: string } =>
                p.type === 'text' && typeof (p as { text?: unknown }).text === 'string',
        )
        .map((p) => p.text)
        .join(' ')
        .trim()
}

/** Dedupe key: a film and a show can share a TMDB id, so scope it by media. */
const suggestionKey = (m: MovieResult) => `${m.mediaType ?? 'movie'}:${m.tmdbId}`

/**
 * True when a result is the very title the user named in their query (e.g. a
 * "shows like Game of Thrones" search returning Game of Thrones itself). We drop
 * those — recommending back the thing they asked about is noise. Matched as a
 * normalized substring so "game of thrones" in the query catches the card.
 */
function isNamedInQuery(title: string, query: string | undefined): boolean {
    if (!query) return false
    const norm = (s: string) => s.toLowerCase().replace(/\s+/g, ' ').trim()
    const t = norm(title)
    // Guard against trivially-short titles matching half the sentence.
    return t.length >= 3 && norm(query).includes(t)
}

/**
 * The distinct titles an assistant turn surfaced across its tool calls, in call
 * order, deduped by (mediaType, tmdbId) and capped. Filters out (1) weak
 * semantic matches below the shared similarity floor and (2) the title the user
 * named in `queryText`, so the card strip shows real, non-redundant suggestions
 * rather than the raw retrieval set. Empty for user turns or a turn that ran no
 * title-returning tool — so the caller renders the strip only when there's
 * something worth showing.
 */
export function extractSuggestedMovies(message: AppUIMessage, queryText?: string): MovieResult[] {
    if (message.role !== 'assistant') return []

    const seen = new Set<string>()
    const out: MovieResult[] = []
    for (const part of message.parts) {
        if (!isToolPart(part) || part.state !== 'output-available') continue
        if (toolNameOf(part) === MANAGE_WATCHLIST) continue
        for (const movie of moviesFromOutput(part.output)) {
            if (out.length >= SUGGESTED_MOVIES_CAP) break
            // Drop weak semantic hits; unscored (exact/curated/trending) results
            // have no `similarity` and always pass.
            if (typeof movie.similarity === 'number' && movie.similarity < SEMANTIC_MATCH_FLOOR)
                continue
            if (isNamedInQuery(movie.title, queryText)) continue
            const key = suggestionKey(movie)
            if (seen.has(key)) continue
            seen.add(key)
            // Strip the internal `similarity` field from the card model.
            const { similarity: _omit, ...card } = movie
            out.push(card)
        }
    }
    return out
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

// The restore response: validate the envelope (id + an array of message-shaped
// objects) rather than trusting it blindly. Parts stay permissive — the UI
// message-part union is wide — but every entry must at least look like a turn.
const ConversationMessageSchema = z
    .object({ id: z.string(), role: z.string(), parts: z.array(z.unknown()) })
    .loose()
const ConversationRestoreSchema = z.object({
    id: z.string(),
    messages: z.array(ConversationMessageSchema).default([]),
})

/**
 * Restore a conversation's prior turns from the backend. Auth + ownership are
 * checked server-side, so an unknown or foreign id yields []. Used to rehydrate
 * the chat window after a reload. The response envelope is validated; a
 * malformed body throws (the caller degrades to an empty thread).
 */
export async function fetchConversationMessages(id: string): Promise<AppUIMessage[]> {
    const data = ConversationRestoreSchema.parse(
        await apiFetch(`/api/v1/chat/${encodeURIComponent(id)}`),
    )
    return data.messages as unknown as AppUIMessage[]
}
