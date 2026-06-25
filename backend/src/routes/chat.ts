import { createUIMessageStream, createUIMessageStreamResponse, type UIMessage } from 'ai'
import { Hono } from 'hono'
import { assistantTextMessage, lastUserMessage, runAgent, textOfMessage } from '../agent/agent'
import { runIntentGate } from '../agent/intent'
import { auth } from '../lib/auth'
import { conversationStore, type ConversationStore } from '../lib/conversation'
import { ChatRequestSchema } from '../schemas/chat'
import type { GateDecision } from '../schemas/intent'

// Stream a single assistant text message (the intent-gate refusal) as a UI
// message stream, so `useChat` renders it exactly like a normal reply — without
// ever invoking the expensive gpt-5 loop. Carries the conversation id back so
// the client can continue the thread.
function refusalResponse(text: string, conversationId?: string): Response {
    const stream = createUIMessageStream({
        execute: ({ writer }) => {
            const id = 'refusal'
            writer.write({ type: 'text-start', id })
            writer.write({ type: 'text-delta', id, delta: text })
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

export interface ChatDeps {
    gate: (query: string) => Promise<GateDecision>
    runAgent: (messages: UIMessage[]) => Promise<{
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
 * turns → intent gate (cheap guardrail) → gpt-5 agent loop over the full
 * conversation → persist the new turn via the stream's onFinish. Blocked/empty
 * queries get a streamed refusal and never reach the expensive model. IO
 * injected for testing.
 */
export async function handleChat(
    ctx: ChatContext,
    deps: ChatDeps = defaultChatDeps,
): Promise<Response> {
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

    const result = await deps.runAgent([...history, userMessage])
    return result.toUIMessageStreamResponse({
        originalMessages: [...history, userMessage],
        generateMessageId: deps.generateId,
        // Persist the new user message + the assistant reply once streaming ends.
        onFinish: ({ responseMessage }) =>
            deps.store.save(ctx.userId, conversationId, [userMessage, responseMessage]),
        headers: { 'X-Conversation-Id': conversationId },
    })
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

export default chatRoute
