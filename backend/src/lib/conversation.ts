import type { UIMessage } from 'ai'
import { and, asc, eq } from 'drizzle-orm'
import { db } from '../db'
import { chatMessage, conversation } from '../db/schema'

// Per-user conversation persistence — the agent's multi-turn memory. The store
// interface is injectable so the chat pipeline is testable without a live DB;
// `conversationStore` is the Drizzle-backed default.

export interface ConversationStore {
    /** Prior messages for an owned conversation, or null if it doesn't exist / isn't the user's. */
    load(userId: string, conversationId: string): Promise<UIMessage[] | null>
    /** Append messages, creating the conversation (owned by userId) if new. */
    save(userId: string, conversationId: string, messages: UIMessage[]): Promise<void>
}

interface ChatMessageRow {
    id: string
    role: string
    parts: unknown
}

function rowToUIMessage(row: ChatMessageRow): UIMessage {
    return { id: row.id, role: row.role, parts: row.parts } as UIMessage
}

export const conversationStore: ConversationStore = {
    async load(userId, conversationId) {
        // Ownership check: only the conversation's owner can read it.
        const [owned] = await db
            .select({ id: conversation.id })
            .from(conversation)
            .where(and(eq(conversation.id, conversationId), eq(conversation.userId, userId)))
            .limit(1)
        if (!owned) return null

        const rows = await db
            .select({ id: chatMessage.id, role: chatMessage.role, parts: chatMessage.parts })
            .from(chatMessage)
            .where(eq(chatMessage.conversationId, conversationId))
            .orderBy(asc(chatMessage.createdAt))
        return rows.map(rowToUIMessage)
    },

    async save(userId, conversationId, messages) {
        if (messages.length === 0) return

        // Create the conversation if it's new; ignore if it already exists.
        await db.insert(conversation).values({ id: conversationId, userId }).onConflictDoNothing()

        // Re-read ownership: never append to another user's conversation.
        const [owned] = await db
            .select({ userId: conversation.userId })
            .from(conversation)
            .where(eq(conversation.id, conversationId))
            .limit(1)
        if (!owned || owned.userId !== userId) {
            throw new Error('Conversation does not belong to the user')
        }

        // onConflictDoNothing dedupes on message id (e.g. a retried request).
        await db
            .insert(chatMessage)
            .values(
                messages.map((m) => ({
                    id: m.id,
                    conversationId,
                    role: m.role,
                    parts: m.parts,
                })),
            )
            .onConflictDoNothing()

        await db
            .update(conversation)
            .set({ updatedAt: new Date() })
            .where(eq(conversation.id, conversationId))
    },
}
