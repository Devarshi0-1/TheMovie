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
