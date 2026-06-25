import { describe, expect, it } from 'bun:test'
import type { UIMessage } from 'ai'
import { handleChat, type ChatContext, type ChatDeps } from './chat'
import type { ConversationStore } from '../lib/conversation'
import type { GateDecision, IntentResult } from '@themovie/schemas'

const userMsg = (text: string, id = 'u1'): UIMessage =>
    ({ id, role: 'user', parts: [{ type: 'text', text }] }) as UIMessage

const intentResult = (over: Partial<IntentResult> = {}): IntentResult => ({
    intent: 'search',
    relevant: true,
    safe: true,
    confidence: 0.9,
    reason: 'stub',
    ...over,
})

// Fake store records loads/saves; seed history via `history`.
const fakeStore = (history: UIMessage[] | null = []) => {
    const saved: { conversationId: string; messages: UIMessage[] }[] = []
    const loads: string[] = []
    const store: ConversationStore = {
        async load(_userId, conversationId) {
            loads.push(conversationId)
            return history
        },
        async save(_userId, conversationId, messages) {
            saved.push({ conversationId, messages })
        },
    }
    return { store, saved, loads }
}

// Fake agent: records the messages it ran on (and bound userId), and (like the
// real stream) fires onFinish with a synthesized assistant message so
// persistence is exercised.
const fakeAgent = () => {
    const ran: UIMessage[][] = []
    const userIds: (string | undefined)[] = []
    const assistant = {
        id: 'a1',
        role: 'assistant',
        parts: [{ type: 'text', text: 'here you go' }],
    } as UIMessage
    const runAgent: ChatDeps['runAgent'] = async (messages, opts) => {
        ran.push(messages)
        userIds.push(opts?.userId)
        return {
            toUIMessageStreamResponse: (options) => {
                void options?.onFinish?.({ responseMessage: assistant })
                return new Response('AGENT_STREAM', {
                    headers: options?.headers,
                })
            },
        }
    }
    return { runAgent, ran, userIds, assistant }
}

const makeDeps = (
    decision: GateDecision,
    opts: { history?: UIMessage[] | null } = {},
): {
    deps: ChatDeps
    store: ReturnType<typeof fakeStore>
    agent: ReturnType<typeof fakeAgent>
    gateCalls: number[]
} => {
    const store = fakeStore(opts.history ?? [])
    const agent = fakeAgent()
    let idSeq = 0
    const gateCalls: number[] = []
    const deps: ChatDeps = {
        async gate() {
            gateCalls.push(1)
            return decision
        },
        runAgent: agent.runAgent,
        store: store.store,
        generateId: () => `gen-${idSeq++}`,
    }
    return { deps, store, agent, gateCalls }
}

const ctx = (over: Partial<ChatContext> = {}): ChatContext => ({
    userId: 'user-1',
    messages: [userMsg('sci-fi from 2010')],
    ...over,
})

describe('handleChat — agent path', () => {
    it('runs the agent and streams its response when allowed (feature)', async () => {
        const { deps, agent } = makeDeps({ allowed: true, result: intentResult() })
        const res = await handleChat(ctx(), deps)
        expect(await res.text()).toBe('AGENT_STREAM')
        expect(agent.ran).toHaveLength(1)
    })

    it('binds the agent to the requesting user (feature: per-user watchlist tools)', async () => {
        const { deps, agent } = makeDeps({ allowed: true, result: intentResult() })
        await handleChat(ctx({ userId: 'user-42' }), deps)
        expect(agent.userIds[0]).toBe('user-42')
    })

    it('prepends loaded history to the agent input (feature: multi-turn memory)', async () => {
        const history = [
            userMsg('earlier turn', 'old-u'),
            { id: 'old-a', role: 'assistant', parts: [] } as UIMessage,
        ]
        const { deps, agent } = makeDeps({ allowed: true, result: intentResult() }, { history })
        await handleChat(ctx({ conversationId: 'c1' }), deps)
        // agent saw history + the new user message, in order.
        expect(agent.ran[0].map((m) => m.id)).toEqual(['old-u', 'old-a', 'u1'])
    })

    it('persists the new user + assistant turn via onFinish (feature: append)', async () => {
        const { deps, store } = makeDeps({ allowed: true, result: intentResult() })
        await handleChat(ctx({ conversationId: 'c1' }), deps)
        expect(store.saved).toHaveLength(1)
        expect(store.saved[0].conversationId).toBe('c1')
        expect(store.saved[0].messages.map((m) => m.role)).toEqual(['user', 'assistant'])
    })

    it('mints a conversation id when none is supplied and returns it in a header (edge)', async () => {
        const { deps, store } = makeDeps({ allowed: true, result: intentResult() })
        const res = await handleChat(ctx({ conversationId: undefined }), deps)
        expect(res.headers.get('X-Conversation-Id')).toBe('gen-0')
        expect(store.saved[0].conversationId).toBe('gen-0')
    })
})

describe('handleChat — gate refusal path', () => {
    it('streams the refusal and skips the agent when blocked (feature: cost + safety)', async () => {
        const { deps, agent } = makeDeps({
            allowed: false,
            result: intentResult({ intent: 'off_topic', relevant: false }),
            refusal: 'I only help with movies.',
        })
        const res = await handleChat(ctx({ messages: [userMsg('write me python')] }), deps)
        expect(agent.ran).toHaveLength(0) // expensive loop never runs
        expect(await res.text()).toContain('I only help with movies.')
    })

    it('still persists the user + refusal turn (feature: coherent thread on resume)', async () => {
        const { deps, store } = makeDeps({
            allowed: false,
            result: intentResult({ intent: 'injection', safe: false }),
            refusal: 'No.',
        })
        await handleChat(ctx({ conversationId: 'c1' }), deps)
        expect(store.saved[0].messages.map((m) => m.role)).toEqual(['user', 'assistant'])
    })
})

describe('handleChat — empty query', () => {
    it('refuses without calling the gate, agent, or store (edge: cost)', async () => {
        const { deps, store, agent, gateCalls } = makeDeps({
            allowed: true,
            result: intentResult(),
        })
        const assistantOnly = [
            { id: 'a', role: 'assistant', parts: [{ type: 'text', text: 'hi' }] } as UIMessage,
        ]
        const res = await handleChat(ctx({ messages: assistantOnly }), deps)
        expect(gateCalls).toHaveLength(0)
        expect(agent.ran).toHaveLength(0)
        expect(store.saved).toHaveLength(0)
        expect((await res.text()).length).toBeGreaterThan(0)
    })
})
