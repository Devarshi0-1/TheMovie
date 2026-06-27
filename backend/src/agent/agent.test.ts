import { describe, expect, it } from 'bun:test'
import type { UIMessage } from 'ai'
import type { LanguageModelV3StreamPart } from '@ai-sdk/provider'
import { MockLanguageModelV3, simulateReadableStream } from 'ai/test'
import {
    assistantTextMessage,
    lastUserMessage,
    latestUserText,
    MAX_STEPS,
    prepareAgentStep,
    runAgent,
    sumStepUsage,
    summarizeToolPaths,
    textOfMessage,
} from './agent'

const msg = (role: 'user' | 'assistant', ...texts: string[]): UIMessage =>
    ({
        id: Math.random().toString(),
        role,
        parts: texts.map((text) => ({ type: 'text', text })),
    }) as UIMessage

describe('latestUserText', () => {
    it('returns the latest user message text (feature)', () => {
        const text = latestUserText([
            msg('user', 'first'),
            msg('assistant', 'hi'),
            msg('user', 'second'),
        ])
        expect(text).toBe('second')
    })

    it('joins multiple text parts of the user message (feature)', () => {
        expect(latestUserText([msg('user', 'sci-fi', 'from 2010')])).toBe('sci-fi from 2010')
    })

    it('ignores trailing assistant messages (edge)', () => {
        expect(latestUserText([msg('user', 'real query'), msg('assistant', 'reply')])).toBe(
            'real query',
        )
    })

    it('returns "" when there is no user message (edge)', () => {
        expect(latestUserText([msg('assistant', 'hello')])).toBe('')
    })

    it('skips non-text parts (edge: file/tool parts)', () => {
        const m = {
            id: '1',
            role: 'user',
            parts: [
                { type: 'file', url: 'x' },
                { type: 'text', text: 'keep me' },
            ],
        } as unknown as UIMessage
        expect(latestUserText([m])).toBe('keep me')
    })
})

describe('lastUserMessage / textOfMessage / assistantTextMessage', () => {
    it('returns the most recent user message object (feature)', () => {
        const m = lastUserMessage([msg('user', 'a'), msg('assistant', 'b'), msg('user', 'c')])
        expect(textOfMessage(m!)).toBe('c')
    })

    it('returns undefined when there is no user message (edge)', () => {
        expect(lastUserMessage([msg('assistant', 'hi')])).toBeUndefined()
    })

    it('builds an assistant text message (feature: refusal/persistence)', () => {
        const m = assistantTextMessage('x1', 'a refusal')
        expect(m.role).toBe('assistant')
        expect(m.id).toBe('x1')
        expect(textOfMessage(m)).toBe('a refusal')
    })
})

describe('summarizeToolPaths', () => {
    it('collects distinct tool names across steps (feature: observability)', () => {
        const steps = [
            { toolCalls: [{ toolName: 'search_movies_sql' }] },
            {
                toolCalls: [
                    { toolName: 'semantic_search_movies' },
                    { toolName: 'search_movies_sql' },
                ],
            },
        ]
        expect(summarizeToolPaths(steps).sort()).toEqual([
            'search_movies_sql',
            'semantic_search_movies',
        ])
    })

    it('returns [] when no tools were called (edge: answered directly)', () => {
        expect(summarizeToolPaths([{ toolCalls: [] }, {}])).toEqual([])
    })
})

describe('sumStepUsage (abort usage aggregation, BAG-5)', () => {
    it('sums per-step usage across completed steps (feature)', () => {
        const total = sumStepUsage([
            { usage: { inputTokens: 10, outputTokens: 4, totalTokens: 14 } },
            { usage: { inputTokens: 7, outputTokens: 3, totalTokens: 10 } },
        ])
        expect(total).toEqual({ inputTokens: 17, outputTokens: 7, totalTokens: 24 })
    })

    it('treats missing per-step usage as zero (edge: aborted before any step finished)', () => {
        expect(sumStepUsage([{}, { usage: undefined }])).toEqual({
            inputTokens: 0,
            outputTokens: 0,
            totalTokens: 0,
        })
    })
})

describe('prepareAgentStep (forced synthesis on the final step)', () => {
    it('leaves tool choice to the model on every step before the last (feature)', () => {
        expect(prepareAgentStep({ stepNumber: 0 })).toEqual({})
        // `stopWhen: stepCountIs(MAX_STEPS)` runs steps 0..MAX_STEPS-1, so the last
        // EXECUTED step is index MAX_STEPS-1; MAX_STEPS-2 is still a normal step.
        expect(prepareAgentStep({ stepNumber: MAX_STEPS - 2 })).toEqual({})
    })

    it('disables tools on the final step so the model must answer (regression)', () => {
        // Without this, a query that escalates to many fetch_from_tmdb calls can
        // burn the whole step budget on tool calls and stream an empty answer.
        // MAX_STEPS-1 is the actual final executed step.
        expect(prepareAgentStep({ stepNumber: MAX_STEPS - 1 })).toEqual({ toolChoice: 'none' })
        // `>=` is defensive: a hypothetical overshoot step stays tool-disabled too
        // (the loop stops before index MAX_STEPS would ever run).
        expect(prepareAgentStep({ stepNumber: MAX_STEPS })).toEqual({ toolChoice: 'none' })
    })
})

describe('runAgent (loop wiring, BTEST-1)', () => {
    function answeringModel(answer: string, onPrompt?: (prompt: unknown) => void) {
        return new MockLanguageModelV3({
            doStream: async (options) => {
                onPrompt?.(options.prompt)
                // Mock stream parts — verified at runtime; cast past the very
                // specific V3 part types (test fixture, not production code).
                const chunks = [
                    { type: 'text-start', id: '0' },
                    { type: 'text-delta', id: '0', delta: answer },
                    { type: 'text-end', id: '0' },
                    {
                        type: 'finish',
                        finishReason: 'stop',
                        usage: {
                            inputTokens: { total: 10 },
                            outputTokens: { total: 5 },
                        },
                    },
                ] as unknown as LanguageModelV3StreamPart[]
                return { stream: simulateReadableStream({ chunks }) }
            },
        })
    }

    it('converts the conversation and streams the model answer (feature)', async () => {
        let captured = ''
        const model = answeringModel('Try Inception.', (p) => (captured = JSON.stringify(p)))

        const result = await runAgent([msg('user', 'a slow-burn heist movie')], { model })

        expect(await result.text).toBe('Try Inception.')
        // The system prompt + the user turn were converted and sent to the model.
        expect(captured).toContain('slow-burn heist movie')
        expect(captured).toContain('TheMovie') // system prompt is included
    })

    it('binds the user watchlist tools only when a userId is given (feature)', async () => {
        const withUser = await runAgent([msg('user', 'add Inception')], {
            model: answeringModel('Done.'),
            userId: 'u1',
        })
        // Tooling is wired without throwing and still streams an answer.
        expect(await withUser.text).toBe('Done.')
    })
})
