import { openai } from '@ai-sdk/openai'
import { embedMany } from 'ai'
import { redis } from './redis'
import { logUsage } from './usage'

// OpenAI `text-embedding-3-small` — 1536-dim vectors, matching the
// `embedding vector(1536)` column on the `movies` table (Phase 3.1). Single AI
// vendor by project decision; do not introduce a second embeddings provider.
export const EMBEDDING_MODEL = 'text-embedding-3-small'
export const EMBEDDING_DIMENSIONS = 1536

// `embeddingModel` is the current AI SDK API (v3 deprecates the older
// `textEmbeddingModel` alias the roadmap names). Same model, no warnings.
const model = openai.embeddingModel(EMBEDDING_MODEL)

// Embeddings are deterministic for a given (model, text): cache them keyed by a
// content hash so unchanged text is never re-embedded. Re-embedding the catalog
// is the single biggest avoidable AI cost (see CLAUDE.md cost rules). The model
// name is part of the namespace so swapping models can't serve stale vectors.
const CACHE_NAMESPACE = `embedding:${EMBEDDING_MODEL}`
// 30 days. Source text is immutable per hash, so this only bounds memory, not
// correctness — a changed movie produces a new hash and a fresh cache entry.
const CACHE_TTL_SECONDS = 60 * 60 * 24 * 30

// OpenAI rate-limits embedding calls; the AI SDK retries (exponential backoff)
// up to `maxRetries` and we cap fan-out with `maxParallelCalls` so a large
// backfill batch can't open hundreds of concurrent requests.
const MAX_RETRIES = 5
const MAX_PARALLEL_CALLS = 4

const cacheKey = (hash: string) => `${CACHE_NAMESPACE}:${hash}`

/**
 * The raw embedding call, isolated behind a function type so tests can inject a
 * fake instead of mocking the shared `ai` module (a global module mock would
 * leak across test files). Returns vectors in input order plus token usage.
 */
export type RawEmbedder = (texts: string[]) => Promise<{ embeddings: number[][]; tokens: number }>

const defaultEmbedder: RawEmbedder = async (texts) => {
    const { embeddings, usage } = await embedMany({
        model,
        values: texts,
        maxParallelCalls: MAX_PARALLEL_CALLS,
        maxRetries: MAX_RETRIES,
    })
    return { embeddings, tokens: usage.tokens }
}

/**
 * Stable SHA-256 hex digest of the source text — the cache key and the
 * ingestion idempotency key ("skip rows whose source text hash is unchanged").
 */
export function contentHashFor(text: string): string {
    return new Bun.CryptoHasher('sha256').update(text).digest('hex')
}

/** Minimal movie shape needed to compose embedding text. */
export interface EmbeddableMovie {
    title: string
    overview?: string | null
    genres?: unknown
    keywords?: unknown
}

// genres/keywords are jsonb of unknown shape: arrays of strings, or TMDB-style
// arrays of `{ id, name }`. Normalize either into a clean, de-duped label list.
function normalizeLabels(value: unknown): string[] {
    if (!Array.isArray(value)) return []

    const labels: string[] = []
    for (const item of value) {
        if (typeof item === 'string') {
            const trimmed = item.trim()
            if (trimmed) labels.push(trimmed)
        } else if (item && typeof item === 'object') {
            const name = (item as { name?: unknown }).name
            if (typeof name === 'string' && name.trim()) labels.push(name.trim())
        }
    }

    return [...new Set(labels)]
}

/**
 * Compose the text embedded per movie from the fields that capture plot/theme —
 * `title + overview + genres + keywords` — which is what conceptual queries like
 * "hero later becomes the villain" match against. Labeled lines give the model
 * structure without bloating the token count.
 */
export function composeEmbeddingText(movie: EmbeddableMovie): string {
    const parts: string[] = [`Title: ${movie.title}`]

    if (movie.overview && movie.overview.trim()) {
        parts.push(`Overview: ${movie.overview.trim()}`)
    }

    const genres = normalizeLabels(movie.genres)
    if (genres.length) parts.push(`Genres: ${genres.join(', ')}`)

    const keywords = normalizeLabels(movie.keywords)
    if (keywords.length) parts.push(`Keywords: ${keywords.join(', ')}`)

    return parts.join('\n')
}

function assertApiKey(): void {
    if (!process.env.OPENAI_API_KEY) {
        throw new Error('OPENAI_API_KEY is not defined — cannot generate embeddings')
    }
}

// Best-effort cache read. If Redis is unreachable we degrade to embedding
// everything rather than failing — the call is logged, not silently swallowed.
async function readCachedVectors(hashes: string[]): Promise<(number[] | null)[]> {
    try {
        const raw = await Promise.all(hashes.map((h) => redis.get(cacheKey(h))))
        return raw.map((value) => (value ? (JSON.parse(value) as number[]) : null))
    } catch (err) {
        console.warn('⚠️ Embedding cache read failed; treating all as misses:', err)
        return hashes.map(() => null)
    }
}

/**
 * Embed many texts at once, cache-aware and order-preserving. Identical texts in
 * the batch are de-duplicated and embedded once; cache hits are reused; only the
 * misses are sent to OpenAI and then written back. Returns one vector per input
 * text, in input order.
 */
export async function embedTexts(
    texts: string[],
    embedder: RawEmbedder = defaultEmbedder,
): Promise<number[][]> {
    if (texts.length === 0) return []

    const hashes = texts.map(contentHashFor)

    // De-dupe identical texts so we embed (and cache-read) each unique text once.
    const textByHash = new Map<string, string>()
    for (let i = 0; i < texts.length; i++) textByHash.set(hashes[i], texts[i])
    const uniqueHashes = [...textByHash.keys()]

    const vectorByHash = new Map<string, number[]>()
    const missingHashes: string[] = []

    const cached = await readCachedVectors(uniqueHashes)
    for (let i = 0; i < uniqueHashes.length; i++) {
        const vector = cached[i]
        if (vector) vectorByHash.set(uniqueHashes[i], vector)
        else missingHashes.push(uniqueHashes[i])
    }

    if (missingHashes.length === 0) {
        // Every unique text was cached — zero embedding spend (the cost win).
        logUsage(
            'embeddings',
            EMBEDDING_MODEL,
            { inputTokens: 0, totalTokens: 0 },
            {
                embedded: 0,
                fromCache: uniqueHashes.length,
            },
        )
    } else {
        assertApiKey()

        const missingTexts = missingHashes.map((h) => textByHash.get(h)!)
        const { embeddings, tokens } = await embedder(missingTexts)

        // Validate dimensions before trusting the vectors (a model/config drift
        // would otherwise corrupt the pgvector column at insert time).
        for (let i = 0; i < missingHashes.length; i++) {
            const vector = embeddings[i]
            if (!vector || vector.length !== EMBEDDING_DIMENSIONS) {
                throw new Error(
                    `Unexpected embedding dimension ${vector?.length} (expected ${EMBEDDING_DIMENSIONS})`,
                )
            }
            vectorByHash.set(missingHashes[i], vector)
        }

        // Write back best-effort: a cache failure must not discard vectors we
        // already paid OpenAI to compute, so log per-key rather than reject.
        await Promise.all(
            missingHashes.map((h) =>
                redis
                    .set(cacheKey(h), JSON.stringify(vectorByHash.get(h)!), 'EX', CACHE_TTL_SECONDS)
                    .catch((err) => console.error(`⚠️ Failed to cache embedding ${h}:`, err)),
            ),
        )

        // `embedded` vs `fromCache` makes redundant-embedding spend observable.
        logUsage(
            'embeddings',
            EMBEDDING_MODEL,
            { inputTokens: tokens, totalTokens: tokens },
            {
                embedded: missingTexts.length,
                fromCache: uniqueHashes.length - missingHashes.length,
            },
        )
    }

    // Reassemble in original input order (every hash now has a vector).
    return hashes.map((h) => vectorByHash.get(h)!)
}

/** Embed a single text (cache-aware). Used for query-time embedding. */
export async function embedText(text: string, embedder?: RawEmbedder): Promise<number[]> {
    const [vector] = await embedTexts([text], embedder)
    return vector
}

/** Compose + embed a batch of movies, returning one vector per movie in order. */
export async function embedMovies(
    movies: EmbeddableMovie[],
    embedder?: RawEmbedder,
): Promise<number[][]> {
    return embedTexts(movies.map(composeEmbeddingText), embedder)
}

/** Compose + embed a single movie. */
export async function embedMovie(
    movie: EmbeddableMovie,
    embedder?: RawEmbedder,
): Promise<number[]> {
    return embedText(composeEmbeddingText(movie), embedder)
}
