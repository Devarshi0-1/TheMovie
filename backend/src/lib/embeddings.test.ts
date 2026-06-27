import { beforeEach, describe, expect, it } from 'bun:test'
import {
    composeEmbeddingText,
    composeSummaryEmbeddingText,
    contentHashFor,
    embedMovie,
    embedMovies,
    embedText,
    embedTexts,
    EMBEDDING_DIMENSIONS,
    type EmbeddingCache,
    type RawEmbedder,
} from './embeddings'

// The embedding service must be testable offline: no real OpenAI key, no live
// Redis. We inject a fake embedder AND a fake cache (so neither the shared `ai`
// module nor `./redis` is ever module-mocked — a global module mock would leak
// across test files). Both record calls so we can assert cache behavior + cost.

let embedderCalls: string[][] = []
// Deterministic fake vector for a text: 1536 dims so dimension validation passes.
const fakeVector = (text: string): number[] => {
    const seed = text.length % 7
    return Array.from({ length: 1536 }, (_, i) => (i + seed) / 1536)
}
const fakeEmbedder: RawEmbedder = async (texts) => {
    embedderCalls.push(texts)
    return {
        embeddings: texts.map(fakeVector),
        tokens: texts.reduce((n, v) => n + v.length, 0),
    }
}

// In-memory cache stand-in.
const store = new Map<string, string>()
let setCalls = 0
const fakeCache: EmbeddingCache = {
    async get(key) {
        return store.get(key) ?? null
    },
    async set(key, value) {
        setCalls++
        store.set(key, value)
    },
}

beforeEach(() => {
    embedderCalls = []
    setCalls = 0
    store.clear()
    process.env.OPENAI_API_KEY = 'test-key'
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

    it('composeSummaryEmbeddingText labels vibe, pros, and cons (feature: reception vector)', () => {
        const text = composeSummaryEmbeddingText({
            vibe: 'A tense, well-acted thriller.',
            pros: ['Strong performances', 'Gripping pacing'],
            cons: ['Slow middle act'],
        })
        expect(text).toContain('Audience consensus: A tense, well-acted thriller.')
        expect(text).toContain('Audiences praised: Strong performances, Gripping pacing')
        expect(text).toContain('Audiences criticized: Slow middle act')
    })

    it('composeSummaryEmbeddingText returns empty string for a literally-empty summary (edge)', () => {
        expect(composeSummaryEmbeddingText({ vibe: '', pros: [], cons: [] })).toBe('')
        expect(composeSummaryEmbeddingText({ vibe: '  ', pros: ['  '], cons: [] })).toBe('')
    })

    it('composeSummaryEmbeddingText keeps whichever fields are present (edge: partial)', () => {
        const text = composeSummaryEmbeddingText({ vibe: 'Divisive.', pros: [], cons: [] })
        expect(text).toBe('Audience consensus: Divisive.')
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
        const out = await embedTexts(['a', 'bb'], fakeEmbedder, fakeCache)
        expect(out).toHaveLength(2)
        expect(out[0]).toHaveLength(EMBEDDING_DIMENSIONS)
        expect(out[0]).toEqual(fakeVector('a'))
        expect(out[1]).toEqual(fakeVector('bb'))
    })

    it('returns [] for empty input without embedding (edge)', async () => {
        const out = await embedTexts([], fakeEmbedder, fakeCache)
        expect(out).toEqual([])
        expect(embedderCalls).toHaveLength(0)
    })

    it('writes embeddings to the cache on a miss (feature: cost control)', async () => {
        await embedTexts(['fresh'], fakeEmbedder, fakeCache)
        expect(embedderCalls).toHaveLength(1)
        expect(setCalls).toBe(1)
    })

    it('never re-embeds cached text (feature: the headline cost rule)', async () => {
        await embedTexts(['cached'], fakeEmbedder, fakeCache)
        embedderCalls = []
        setCalls = 0

        const out = await embedTexts(['cached'], fakeEmbedder, fakeCache)
        expect(embedderCalls).toHaveLength(0) // served entirely from cache
        expect(setCalls).toBe(0)
        expect(out[0]).toEqual(fakeVector('cached'))
    })

    it('only embeds the missing subset of a mixed batch (feature)', async () => {
        await embedTexts(['known'], fakeEmbedder, fakeCache)
        embedderCalls = []

        const out = await embedTexts(['known', 'new'], fakeEmbedder, fakeCache)
        expect(embedderCalls).toHaveLength(1)
        expect(embedderCalls[0]).toEqual(['new']) // 'known' came from cache
        expect(out[0]).toEqual(fakeVector('known'))
        expect(out[1]).toEqual(fakeVector('new'))
    })

    it('de-dupes identical texts within one batch (edge: embed once)', async () => {
        const out = await embedTexts(['dup', 'dup', 'dup'], fakeEmbedder, fakeCache)
        expect(embedderCalls).toHaveLength(1)
        expect(embedderCalls[0]).toEqual(['dup']) // embedded a single time
        expect(out[0]).toEqual(out[1])
        expect(out[1]).toEqual(out[2])
    })

    it('throws a clear error when the API key is missing on a miss (edge: config)', async () => {
        delete process.env.OPENAI_API_KEY
        expect(embedTexts(['needs-key'], fakeEmbedder, fakeCache)).rejects.toThrow(/OPENAI_API_KEY/)
    })

    it('serves fully-cached batches without needing an API key (edge)', async () => {
        await embedTexts(['warm'], fakeEmbedder, fakeCache)
        delete process.env.OPENAI_API_KEY
        const out = await embedTexts(['warm'], fakeEmbedder, fakeCache)
        expect(out[0]).toEqual(fakeVector('warm'))
    })
})

// ── Movie/single helpers ─────────────────────────────────────────────────────
describe('embedMovie / embedMovies / embedText', () => {
    it('embedText returns a single vector (feature)', async () => {
        const v = await embedText('solo', fakeEmbedder, fakeCache)
        expect(v).toEqual(fakeVector('solo'))
    })

    it('embedMovie composes then embeds (feature)', async () => {
        const v = await embedMovie(
            { title: 'Solaris', overview: 'A space station drama.' },
            fakeEmbedder,
            fakeCache,
        )
        expect(v).toHaveLength(EMBEDDING_DIMENSIONS)
        expect(embedderCalls[0][0]).toContain('Title: Solaris')
    })

    it('embedMovies returns one vector per movie in order (feature)', async () => {
        const out = await embedMovies([{ title: 'A' }, { title: 'B' }], fakeEmbedder, fakeCache)
        expect(out).toHaveLength(2)
        expect(embedderCalls[0]).toEqual(['Title: A', 'Title: B'])
    })
})
