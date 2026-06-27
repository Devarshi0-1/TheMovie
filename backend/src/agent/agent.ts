import { openai } from '@ai-sdk/openai'
import {
    convertToModelMessages,
    stepCountIs,
    streamText,
    type LanguageModelUsage,
    type UIMessage,
} from 'ai'
import { logUsage, normalizeUsage } from '../lib/usage'
import { retrievalTools } from './tools'
import { createUserTools } from './userTools'

// The reasoning agent that drives the chat tool loop. Pinned to gpt-5-nano (the
// cheapest GPT-5-family model) per the project's cost directive; it only ever
// sees queries the intent gate already approved.
export const AGENT_MODEL = 'gpt-5-nano'

// Cap the tool loop so a misbehaving model can't run unboundedly. A typical
// query resolves in 1–3 steps (retrieve → maybe escalate → synthesize); the
// ceiling leaves room for a query that has to escalate to several TMDB fetches.
export const MAX_STEPS = 10

/**
 * Per-step settings for the agent loop. On the final allowed step we disable
 * tools (`toolChoice: 'none'`) so the model MUST emit a text answer instead of
 * ending on another tool call — otherwise a query that escalates to many
 * fetch_from_tmdb calls can exhaust the step budget mid-tool-call and stream an
 * empty response. Earlier steps inherit the outer (auto) tool choice.
 */
export function prepareAgentStep({ stepNumber }: { stepNumber: number }) {
    return stepNumber >= MAX_STEPS - 1 ? { toolChoice: 'none' as const } : {}
}

// Stable system prompt kept first so OpenAI prompt caching covers it + the tool
// definitions; only the per-request messages (appended after) are volatile.
const SYSTEM_PROMPT = `You are TheMovie, a conversational movie discovery assistant. You help users find films, learn about them, and decide what to watch. Only discuss movies and watchlists.

You have retrieval tools. Use the CHEAPEST tier that can answer, and escalate only when it is insufficient — never fan out to all tools at once:
1. search_movies_sql — FIRST choice for concrete/exact queries (a title, a genre, a year, or a combination like "sci-fi from 2010"). Cheapest and most precise.
2. semantic_search_movies — for conceptual or thematic queries that keywords can't capture (e.g. "a movie where the hero later becomes the villain"). Use when SQL search is unsuitable or returns nothing relevant.
3. fetch_from_tmdb — LAST RESORT, only when the local catalog misses (a brand-new release, an obscure title, or both searches above came up empty).
Use get_movie_details for facts about a specific movie the user has identified, and get_trending for open-ended "what's popular" requests. Use summarize_reviews for spoiler-free audience reception of a specific movie.

For watchlists: use get_user_watchlist to see what's on the user's list. To add or remove movies, call manage_watchlist to PROPOSE the change — if the user wants several movies changed at once, include them ALL in a SINGLE manage_watchlist call (its \`movies\` list), never one call per movie. It does not modify anything until the user confirms, so never claim a movie was added/removed until that's confirmed. Once manage_watchlist returns a result, the user has already confirmed and the change has been applied (or they declined) — acknowledge the outcome in one short line and do NOT propose the same change again.

When you have results, reason over them and reply with a short, ranked set of suggestions, each with a one-line, spoiler-free reason it fits the request. Be concise and friendly. If nothing fits, say so plainly and suggest how the user could refine their request. Never invent movies or details that the tools did not return.`

/** The most recent user message in the conversation, if any. */
export function lastUserMessage(messages: UIMessage[]): UIMessage | undefined {
    for (let i = messages.length - 1; i >= 0; i--) {
        const message = messages[i]
        if (message?.role === 'user') return message
    }
    return undefined
}

/** Concatenate a message's text parts (ignoring file/tool/reasoning parts). */
export function textOfMessage(message: UIMessage): string {
    return (message.parts ?? [])
        .filter(
            (p): p is { type: 'text'; text: string } =>
                p.type === 'text' && typeof (p as { text?: unknown }).text === 'string',
        )
        .map((p) => p.text)
        .join(' ')
        .trim()
}

/** Extract the latest user message's text — what the intent gate classifies. */
export function latestUserText(messages: UIMessage[]): string {
    const message = lastUserMessage(messages)
    return message ? textOfMessage(message) : ''
}

/** Build a minimal assistant UIMessage carrying a single text part. */
export function assistantTextMessage(id: string, text: string): UIMessage {
    return { id, role: 'assistant', parts: [{ type: 'text', text }] } as UIMessage
}

/** The distinct retrieval tools invoked across a run — logged for observability. */
export function summarizeToolPaths(
    steps: ReadonlyArray<{ toolCalls?: ReadonlyArray<{ toolName: string }> }>,
): string[] {
    const names = new Set<string>()
    for (const step of steps) {
        for (const call of step.toolCalls ?? []) names.add(call.toolName)
    }
    return [...names]
}

function logChatFinish(
    steps: ReadonlyArray<{ toolCalls?: ReadonlyArray<{ toolName: string }> }>,
    usage: LanguageModelUsage,
): void {
    const paths = summarizeToolPaths(steps)
    logUsage('chat', AGENT_MODEL, normalizeUsage(usage), {
        retrieval: paths.join('|') || 'none',
    })
}

/**
 * Run the agent loop over the conversation. Returns the streaming result;
 * the caller streams it to the client via `toUIMessageStreamResponse()`. Assumes
 * the query already passed the intent gate.
 */
export async function runAgent(messages: UIMessage[], opts: { userId?: string } = {}) {
    // Watchlist tools are bound to the user; retrieval tools are stateless.
    const tools =
        opts.userId ? { ...retrievalTools, ...createUserTools(opts.userId) } : retrievalTools

    // `ignoreIncompleteToolCalls` drops any unresolved (e.g. abandoned HITL)
    // tool call so a dangling proposal can never produce an invalid model
    // request; resolved tool results are kept and threaded through normally.
    const modelMessages = await convertToModelMessages(messages, {
        tools,
        ignoreIncompleteToolCalls: true,
    })

    return streamText({
        model: openai(AGENT_MODEL),
        system: SYSTEM_PROMPT,
        messages: modelMessages,
        tools,
        stopWhen: stepCountIs(MAX_STEPS),
        prepareStep: prepareAgentStep,
        onFinish: ({ steps, totalUsage }) => logChatFinish(steps, totalUsage),
    })
}
