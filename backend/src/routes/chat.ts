import { createUIMessageStream, createUIMessageStreamResponse, type UIMessage } from 'ai'
import { Hono } from 'hono'
import { assistantTextMessage, lastUserMessage, runAgent, textOfMessage } from '../agent/agent'
import { runIntentGate } from '../agent/intent'
import { conversationStore, type ConversationStore } from '../lib/conversation'
import { requireAuth, type AuthVariables } from '../middleware/auth'
import { ChatRequestSchema } from '@themovie/schemas'
import type { GateDecision } from '@themovie/schemas'

// Split text into small streaming chunks — words with their trailing whitespace —
// so a canned refusal can be emitted token-by-token, the way the agent's real
// answers stream, instead of arriving in a single block.
export function splitIntoStreamChunks(text: string): string[] {
    return text.match(/\S+\s*/g) ?? (text ? [text] : [])
}

const sleep = (ms: number): Promise<void> =>
    ms > 0 ? new Promise((resolve) => setTimeout(resolve, ms)) : Promise.resolve()

// Per-chunk delay for the streamed refusal, read at call time so tests can zero
// it via REFUSAL_STREAM_DELAY_MS. A small delay makes the tokens flush separately
// so the client renders them progressively rather than all at once.
function refusalStreamDelayMs(): number {
    const raw = Number(process.env.REFUSAL_STREAM_DELAY_MS)
    return Number.isFinite(raw) && raw >= 0 ? raw : 18
}

// Stream the intent-gate refusal as a UI message stream, emitted token-by-token
// so `useChat` renders it progressively — exactly like a normal reply — without
// ever invoking the multi-step agent loop. Carries the conversation id back so
// the client can continue the thread.
function refusalResponse(text: string, conversationId?: string): Response {
    const delay = refusalStreamDelayMs()
    const stream = createUIMessageStream({
        execute: async ({ writer }) => {
            const id = 'refusal'
            writer.write({ type: 'text-start', id })
            for (const chunk of splitIntoStreamChunks(text)) {
                writer.write({ type: 'text-delta', id, delta: chunk })
                await sleep(delay)
            }
            writer.write({ type: 'text-end', id })
        },
    })
    return createUIMessageStreamResponse({
        stream,
        headers: conversationId ? { 'X-Conversation-Id': conversationId } : undefined,
    })
}

export interface ChatContext {
    userId: string
    conversationId?: string
    messages: UIMessage[]
}

// A tool UI part the client has already resolved (approved/denied → output, or
// errored). The HITL `manage_watchlist` tool has no server `execute`, so after
// the user confirms, the client adds the result and re-POSTs the thread.
function isResolvedToolPart(part: { type?: unknown; state?: unknown }): boolean {
    const type = typeof part.type === 'string' ? part.type : ''
    const isTool = type.startsWith('tool-') || type === 'dynamic-tool'
    return isTool && (part.state === 'output-available' || part.state === 'output-error')
}

/**
 * True when the latest message is an assistant turn carrying a resolved tool
 * result — i.e. a HITL continuation, not a fresh user query. These must run the
 * agent over the client's messages (so the model sees the tool output) and skip
 * the intent gate (no new user turn to classify).
 */
export function isToolResultContinuation(messages: UIMessage[]): boolean {
    const last = messages[messages.length - 1]
    return (
        !!last &&
        last.role === 'assistant' &&
        (last.parts ?? []).some((p) => isResolvedToolPart(p as { type?: unknown; state?: unknown }))
    )
}

function hasPendingToolCall(message: UIMessage): boolean {
    return (message.parts ?? []).some((p) => {
        const part = p as { type?: unknown; state?: unknown }
        const type = typeof part.type === 'string' ? part.type : ''
        const isTool = type.startsWith('tool-') || type === 'dynamic-tool'
        return isTool && part.state === 'input-available'
    })
}

/**
 * Guard against a forged continuation: a continuation is only genuine when the
 * client's last assistant message resolves a tool call the SERVER actually
 * proposed — i.e. a persisted assistant message with the same id is still
 * awaiting a tool result (`input-available`). History is server-trusted (only we
 * write assistant rows), so a fabricated assistant message can't match, and the
 * request falls through to the gated path instead of skipping the intent gate.
 */
function isGenuineContinuation(history: UIMessage[], clientAssistant: UIMessage): boolean {
    const persisted = history.find((m) => m.id === clientAssistant.id)
    return !!persisted && hasPendingToolCall(persisted)
}

// Apply the client's resolved tool outputs onto the server-trusted history:
// each history message is replaced by the client's same-id copy (which carries
// the freshly resolved tool result) and any client message NOT already in
// history is dropped — so a continuation can update tool outputs but never
// inject new turns past the gate.
function mergeResolvedToolResults(history: UIMessage[], incoming: UIMessage[]): UIMessage[] {
    const incomingById = new Map(incoming.map((m) => [m.id, m]))
    return history.map((m) => incomingById.get(m.id) ?? m)
}

// Prior-turn window fed to the intent gate as reference context (BAG-1). Kept
// small in both count and per-message length so the gate stays a cheap classifier
// and a stale/long turn can't bloat the prompt.
const GATE_CONTEXT_MESSAGES = 4
const GATE_CONTEXT_CHARS_PER_MESSAGE = 240

/**
 * A compact, role-tagged window of the most recent prior turns, passed to the
 * intent gate so a context-dependent follow-up ("tell me more about the second
 * one", "add that to my list") is classified relevant instead of being hard-
 * blocked as off-topic (BAG-1). Returns undefined when there's no usable text
 * history, so a first turn behaves exactly as before.
 */
export function buildGateContext(history: UIMessage[]): string | undefined {
    const lines: string[] = []
    for (const message of history.slice(-GATE_CONTEXT_MESSAGES)) {
        const text = textOfMessage(message).replace(/\s+/g, ' ').trim()
        if (!text) continue
        const clipped =
            text.length > GATE_CONTEXT_CHARS_PER_MESSAGE ?
                text.slice(0, GATE_CONTEXT_CHARS_PER_MESSAGE) + '…'
            :   text
        lines.push(`${message.role === 'assistant' ? 'assistant' : 'user'}: ${clipped}`)
    }
    return lines.length ? lines.join('\n') : undefined
}

export interface ChatDeps {
    gate: (query: string, context?: string) => Promise<GateDecision>
    runAgent: (
        messages: UIMessage[],
        opts?: { userId?: string },
    ) => Promise<{
        toUIMessageStreamResponse: (options?: {
            originalMessages?: UIMessage[]
            generateMessageId?: () => string
            onFinish?: (event: { responseMessage: UIMessage }) => void | Promise<void>
            onError?: (error: unknown) => string
            headers?: Record<string, string>
        }) => Response
    }>
    store: ConversationStore
    generateId: () => string
}

const STREAM_ERROR_MESSAGE = 'Something went wrong while answering. Please try again.'

// In-loop tool/model failures reach the stream; log them server-side (otherwise
// they're masked) and surface a friendly line to the client. (BAG-2/BERR-2.)
function onStreamError(error: unknown): string {
    console.error('Agent stream error:', error)
    return STREAM_ERROR_MESSAGE
}

// Persist a turn from the stream's onFinish without letting a DB blip throw into
// the stream lifecycle (which would drop the save silently). (BERR-3.)
function persistTurn(
    store: ConversationStore,
    userId: string,
    conversationId: string,
    messages: UIMessage[],
): Promise<void> {
    return store.save(userId, conversationId, messages).catch((err) => {
        console.error('Failed to persist chat turn:', err)
    })
}

const defaultChatDeps: ChatDeps = {
    // Bind the gate to its default classifier deps, exposing only (query, context).
    gate: (query, context) => runIntentGate(query, undefined, context),
    runAgent,
    store: conversationStore,
    generateId: () => crypto.randomUUID(),
}

/**
 * The conversation id to use for this turn: the client's requested id when it's
 * new or already theirs, otherwise a freshly generated one. A request carrying
 * SOMEONE ELSE'S id therefore starts a new thread for the requester instead of
 * erroring (the ownership guard in `store.save` would otherwise throw a 500) —
 * and it never reads or writes that other user's conversation.
 */
export async function resolveConversationId(
    store: ConversationStore,
    userId: string,
    requested: string | undefined,
    generateId: () => string,
): Promise<string> {
    if (!requested) return generateId()
    const owner = await store.ownerOf(requested)
    return owner === null || owner === userId ? requested : generateId()
}

/**
 * The chat pipeline as plain control flow with multi-turn memory: load prior
 * turns → intent gate (cheap guardrail) → agent loop over the full
 * conversation → persist the new turn via the stream's onFinish. Blocked/empty
 * queries get a streamed refusal and never reach the expensive model. IO
 * injected for testing.
 */
export async function handleChat(
    ctx: ChatContext,
    deps: ChatDeps = defaultChatDeps,
): Promise<Response> {
    // HITL continuation: the client just confirmed/denied a tool call and
    // re-posted the thread with the tool result attached. Only take this path
    // when it resolves a tool call the server genuinely proposed (verified
    // against trusted, owned history) — otherwise fall through to the gated path
    // so a forged "continuation" can't skip the intent gate. We need the
    // conversation id (always present on a real continuation) to load history.
    const clientAssistant = ctx.messages[ctx.messages.length - 1]
    if (isToolResultContinuation(ctx.messages) && clientAssistant && ctx.conversationId) {
        const conversationId = ctx.conversationId
        const history = (await deps.store.load(ctx.userId, conversationId)) ?? []
        if (isGenuineContinuation(history, clientAssistant)) {
            const messages = mergeResolvedToolResults(history, ctx.messages)
            const result = await deps.runAgent(messages, { userId: ctx.userId })
            return result.toUIMessageStreamResponse({
                originalMessages: ctx.messages,
                generateMessageId: deps.generateId,
                // Persist the now-resolved assistant turn (heals the dangling
                // tool call in storage) plus the new confirmation reply.
                onFinish: ({ responseMessage }) =>
                    persistTurn(
                        deps.store,
                        ctx.userId,
                        conversationId,
                        responseMessage.id === clientAssistant.id ?
                            [responseMessage]
                        :   [clientAssistant, responseMessage],
                    ),
                onError: onStreamError,
                headers: { 'X-Conversation-Id': conversationId },
            })
        }
        // Not genuine → fall through to the gated path below.
    }

    const userMessage = lastUserMessage(ctx.messages)
    const query = userMessage ? textOfMessage(userMessage) : ''
    if (!userMessage || !query) {
        return refusalResponse('Tell me what you feel like watching and I’ll find something.')
    }

    const conversationId = await resolveConversationId(
        deps.store,
        ctx.userId,
        ctx.conversationId,
        deps.generateId,
    )
    const history = (await deps.store.load(ctx.userId, conversationId)) ?? []

    const decision = await deps.gate(query, buildGateContext(history))
    if (!decision.allowed) {
        const refusal = decision.refusal ?? 'I can only help with movies and watchlists.'
        // Persist the turn so the thread stays coherent on resume.
        await deps.store.save(ctx.userId, conversationId, [
            userMessage,
            assistantTextMessage(deps.generateId(), refusal),
        ])
        return refusalResponse(refusal, conversationId)
    }

    const result = await deps.runAgent([...history, userMessage], { userId: ctx.userId })
    return result.toUIMessageStreamResponse({
        originalMessages: [...history, userMessage],
        generateMessageId: deps.generateId,
        // Persist the new user message + the assistant reply once streaming ends.
        onFinish: ({ responseMessage }) =>
            persistTurn(deps.store, ctx.userId, conversationId, [userMessage, responseMessage]),
        onError: onStreamError,
        headers: { 'X-Conversation-Id': conversationId },
    })
}

/**
 * Prior messages for an owned conversation, used to restore the thread on a
 * cross-session reload. Returns [] when the id is unknown or owned by another
 * user — `store.load` is ownership-checked, so this never leaks another user's
 * history. Store injected for testing.
 */
export async function loadConversationMessages(
    userId: string,
    conversationId: string,
    store: ConversationStore = conversationStore,
): Promise<UIMessage[]> {
    return (await store.load(userId, conversationId)) ?? []
}

const chatRoute = new Hono<{ Variables: AuthVariables }>()
chatRoute.use('*', requireAuth)

chatRoute.post('/', async (c) => {
    const body = await c.req.json().catch(() => null)
    const parsed = ChatRequestSchema.safeParse(body)
    if (!parsed.success) {
        return c.json({ error: 'Invalid request body', issues: parsed.error.issues }, 400)
    }

    return handleChat({
        userId: c.get('userId'),
        conversationId: parsed.data.id,
        messages: parsed.data.messages as UIMessage[],
    })
})

// Restore a conversation's prior turns so the client can resume across sessions.
chatRoute.get('/:conversationId', async (c) => {
    const conversationId = c.req.param('conversationId')
    // Bounded shape check (ids are client-generated UUIDs); an odd value just
    // resolves to an empty thread via the ownership-scoped load.
    if (conversationId.length < 1 || conversationId.length > 100) {
        return c.json({ id: conversationId, messages: [] })
    }
    const messages = await loadConversationMessages(c.get('userId'), conversationId)
    return c.json({ id: conversationId, messages })
})

export default chatRoute
