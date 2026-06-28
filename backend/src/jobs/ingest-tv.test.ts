import { describe, expect, it } from 'bun:test'
import { ingestTvShows, prepareTvShow, type TvIngestDeps, type TvInsertRow } from './ingest-tv'
import type { TvForIngest } from '../lib/tmdb'

// Minimal TMDB TV detail factory — only the fields the ingester reads. Note the
// TV-native shapes: `name` (not title), `first_air_date`, keywords under
// `keywords.results` (movies nest under `keywords.keywords`).
const detail = (over: Partial<TvForIngest> = {}): TvForIngest =>
    ({
        id: 1,
        name: 'Breaking Bad',
        overview: 'A chemistry teacher turns to making meth.',
        poster_path: '/p.jpg',
        backdrop_path: '/b.jpg',
        first_air_date: '2008-01-20',
        genres: [
            { id: 1, name: 'Drama' },
            { id: 2, name: 'Crime' },
        ],
        keywords: { results: [{ id: 9, name: 'drug empire' }] },
        ...over,
    }) as TvForIngest

// Records embed/upsert calls and simulates a pre-existing catalog by hash.
const fakeDeps = (existing: Record<number, string> = {}) => {
    const calls = {
        embedded: [] as string[][],
        upserted: [] as TvInsertRow[][],
        hashLookups: [] as number[][],
    }
    const deps: TvIngestDeps = {
        async fetchExistingHashes(ids) {
            calls.hashLookups.push(ids)
            return new Map(ids.filter((id) => id in existing).map((id) => [id, existing[id]!]))
        },
        async upsertTvShows(rows) {
            calls.upserted.push(rows)
        },
        async embed(texts) {
            calls.embedded.push(texts)
            return texts.map(() => Array.from({ length: 1536 }, () => 0.1))
        },
    }
    return { deps, calls }
}

// ── prepareTvShow ────────────────────────────────────────────────────────────
describe('prepareTvShow', () => {
    it('maps TV fields (name→title, first_air_date→releaseDate, keywords.results) (feature)', () => {
        const p = prepareTvShow(detail())!
        expect(p.tmdbId).toBe(1)
        expect(p.row.title).toBe('Breaking Bad')
        expect(p.row.releaseDate).toBe('2008-01-20')
        expect(p.row.genres).toEqual(['Drama', 'Crime'])
        expect(p.row.keywords).toEqual(['drug empire'])
        // Composed into the SAME embedding-text format as movies, so a show and a
        // film share one vector space.
        expect(p.sourceText).toContain('Title: Breaking Bad')
        expect(p.sourceText).toContain('Genres: Drama, Crime')
        expect(p.sourceText).toContain('Keywords: drug empire')
        expect(p.row.sourceHash).toMatch(/^[0-9a-f]{64}$/)
    })

    it('returns null when id or name is missing (edge: unusable row)', () => {
        expect(prepareTvShow(detail({ id: undefined }))).toBeNull()
        expect(prepareTvShow(detail({ name: '   ' }))).toBeNull()
    })

    it('coerces an empty first_air_date to null (edge: partial TMDB row)', () => {
        const p = prepareTvShow(detail({ first_air_date: '' }))!
        expect(p.row.releaseDate).toBeNull()
    })

    it('tolerates missing genres/keywords (edge)', () => {
        const p = prepareTvShow(detail({ genres: undefined, keywords: undefined }))!
        expect(p.row.genres).toEqual([])
        expect(p.row.keywords).toEqual([])
    })

    it('produces the same hash for identical content (feature: idempotency key)', () => {
        expect(prepareTvShow(detail())!.row.sourceHash).toBe(
            prepareTvShow(detail())!.row.sourceHash,
        )
    })
})

// ── ingestTvShows: the idempotency core ──────────────────────────────────────
describe('ingestTvShows', () => {
    it('embeds and upserts new shows (feature)', async () => {
        const { deps, calls } = fakeDeps()
        const stats = await ingestTvShows([detail({ id: 1 }), detail({ id: 2 })], deps)

        expect(stats).toMatchObject({ total: 2, prepared: 2, invalid: 0, embedded: 2, skipped: 0 })
        expect(calls.embedded[0]).toHaveLength(2)
        expect(calls.upserted[0]).toHaveLength(2)
        expect(calls.upserted[0]![0]!.embedding).toHaveLength(1536)
    })

    it('skips rows whose source hash is unchanged (feature: the cost rule)', async () => {
        const known = prepareTvShow(detail({ id: 1 }))!.row.sourceHash!
        const { deps, calls } = fakeDeps({ 1: known })

        const stats = await ingestTvShows([detail({ id: 1 })], deps)

        expect(stats).toMatchObject({ embedded: 0, skipped: 1 })
        expect(calls.embedded).toHaveLength(0)
        expect(calls.upserted).toHaveLength(0)
    })

    it('re-embeds when stored hash differs (feature: content changed)', async () => {
        const { deps, calls } = fakeDeps({ 1: 'stale-hash' })
        const stats = await ingestTvShows([detail({ id: 1 })], deps)

        expect(stats).toMatchObject({ embedded: 1, skipped: 0 })
        expect(calls.embedded[0]).toHaveLength(1)
    })

    it('only embeds the changed subset of a mixed batch (feature)', async () => {
        const known = prepareTvShow(detail({ id: 1 }))!.row.sourceHash!
        const { deps, calls } = fakeDeps({ 1: known })

        const stats = await ingestTvShows([detail({ id: 1 }), detail({ id: 2 })], deps)

        expect(stats).toMatchObject({ embedded: 1, skipped: 1 })
        expect(calls.embedded[0]).toHaveLength(1)
        expect(calls.upserted[0]![0]!.tmdbId).toBe(2)
    })

    it('de-dupes a repeated tmdb_id within one batch, keeping the last (edge)', async () => {
        const { deps, calls } = fakeDeps()
        const stats = await ingestTvShows(
            [detail({ id: 5, name: 'Old' }), detail({ id: 5, name: 'New' })],
            deps,
        )

        expect(stats).toMatchObject({ prepared: 1, embedded: 1 })
        expect(calls.upserted[0]).toHaveLength(1)
        expect(calls.upserted[0]![0]!.title).toBe('New')
    })

    it('counts invalid rows and ingests the rest (edge)', async () => {
        const { deps } = fakeDeps()
        const stats = await ingestTvShows([detail({ id: 1 }), detail({ name: '' })], deps)
        expect(stats).toMatchObject({ total: 2, prepared: 1, invalid: 1, embedded: 1 })
    })

    it('does nothing for an empty batch (edge)', async () => {
        const { deps, calls } = fakeDeps()
        const stats = await ingestTvShows([], deps)
        expect(stats).toMatchObject({ total: 0, prepared: 0, embedded: 0, skipped: 0 })
        expect(calls.embedded).toHaveLength(0)
        expect(calls.upserted).toHaveLength(0)
    })

    it('throws if an embedding has the wrong dimension (edge: corrupt vector)', async () => {
        const { deps } = fakeDeps()
        deps.embed = async (texts) => texts.map(() => [0.1, 0.2])
        expect(ingestTvShows([detail({ id: 1 })], deps)).rejects.toThrow(/embedding/)
    })
})
