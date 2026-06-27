import { afterEach, describe, expect, it, mock, spyOn } from 'bun:test'
import type { LanguageModelUsage } from 'ai'
import { logUsage, normalizeUsage } from './usage'

afterEach(() => {
    mock.restore()
})

describe('normalizeUsage', () => {
    it('flattens the AI SDK usage incl. cached read tokens (feature)', () => {
        const usage = {
            inputTokens: 100,
            outputTokens: 20,
            totalTokens: 120,
            inputTokenDetails: { cacheReadTokens: 80 },
        } as unknown as LanguageModelUsage
        expect(normalizeUsage(usage)).toEqual({
            inputTokens: 100,
            outputTokens: 20,
            totalTokens: 120,
            cachedTokens: 80,
        })
    })

    it('tolerates missing fields (edge: undefined usage details)', () => {
        const usage = { inputTokens: 5 } as unknown as LanguageModelUsage
        expect(normalizeUsage(usage)).toEqual({
            inputTokens: 5,
            outputTokens: undefined,
            totalTokens: undefined,
            cachedTokens: undefined,
        })
    })
})

describe('logUsage', () => {
    it('emits a parseable key=value line with model + tokens (feature)', () => {
        const spy = spyOn(console, 'log').mockImplementation(() => {})
        logUsage('chat', 'gpt-5', {
            inputTokens: 120,
            outputTokens: 45,
            totalTokens: 165,
            cachedTokens: 80,
        })
        const line = spy.mock.calls[0]![0] as string
        expect(line).toContain('label=chat')
        expect(line).toContain('model=gpt-5')
        expect(line).toContain('in=120')
        expect(line).toContain('out=45')
        expect(line).toContain('total=165')
        expect(line).toContain('cached=80')
    })

    it('defaults cached to 0 and unknown tokens to ? (edge)', () => {
        const spy = spyOn(console, 'log').mockImplementation(() => {})
        logUsage('intent', 'gpt-5-mini', {})
        const line = spy.mock.calls[0]![0] as string
        expect(line).toContain('in=?')
        expect(line).toContain('cached=0')
    })

    it('appends call-specific meta fields (feature: e.g. retrieval path)', () => {
        const spy = spyOn(console, 'log').mockImplementation(() => {})
        logUsage('chat', 'gpt-5', { inputTokens: 1 }, { retrieval: 'sql|semantic', candidates: 12 })
        const line = spy.mock.calls[0]![0] as string
        expect(line).toContain('retrieval=sql|semantic')
        expect(line).toContain('candidates=12')
    })
})
