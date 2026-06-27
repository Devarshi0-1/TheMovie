import { afterAll, beforeAll, describe, expect, it } from 'bun:test'
import type { UIMessage } from 'ai'
import { inArray } from 'drizzle-orm'
import { db } from '../db'
import { user } from '../db/schema'
import { conversationStore } from './conversation'

// Integration test for the REAL Drizzle-backed ConversationStore against the
// Postgres in DATABASE_URL (BTEST-2). It exercises the security-critical
// cross-user ownership guard, the transactional save, ordered load, and the
// HITL parts-heal — things the offline unit suite can only test through a fake.
//
// Opt-in via `RUN_DB_INTEGRATION=1` (see `bun run test:integration`), so the
// default `bun test` stays DB-free/offline. The gate is synchronous: bun
// collects tests synchronously, so a top-level `await` here would register none.
const RUN = process.env.RUN_DB_INTEGRATION === '1'

const uid = () => `itest-${crypto.randomUUID()}`
const textMsg = (id: string, text: string, role: 'user' | 'assistant' = 'user'): UIMessage =>
    ({ id, role, parts: [{ type: 'text', text }] }) as UIMessage

describe.skipIf(!RUN)('ConversationStore (integration, real DB)', () => {
    const userA = uid()
    const userB = uid()

    beforeAll(async () => {
        await db.insert(user).values([
            { id: userA, name: 'A', email: `${userA}@itest.test`, emailVerified: false },
            { id: userB, name: 'B', email: `${userB}@itest.test`, emailVerified: false },
        ])
    })

    afterAll(async () => {
        // Cascades to the users' conversations + chat messages.
        await db.delete(user).where(inArray(user.id, [userA, userB]))
    })

    // Message ids are a GLOBAL primary key, so every test mints fresh UUID ids
    // (like the real app) — reusing ids across conversations would collide.
    it('round-trips save → load in insertion order (feature)', async () => {
        const cid = uid()
        const [a, b] = [uid(), uid()]
        await conversationStore.save(userA, cid, [
            textMsg(a, 'first'),
            textMsg(b, 'second', 'assistant'),
        ])
        const loaded = await conversationStore.load(userA, cid)
        expect(loaded?.map((m) => m.id)).toEqual([a, b])
        expect(loaded?.map((m) => m.role)).toEqual(['user', 'assistant'])
    })

    it('load returns null for a non-owner (security: no cross-user read)', async () => {
        const cid = uid()
        await conversationStore.save(userA, cid, [textMsg(uid(), 'hi')])
        expect(await conversationStore.load(userB, cid)).toBeNull()
    })

    it('save throws on a foreign write and leaves the owner untouched (security + atomicity)', async () => {
        const cid = uid()
        const a = uid()
        await conversationStore.save(userA, cid, [textMsg(a, 'hi')])
        expect(conversationStore.save(userB, cid, [textMsg(uid(), 'sneaky')])).rejects.toThrow(
            /does not belong/,
        )
        // The transaction rolled back: userA's thread still has only its message.
        const loaded = await conversationStore.load(userA, cid)
        expect(loaded?.map((m) => m.id)).toEqual([a])
    })

    it('heals a HITL tool part on re-save of the same message id (regression)', async () => {
        const cid = uid()
        const hid = uid()
        await conversationStore.save(userA, cid, [
            {
                id: hid,
                role: 'assistant',
                parts: [{ type: 'tool-x', state: 'input-available' }],
            } as unknown as UIMessage,
        ])
        await conversationStore.save(userA, cid, [
            {
                id: hid,
                role: 'assistant',
                parts: [{ type: 'tool-x', state: 'output-available' }],
            } as unknown as UIMessage,
        ])
        const loaded = await conversationStore.load(userA, cid)
        expect(loaded).toHaveLength(1)
        expect((loaded![0]!.parts[0] as { state: string }).state).toBe('output-available')
    })

    it('ownerOf returns the owner, or null for an unknown id (feature)', async () => {
        const cid = uid()
        await conversationStore.save(userA, cid, [textMsg(uid(), 'hi')])
        expect(await conversationStore.ownerOf(cid)).toBe(userA)
        expect(await conversationStore.ownerOf(uid())).toBeNull()
    })
})
