import { z } from 'zod'

// Boundary validation for POST /api/v1/chat. `useChat` posts UI messages, each
// with a role and `parts`; we validate the envelope and keep parts permissive
// (the AI SDK does its own part-level validation in convertToModelMessages).
// Lives in the backend for now; lifts to `packages/schemas/` in Phase 7.1.

const UIMessagePartSchema = z.object({ type: z.string() }).catchall(z.unknown())

const UIMessageInputSchema = z.object({
    id: z.string().optional(),
    role: z.enum(['system', 'user', 'assistant']),
    parts: z.array(UIMessagePartSchema),
})

export const ChatRequestSchema = z.object({
    id: z.string().optional(),
    messages: z.array(UIMessageInputSchema).min(1, 'At least one message is required.'),
})

export type ChatRequest = z.infer<typeof ChatRequestSchema>

// Composer-side validation for the chat input box (TanStack Form + Zod). Shared
// so the same bounds describe a single user message everywhere.
export const ChatMessageInputSchema = z.object({
    message: z
        .string()
        .trim()
        .min(1, 'Type a message first.')
        .max(2000, 'Message is too long (max 2000 characters).'),
})

export type ChatMessageInput = z.infer<typeof ChatMessageInputSchema>
