import type { LanguageModelUsage } from 'ai'

// Centralized AI cost/observability logging. Every model + embedding call routes
// its token usage through here so logs are consistent and machine-parseable
// (`key=value`), and so prompt-cache effectiveness (`cached=`) is visible per
// request for cost tracking (CLAUDE.md cost rules).

export interface NormalizedUsage {
    inputTokens?: number
    outputTokens?: number
    totalTokens?: number
    /** Prompt-cache read tokens — non-zero means prompt caching is working. */
    cachedTokens?: number
}

/** Flatten the AI SDK's LanguageModelUsage into our normalized shape. */
export function normalizeUsage(usage: LanguageModelUsage): NormalizedUsage {
    return {
        inputTokens: usage.inputTokens,
        outputTokens: usage.outputTokens,
        totalTokens: usage.totalTokens,
        cachedTokens: usage.inputTokenDetails?.cacheReadTokens,
    }
}

const n = (v: number | undefined) => v ?? '?'

/**
 * Emit one structured usage line, e.g.
 * `📊 usage label=chat model=gpt-5-nano in=120 out=45 total=165 cached=80 retrieval=sql`
 * Pass `meta` for call-specific context (retrieval path, cache hits, …).
 */
export function logUsage(
    label: string,
    model: string,
    usage: NormalizedUsage,
    meta?: Record<string, string | number>,
): void {
    const parts = [
        `label=${label}`,
        `model=${model}`,
        `in=${n(usage.inputTokens)}`,
        `out=${n(usage.outputTokens)}`,
        `total=${n(usage.totalTokens)}`,
        `cached=${usage.cachedTokens ?? 0}`,
    ]
    if (meta) {
        for (const [key, value] of Object.entries(meta)) parts.push(`${key}=${value}`)
    }
    console.log(`📊 usage ${parts.join(' ')}`)
}
