import { createUIMessageStream, createUIMessageStreamResponse, type UIMessage } from 'ai'
import { Hono } from 'hono'
import { assistantTextMessage, lastUserMessage, runAgent, textOfMessage } from '../agent/agent'
import { runIntentGate } from '../agent/intent'
import { auth } from '../lib/auth'
import { conversationStore, type ConversationStore } from '../lib/conversation'
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

export interface ChatDeps {
    gate: (query: string) => Promise<GateDecision>
    runAgent: (
        messages: UIMessage[],
        opts?: { userId?: string },
    ) => Promise<{
        toUIMessageStreamResponse: (options?: {
            originalMessages?: UIMessage[]
            generateMessageId?: () => string
            onFinish?: (event: { responseMessage: UIMessage }) => void | Promise<void>
            headers?: Record<string, string>
        }) => Response
    }>
    store: ConversationStore
    generateId: () => string
}

const defaultChatDeps: ChatDeps = {
    gate: runIntentGate,
    runAgent,
    store: conversationStore,
    generateId: () => crypto.randomUUID(),
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
                    deps.store.save(
                        ctx.userId,
                        conversationId,
                        responseMessage.id === clientAssistant.id
                            ? [responseMessage]
                            : [clientAssistant, responseMessage],
                    ),
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

    const conversationId = ctx.conversationId ?? deps.generateId()
    const history = (await deps.store.load(ctx.userId, conversationId)) ?? []

    const decision = await deps.gate(query)
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
            deps.store.save(ctx.userId, conversationId, [userMessage, responseMessage]),
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

const chatRoute = new Hono()

chatRoute.post('/', async (c) => {
    const session = await auth.api.getSession({ headers: c.req.raw.headers })
    if (!session) return c.json({ error: 'Unauthorized' }, 401)

    const body = await c.req.json().catch(() => null)
    const parsed = ChatRequestSchema.safeParse(body)
    if (!parsed.success) {
        return c.json({ error: 'Invalid request body', issues: parsed.error.issues }, 400)
    }

    return handleChat({
        userId: session.user.id,
        conversationId: parsed.data.id,
        messages: parsed.data.messages as UIMessage[],
    })
})

// Restore a conversation's prior turns so the client can resume across sessions.
chatRoute.get('/:conversationId', async (c) => {
    const session = await auth.api.getSession({ headers: c.req.raw.headers })
    if (!session) return c.json({ error: 'Unauthorized' }, 401)

    const conversationId = c.req.param('conversationId')
    const messages = await loadConversationMessages(session.user.id, conversationId)
    return c.json({ id: conversationId, messages })
})

export default chatRoute
