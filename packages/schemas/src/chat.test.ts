import { describe, expect, it } from 'bun:test'
import { ChatRequestSchema } from './chat'

const userMessage = (text: string) => ({
    id: '1',
    role: 'user' as const,
    parts: [{ type: 'text', text }],
})

describe('ChatRequestSchema', () => {
    it('parses a well-formed chat request (feature)', () => {
        const parsed = ChatRequestSchema.parse({ messages: [userMessage('find me a thriller')] })
        expect(parsed.messages).toHaveLength(1)
    })

    it('preserves unknown part fields via catchall (feature: pass-through to AI SDK)', () => {
        const parsed = ChatRequestSchema.parse({
            messages: [{ role: 'user', parts: [{ type: 'text', text: 'hi', state: 'done' }] }],
        })
        expect((parsed.messages[0]!.parts[0] as { state?: string }).state).toBe('done')
    })

    it('rejects an empty messages array (edge)', () => {
        expect(() => ChatRequestSchema.parse({ messages: [] })).toThrow()
    })

    it('rejects an unknown role (edge: malformed client)', () => {
        expect(() =>
            ChatRequestSchema.parse({ messages: [{ role: 'robot', parts: [] }] }),
        ).toThrow()
    })

    it('rejects a missing messages field (edge)', () => {
        expect(() => ChatRequestSchema.parse({})).toThrow()
    })
})
