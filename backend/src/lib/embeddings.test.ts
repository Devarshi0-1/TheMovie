import { afterEach, beforeEach, describe, expect, it, mock } from 'bun:test'

// ── Mocks ───────────────────────────────────────────────────────────────────
// The embedding service must be testable offline: no real OpenAI key, no live
// Redis. We mock the AI SDK's `embedMany` and the local redis re-export, and
// record how each is called so we can assert cache behavior + cost control.

let embedManyCalls: { values: string[] }[] = []
// Deterministic fake vector for a text: 1536 dims so dimension validation passes.
const fakeVector = (text: string): number[] => {
    const seed = text.length % 7
    return Array.from({ length: 1536 }, (_, i) => (i + seed) / 1536)
}

mock.module('ai', () => ({
    embedMany: async ({ values }: { values: string[] }) => {
        embedManyCalls.push({ values })
        return {
            values,
            embeddings: values.map(fakeVector),
            usage: { tokens: values.reduce((n, v) => n + v.length, 0) },
        }
    },
}))

// In-memory Redis stand-in with the subset of the API the service uses.
const store = new Map<string, string>()
let getCalls = 0
let setCalls = 0
mock.module('./redis', () => ({
    redis: {
        get: async (key: string) => {
            getCalls++
            return store.get(key) ?? null
        },
        set: async (key: string, value: string) => {
            setCalls++
            store.set(key, value)
            return 'OK'
        },
    },
}))

const {
    composeEmbeddingText,
    contentHashFor,
    embedTexts,
    embedText,
    embedMovie,
    embedMovies,
    EMBEDDING_DIMENSIONS,
} = await import('./embeddings')

beforeEach(() => {
    embedManyCalls = []
    getCalls = 0
    setCalls = 0
    store.clear()
    process.env.OPENAI_API_KEY = 'test-key'
})

afterEach(() => {
    mock.restore()
})

// ── composeEmbeddingText ─────────────────────────────────────────────────────
describe('composeEmbeddingText', () => {
    it('combines title, overview, genres and keywords (feature)', () => {
        const text = composeEmbeddingText({
            title: 'Inception',
            overview: 'A thief steals secrets through dreams.',
            genres: [
                { id: 1, name: 'Sci-Fi' },
                { id: 2, name: 'Thriller' },
            ],
            keywords: ['dream', 'heist'],
        })

        expect(text).toContain('Title: Inception')
        expect(text).toContain('Overview: A thief steals secrets through dreams.')
        expect(text).toContain('Genres: Sci-Fi, Thriller')
        expect(text).toContain('Keywords: dream, heist')
    })

    it('omits empty/missing fields and keeps title only (edge: partial TMDB row)', () => {
        const text = composeEmbeddingText({ title: 'Untitled', overview: '   ', genres: [] })
        expect(text).toBe('Title: Untitled')
    })

    it('de-dupes labels and ignores malformed entries (edge: dirty jsonb)', () => {
        const text = composeEmbeddingText({
            title: 'X',
            genres: [{ name: 'Drama' }, { name: 'Drama' }, { id: 9 }, null, 'Drama'],
        })
        expect(text).toBe('Title: X\nGenres: Drama')
    })
})

// ── contentHashFor ───────────────────────────────────────────────────────────
describe('contentHashFor', () => {
    it('is stable and content-addressed (feature: idempotency key)', () => {
        expect(contentHashFor('hello')).toBe(contentHashFor('hello'))
        expect(contentHashFor('hello')).not.toBe(contentHashFor('world'))
        expect(contentHashFor('hello')).toMatch(/^[0-9a-f]{64}$/)
    })
})

// ── embedTexts: core cache + batching behavior ───────────────────────────────
describe('embedTexts', () => {
    it('returns a 1536-dim vector per input in order (feature)', async () => {
        const out = await embedTexts(['a', 'bb'])
        expect(out).toHaveLength(2)
        expect(out[0]).toHaveLength(EMBEDDING_DIMENSIONS)
        expect(out[0]).toEqual(fakeVector('a'))
        expect(out[1]).toEqual(fakeVector('bb'))
    })

    it('returns [] for empty input without calling OpenAI (edge)', async () => {
        const out = await embedTexts([])
        expect(out).toEqual([])
        expect(embedManyCalls).toHaveLength(0)
    })

    it('writes embeddings to the cache on a miss (feature: cost control)', async () => {
        await embedTexts(['fresh'])
        expect(embedManyCalls).toHaveLength(1)
        expect(setCalls).toBe(1)
    })

    it('never re-embeds cached text (feature: the headline cost rule)', async () => {
        await embedTexts(['cached'])
        embedManyCalls = []
        setCalls = 0

        const out = await embedTexts(['cached'])
        expect(embedManyCalls).toHaveLength(0) // served entirely from cache
        expect(setCalls).toBe(0)
        expect(out[0]).toEqual(fakeVector('cached'))
    })

    it('only embeds the missing subset of a mixed batch (feature)', async () => {
        await embedTexts(['known'])
        embedManyCalls = []

        const out = await embedTexts(['known', 'new'])
        expect(embedManyCalls).toHaveLength(1)
        expect(embedManyCalls[0].values).toEqual(['new']) // 'known' came from cache
        expect(out[0]).toEqual(fakeVector('known'))
        expect(out[1]).toEqual(fakeVector('new'))
    })

    it('de-dupes identical texts within one batch (edge: embed once)', async () => {
        const out = await embedTexts(['dup', 'dup', 'dup'])
        expect(embedManyCalls).toHaveLength(1)
        expect(embedManyCalls[0].values).toEqual(['dup']) // embedded a single time
        expect(out[0]).toEqual(out[1])
        expect(out[1]).toEqual(out[2])
    })

    it('throws a clear error when the API key is missing on a miss (edge: config)', async () => {
        delete process.env.OPENAI_API_KEY
        expect(embedTexts(['needs-key'])).rejects.toThrow(/OPENAI_API_KEY/)
    })

    it('serves fully-cached batches without needing an API key (edge)', async () => {
        await embedTexts(['warm'])
        delete process.env.OPENAI_API_KEY
        const out = await embedTexts(['warm'])
        expect(out[0]).toEqual(fakeVector('warm'))
    })
})

// ── Movie/single helpers ─────────────────────────────────────────────────────
describe('embedMovie / embedMovies / embedText', () => {
    it('embedText returns a single vector (feature)', async () => {
        const v = await embedText('solo')
        expect(v).toEqual(fakeVector('solo'))
    })

    it('embedMovie composes then embeds (feature)', async () => {
        const v = await embedMovie({ title: 'Solaris', overview: 'A space station drama.' })
        expect(v).toHaveLength(EMBEDDING_DIMENSIONS)
        expect(embedManyCalls[0].values[0]).toContain('Title: Solaris')
    })

    it('embedMovies returns one vector per movie in order (feature)', async () => {
        const out = await embedMovies([{ title: 'A' }, { title: 'B' }])
        expect(out).toHaveLength(2)
        expect(embedManyCalls[0].values).toEqual(['Title: A', 'Title: B'])
    })
})
