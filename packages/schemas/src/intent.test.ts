import { describe, expect, it } from 'bun:test'
import {
    decideGate,
    INTENTS,
    IntentResultSchema,
    isBlocked,
    refusalFor,
    type IntentResult,
} from './intent'

const result = (over: Partial<IntentResult> = {}): IntentResult => ({
    intent: 'search',
    relevant: true,
    safe: true,
    confidence: 0.9,
    reason: 'Looks like a movie search.',
    ...over,
})

// ── Schema validation ────────────────────────────────────────────────────────
describe('IntentResultSchema', () => {
    it('parses a well-formed classification (feature)', () => {
        const parsed = IntentResultSchema.parse(result())
        expect(parsed.intent).toBe('search')
    })

    it('rejects an unknown intent (edge: bad LLM output)', () => {
        expect(() => IntentResultSchema.parse(result({ intent: 'nonsense' as never }))).toThrow()
    })

    it('rejects confidence outside 0–1 (edge: domain bound)', () => {
        expect(() => IntentResultSchema.parse(result({ confidence: 1.5 }))).toThrow()
        expect(() => IntentResultSchema.parse(result({ confidence: -0.1 }))).toThrow()
    })

    it('rejects missing required fields (edge: partial output)', () => {
        const { safe: _omit, ...partial } = result()
        expect(() => IntentResultSchema.parse(partial)).toThrow()
    })

    it('exposes all seven intent labels (feature)', () => {
        expect(INTENTS).toEqual([
            'search',
            'details',
            'watchlist',
            'recommendation',
            'chitchat',
            'off_topic',
            'injection',
        ])
    })
})

// ── isBlocked / decideGate ───────────────────────────────────────────────────
describe('gate decision', () => {
    it('allows the four retrieval intents and chitchat (feature)', () => {
        for (const intent of [
            'search',
            'details',
            'watchlist',
            'recommendation',
            'chitchat',
        ] as const) {
            const decision = decideGate(result({ intent }))
            expect(decision.allowed).toBe(true)
            expect(decision.refusal).toBeUndefined()
        }
    })

    it('blocks off_topic and injection intents (feature: guardrail)', () => {
        expect(isBlocked(result({ intent: 'off_topic', relevant: false }))).toBe(true)
        expect(isBlocked(result({ intent: 'injection', safe: false }))).toBe(true)
    })

    it('blocks an unsafe query even when the intent looks relevant (edge: abuse)', () => {
        // e.g. an abusive message the model still tagged as a search.
        const decision = decideGate(result({ intent: 'search', relevant: true, safe: false }))
        expect(decision.allowed).toBe(false)
        expect(decision.refusal).toBeTruthy()
    })

    it('blocks a contradictory relevant=false classification (edge: defense in depth)', () => {
        expect(isBlocked(result({ intent: 'search', relevant: false }))).toBe(true)
    })

    it('attaches a friendly refusal on block, none on allow (feature: UX)', () => {
        const blocked = decideGate(result({ intent: 'off_topic', relevant: false }))
        expect(blocked.allowed).toBe(false)
        expect(blocked.refusal).toContain('movie')

        const allowed = decideGate(result())
        expect(allowed.refusal).toBeUndefined()
    })

    it('uses a non-echoing refusal for injection (edge: no prompt leakage)', () => {
        const refusal = refusalFor(result({ intent: 'injection', safe: false }))
        expect(refusal).toContain("can't help")
    })
})
