import { describe, expect, it } from 'bun:test'
import type { UIMessage } from 'ai'
import { handleChat, type ChatDeps } from './chat'
import type { GateDecision, IntentResult } from '../schemas/intent'

const userMsg = (text: string): UIMessage =>
    ({ id: '1', role: 'user', parts: [{ type: 'text', text }] }) as UIMessage

const intentResult = (over: Partial<IntentResult> = {}): IntentResult => ({
    intent: 'search',
    relevant: true,
    safe: true,
    confidence: 0.9,
    reason: 'stub',
    ...over,
})

// Injected gate + agent so the pipeline is tested with no OpenAI calls. The fake
// agent returns a sentinel Response we can identify.
const makeDeps = (decision: GateDecision) => {
    const calls = { gate: 0, agent: 0 }
    const deps: ChatDeps = {
        async gate() {
            calls.gate++
            return decision
        },
        async runAgent() {
            calls.agent++
            return { toUIMessageStreamResponse: () => new Response('AGENT_STREAM') }
        },
    }
    return { deps, calls }
}

describe('handleChat', () => {
    it('runs the agent when the gate allows the query (feature)', async () => {
        const { deps, calls } = makeDeps({ allowed: true, result: intentResult() })
        const res = await handleChat([userMsg('sci-fi from 2010')], deps)
        expect(await res.text()).toBe('AGENT_STREAM')
        expect(calls.gate).toBe(1)
        expect(calls.agent).toBe(1)
    })

    it('streams the refusal and skips the agent when blocked (feature: cost + safety)', async () => {
        const { deps, calls } = makeDeps({
            allowed: false,
            result: intentResult({ intent: 'off_topic', relevant: false }),
            refusal: 'I only help with movies.',
        })
        const res = await handleChat([userMsg('write me python')], deps)
        expect(calls.agent).toBe(0) // expensive loop never runs
        expect(await res.text()).toContain('I only help with movies.')
    })

    it('refuses an empty query without calling the gate or agent (edge: cost)', async () => {
        const { deps, calls } = makeDeps({ allowed: true, result: intentResult() })
        const emptyAssistantOnly = [
            { id: '1', role: 'assistant', parts: [{ type: 'text', text: 'hi' }] } as UIMessage,
        ]
        const res = await handleChat(emptyAssistantOnly, deps)
        expect(calls.gate).toBe(0)
        expect(calls.agent).toBe(0)
        expect((await res.text()).length).toBeGreaterThan(0)
    })
})
