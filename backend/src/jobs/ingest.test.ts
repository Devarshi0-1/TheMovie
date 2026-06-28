import { describe, expect, it } from 'bun:test'
import {
    chunkText,
    collectCatalogPages,
    ingestMovies,
    prepareMovie,
    type IngestDeps,
    type MovieInsertRow,
} from './ingest'
import type { MovieForIngest } from '../lib/tmdb'

// Minimal TMDB detail factory — only the fields the ingester reads.
const detail = (over: Partial<MovieForIngest> = {}): MovieForIngest =>
    ({
        id: 1,
        title: 'Inception',
        overview: 'A thief steals secrets through dreams.',
        poster_path: '/p.jpg',
        backdrop_path: '/b.jpg',
        release_date: '2010-07-16',
        genres: [
            { id: 1, name: 'Sci-Fi' },
            { id: 2, name: 'Thriller' },
        ],
        keywords: { keywords: [{ id: 9, name: 'dream' }] },
        ...over,
    }) as MovieForIngest

// Records embed/upsert calls and simulates a pre-existing catalog by hash.
const fakeDeps = (existing: Record<number, string> = {}) => {
    const calls = {
        embedded: [] as string[][],
        upserted: [] as MovieInsertRow[][],
        hashLookups: [] as number[][],
    }
    const deps: IngestDeps = {
        async fetchExistingHashes(ids) {
            calls.hashLookups.push(ids)
            return new Map(ids.filter((id) => id in existing).map((id) => [id, existing[id]!]))
        },
        async upsertMovies(rows) {
            calls.upserted.push(rows)
        },
        async embed(texts) {
            calls.embedded.push(texts)
            return texts.map(() => Array.from({ length: 1536 }, () => 0.1))
        },
    }
    return { deps, calls }
}

// ── collectCatalogPages (page-loop resilience) ───────────────────────────────
describe('collectCatalogPages', () => {
    // A fake page source: returns N items per page, but throws for pages listed
    // in `failPages` (simulating a transient fetch failure that outlived retries).
    const pageSource = (failPages: Set<number> = new Set(), perPage = 2) => {
        const seen: number[] = []
        const fetchPage = async (page: number) => {
            seen.push(page)
            if (failPages.has(page)) throw new Error(`ECONNRESET on page ${page}`)
            return Array.from({ length: perPage }, (_, i) => ({ id: page * 100 + i }))
        }
        return { fetchPage, seen }
    }

    it('collects every item across pages, honoring startPage (feature)', async () => {
        const { fetchPage, seen } = pageSource()
        const out = await collectCatalogPages(fetchPage, 3, 4, 'backfill', 'movies')
        expect(seen).toEqual([3, 4, 5, 6]) // startPage=3, pages=4
        expect(out).toHaveLength(8) // 4 pages × 2 items
        expect(out.map((i) => i.id)).toContain(300)
    })

    it('skips a page that fails and keeps going, returning the rest (feature: resilience)', async () => {
        // Page 2 blows up; pages 1 and 3 must still be collected.
        const { fetchPage, seen } = pageSource(new Set([2]))
        const out = await collectCatalogPages(fetchPage, 1, 3, 'backfill', 'movies')
        expect(seen).toEqual([1, 2, 3]) // it did not abort on page 2
        expect(out).toHaveLength(4) // pages 1 + 3 only (2 items each)
        expect(out.map((i) => i.id).sort((a, b) => a - b)).toEqual([100, 101, 300, 301])
    })

    it('returns [] (never throws) when every page fails (edge: total outage)', async () => {
        const { fetchPage } = pageSource(new Set([1, 2]))
        const out = await collectCatalogPages(fetchPage, 1, 2, 'TV backfill', 'shows')
        expect(out).toEqual([])
    })
})

// ── chunkText ────────────────────────────────────────────────────────────────
describe('chunkText', () => {
    it('returns a single chunk when text fits (feature)', () => {
        expect(chunkText('short text', 100)).toEqual(['short text'])
    })

    it('returns [] for empty/whitespace input (edge)', () => {
        expect(chunkText('   ', 100)).toEqual([])
    })

    it('splits long text into chunks within the limit (feature)', () => {
        const text = 'word '.repeat(500).trim() // 2499 chars
        const chunks = chunkText(text, 100)
        expect(chunks.length).toBeGreaterThan(1)
        for (const c of chunks) expect(c.length).toBeLessThanOrEqual(100)
        // No content lost (modulo whitespace at break points).
        expect(chunks.join(' ').replace(/\s+/g, ' ')).toBe(text)
    })

    it('breaks on sentence boundaries when available (feature)', () => {
        const text = 'First sentence here. Second sentence follows after the break.'
        const chunks = chunkText(text, 35)
        expect(chunks[0]).toBe('First sentence here.')
    })

    it('rejects a non-positive limit (edge)', () => {
        expect(() => chunkText('x', 0)).toThrow(/positive/)
    })
})

// ── prepareMovie ─────────────────────────────────────────────────────────────
describe('prepareMovie', () => {
    it('maps fields and composes embeddable source text (feature)', () => {
        const p = prepareMovie(detail())!
        expect(p.tmdbId).toBe(1)
        expect(p.row.title).toBe('Inception')
        expect(p.row.genres).toEqual(['Sci-Fi', 'Thriller'])
        expect(p.row.keywords).toEqual(['dream'])
        expect(p.sourceText).toContain('Title: Inception')
        expect(p.sourceText).toContain('Genres: Sci-Fi, Thriller')
        expect(p.sourceText).toContain('Keywords: dream')
        expect(p.row.sourceHash).toMatch(/^[0-9a-f]{64}$/)
    })

    it('returns null when id or title is missing (edge: unusable row)', () => {
        expect(prepareMovie(detail({ id: undefined }))).toBeNull()
        expect(prepareMovie(detail({ title: '   ' }))).toBeNull()
    })

    it('coerces an empty release_date to null (edge: partial TMDB row)', () => {
        const p = prepareMovie(detail({ release_date: '' }))!
        expect(p.row.releaseDate).toBeNull()
    })

    it('produces the same hash for identical content (feature: idempotency key)', () => {
        expect(prepareMovie(detail())!.row.sourceHash).toBe(prepareMovie(detail())!.row.sourceHash)
    })
})

// ── ingestMovies: the idempotency core ───────────────────────────────────────
describe('ingestMovies', () => {
    it('embeds and upserts new movies (feature)', async () => {
        const { deps, calls } = fakeDeps()
        const stats = await ingestMovies([detail({ id: 1 }), detail({ id: 2 })], deps)

        expect(stats).toMatchObject({ total: 2, prepared: 2, invalid: 0, embedded: 2, skipped: 0 })
        expect(calls.embedded[0]).toHaveLength(2)
        expect(calls.upserted[0]).toHaveLength(2)
        expect(calls.upserted[0]![0]!.embedding).toHaveLength(1536)
    })

    it('skips rows whose source hash is unchanged (feature: the cost rule)', async () => {
        // Seed existing hash to match what prepareMovie will compute.
        const known = prepareMovie(detail({ id: 1 }))!.row.sourceHash!
        const { deps, calls } = fakeDeps({ 1: known })

        const stats = await ingestMovies([detail({ id: 1 })], deps)

        expect(stats).toMatchObject({ embedded: 0, skipped: 1 })
        expect(calls.embedded).toHaveLength(0) // never re-embedded
        expect(calls.upserted).toHaveLength(0) // never re-written
    })

    it('re-embeds when stored hash differs (feature: content changed)', async () => {
        const { deps, calls } = fakeDeps({ 1: 'stale-hash' })
        const stats = await ingestMovies([detail({ id: 1 })], deps)

        expect(stats).toMatchObject({ embedded: 1, skipped: 0 })
        expect(calls.embedded[0]).toHaveLength(1)
    })

    it('only embeds the changed subset of a mixed batch (feature)', async () => {
        const known = prepareMovie(detail({ id: 1 }))!.row.sourceHash!
        const { deps, calls } = fakeDeps({ 1: known })

        const stats = await ingestMovies([detail({ id: 1 }), detail({ id: 2 })], deps)

        expect(stats).toMatchObject({ embedded: 1, skipped: 1 })
        expect(calls.embedded[0]).toHaveLength(1) // only movie 2
        expect(calls.upserted[0]).toHaveLength(1)
        expect(calls.upserted[0]![0]!.tmdbId).toBe(2)
    })

    it('de-dupes a repeated tmdb_id within one batch, keeping the last (edge)', async () => {
        const { deps, calls } = fakeDeps()
        const stats = await ingestMovies(
            [detail({ id: 5, title: 'Old' }), detail({ id: 5, title: 'New' })],
            deps,
        )

        expect(stats).toMatchObject({ prepared: 1, embedded: 1 })
        expect(calls.upserted[0]).toHaveLength(1)
        expect(calls.upserted[0]![0]!.title).toBe('New')
    })

    it('counts invalid rows and ingests the rest (edge)', async () => {
        const { deps } = fakeDeps()
        const stats = await ingestMovies([detail({ id: 1 }), detail({ title: '' })], deps)
        expect(stats).toMatchObject({ total: 2, prepared: 1, invalid: 1, embedded: 1 })
    })

    it('does nothing for an empty batch (edge)', async () => {
        const { deps, calls } = fakeDeps()
        const stats = await ingestMovies([], deps)
        expect(stats).toMatchObject({ total: 0, prepared: 0, embedded: 0, skipped: 0 })
        expect(calls.embedded).toHaveLength(0)
        expect(calls.upserted).toHaveLength(0)
    })

    it('throws if an embedding has the wrong dimension (edge: corrupt vector)', async () => {
        const { deps } = fakeDeps()
        deps.embed = async (texts) => texts.map(() => [0.1, 0.2]) // wrong dim
        expect(ingestMovies([detail({ id: 1 })], deps)).rejects.toThrow(/embedding/)
    })
})
