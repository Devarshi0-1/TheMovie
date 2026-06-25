import { describe, expect, it } from 'bun:test'
import type { UIMessage } from 'ai'
import {
    assistantTextMessage,
    lastUserMessage,
    latestUserText,
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
