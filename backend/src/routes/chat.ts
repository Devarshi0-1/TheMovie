import { createUIMessageStream, createUIMessageStreamResponse, type UIMessage } from 'ai'
import { Hono } from 'hono'
import { runAgent, latestUserText } from '../agent/agent'
import { runIntentGate } from '../agent/intent'
import { auth } from '../lib/auth'
import { ChatRequestSchema } from '../schemas/chat'
import type { GateDecision } from '../schemas/intent'

// Stream a single assistant text message (the intent-gate refusal) as a UI
// message stream, so `useChat` renders it exactly like a normal reply — without
// ever invoking the expensive gpt-5 loop.
function refusalResponse(text: string): Response {
    const stream = createUIMessageStream({
        execute: ({ writer }) => {
            const id = 'refusal'
            writer.write({ type: 'text-start', id })
            writer.write({ type: 'text-delta', id, delta: text })
            writer.write({ type: 'text-end', id })
        },
    })
    return createUIMessageStreamResponse({ stream })
}

export interface ChatDeps {
    gate: (query: string) => Promise<GateDecision>
    runAgent: (messages: UIMessage[]) => Promise<{ toUIMessageStreamResponse: () => Response }>
}

const defaultChatDeps: ChatDeps = { gate: runIntentGate, runAgent }

/**
 * The chat pipeline as plain control flow: intent gate (cheap guardrail) →
 * gpt-5 agent loop (only if allowed). Blocked/empty queries get a streamed
 * refusal and never reach the expensive model. IO injected for testing.
 */
export async function handleChat(
    messages: UIMessage[],
    deps: ChatDeps = defaultChatDeps,
): Promise<Response> {
    const query = latestUserText(messages)
    if (!query) {
        return refusalResponse('Tell me what you feel like watching and I’ll find something.')
    }

    const decision = await deps.gate(query)
    if (!decision.allowed) {
        return refusalResponse(decision.refusal ?? 'I can only help with movies and watchlists.')
    }

    const result = await deps.runAgent(messages)
    return result.toUIMessageStreamResponse()
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

    return handleChat(parsed.data.messages as UIMessage[])
})

export default chatRoute
