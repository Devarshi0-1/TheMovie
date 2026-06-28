import { inArray, sql } from 'drizzle-orm'
import { db } from '../db'
import { tvShows } from '../db/schema'
import {
    composeEmbeddingText,
    contentHashFor,
    embedTexts,
    EMBEDDING_DIMENSIONS,
} from '../lib/embeddings'
import { discoverTvPage, getPopularTvPage, getTvForIngest, type TvForIngest } from '../lib/tmdb'
import { capForEmbedding, collectCatalogPages } from './ingest'

// The TV mirror of `ingest.ts` (Phase 10 — TV as first-class). Same idempotent
// core — prepare → skip unchanged (by source hash) → embed only the changed
// subset → upsert keyed on `tmdb_id` — but targeting the `tv_shows` table and
// mapping TMDB's TV shape (`name` → title, `first_air_date` → releaseDate,
// keywords nested under `keywords.results`). The embedding text composition,
// hashing, capping, and cache all reuse the shared movie helpers, so a show and
// a film land in the same vector space and a re-run is a cheap no-op.

export type TvInsertRow = typeof tvShows.$inferInsert
type TvInsert = TvInsertRow

export interface PreparedTvShow {
    tmdbId: number
    /** The exact text that will be embedded (already capped). */
    sourceText: string
    /** Row to upsert, minus the `embedding` (filled in after embedding). */
    row: Omit<TvInsert, 'embedding'>
}

/**
 * Map an enriched TMDB TV detail into a prepared, upsert-ready row plus the text
 * to embed and its content hash. Returns `null` for rows missing the natural key
 * or a name (a show row is meaningless without either).
 */
export function prepareTvShow(detail: TvForIngest): PreparedTvShow | null {
    const tmdbId = detail.id
    const title = detail.name?.trim()
    if (typeof tmdbId !== 'number' || !title) return null

    const genres = (detail.genres ?? [])
        .map((g) => g.name?.trim())
        .filter((n): n is string => Boolean(n))
    const keywords = (detail.keywords?.results ?? [])
        .map((k) => k.name?.trim())
        .filter((n): n is string => Boolean(n))

    const sourceText = capForEmbedding(
        composeEmbeddingText({ title, overview: detail.overview, genres, keywords }),
    )

    return {
        tmdbId,
        sourceText,
        row: {
            tmdbId,
            title,
            overview: detail.overview ?? null,
            posterPath: detail.poster_path ?? null,
            backdropPath: detail.backdrop_path ?? null,
            releaseDate: detail.first_air_date || null,
            genres,
            keywords,
            metadata: detail,
            sourceHash: contentHashFor(sourceText),
        },
    }
}

// Keep the last occurrence of each tmdb_id so a duplicate within one batch can't
// trigger a same-key conflict in a single INSERT statement.
function dedupeByTmdbId(prepared: PreparedTvShow[]): PreparedTvShow[] {
    const byId = new Map<number, PreparedTvShow>()
    for (const p of prepared) byId.set(p.tmdbId, p)
    return [...byId.values()]
}

export interface IngestStats {
    total: number
    prepared: number
    invalid: number
    embedded: number
    skipped: number
}

// IO seams, injected so the idempotency core is testable without a live DB/API.
export interface TvIngestDeps {
    fetchExistingHashes: (tmdbIds: number[]) => Promise<Map<number, string>>
    upsertTvShows: (rows: TvInsert[]) => Promise<void>
    embed: (texts: string[]) => Promise<number[][]>
}

function defaultDeps(): TvIngestDeps {
    return {
        async fetchExistingHashes(tmdbIds) {
            if (tmdbIds.length === 0) return new Map()
            const rows = await db
                .select({ tmdbId: tvShows.tmdbId, sourceHash: tvShows.sourceHash })
                .from(tvShows)
                .where(inArray(tvShows.tmdbId, tmdbIds))
            return new Map(rows.map((r) => [r.tmdbId, r.sourceHash ?? '']))
        },
        async upsertTvShows(rows) {
            if (rows.length === 0) return
            await db
                .insert(tvShows)
                .values(rows)
                .onConflictDoUpdate({
                    target: tvShows.tmdbId,
                    set: {
                        title: sql`excluded.title`,
                        overview: sql`excluded.overview`,
                        posterPath: sql`excluded.poster_path`,
                        backdropPath: sql`excluded.backdrop_path`,
                        releaseDate: sql`excluded.release_date`,
                        genres: sql`excluded.genres`,
                        keywords: sql`excluded.keywords`,
                        metadata: sql`excluded.metadata`,
                        embedding: sql`excluded.embedding`,
                        sourceHash: sql`excluded.source_hash`,
                        updatedAt: new Date(),
                    },
                })
        },
        embed: embedTexts,
    }
}

/**
 * Idempotent ingestion core: prepare → skip unchanged (by source hash) → embed
 * only the changed subset → upsert keyed on `tmdb_id`. Pure decision logic with
 * all IO behind `deps`, so re-running over the same catalog is a cheap no-op.
 */
export async function ingestTvShows(
    details: TvForIngest[],
    deps: TvIngestDeps = defaultDeps(),
): Promise<IngestStats> {
    const preparedRaw = details.map(prepareTvShow)
    const invalid = preparedRaw.filter((p) => p === null).length
    const prepared = dedupeByTmdbId(preparedRaw.filter((p): p is PreparedTvShow => p !== null))

    const existing = await deps.fetchExistingHashes(prepared.map((p) => p.tmdbId))
    const changed = prepared.filter((p) => existing.get(p.tmdbId) !== p.row.sourceHash)

    if (changed.length > 0) {
        const vectors = await deps.embed(changed.map((p) => p.sourceText))
        const rows: TvInsert[] = changed.map((p, i) => {
            const embedding = vectors[i]
            if (!embedding || embedding.length !== EMBEDDING_DIMENSIONS) {
                throw new Error(
                    `Missing/invalid embedding for tmdb_id ${p.tmdbId} (got ${embedding?.length})`,
                )
            }
            return { ...p.row, embedding }
        })
        await deps.upsertTvShows(rows)
    }

    return {
        total: details.length,
        prepared: prepared.length,
        invalid,
        embedded: changed.length,
        skipped: prepared.length - changed.length,
    }
}

// Bounded-concurrency map; a single failed enrichment yields null rather than
// aborting the whole run (one 404 shouldn't sink a 500-show backfill).
async function mapWithConcurrency<T, R>(
    items: T[],
    fn: (item: T) => Promise<R>,
    limit: number,
): Promise<(R | null)[]> {
    const results: (R | null)[] = new Array(items.length).fill(null)
    let cursor = 0
    const workerCount = Math.max(1, Math.min(limit, items.length))
    const workers = Array.from({ length: workerCount }, async () => {
        while (true) {
            const i = cursor++
            if (i >= items.length) break
            try {
                results[i] = await fn(items[i]!)
            } catch (err) {
                console.error(`⚠️ TV enrichment failed for item ${i}:`, err)
                results[i] = null
            }
        }
    })
    await Promise.all(workers)
    return results
}

export type IngestMode = 'backfill' | 'incremental'

export interface RunIngestTvOptions {
    /** `backfill` = popularity-ordered catalog; `incremental` = popular feed. */
    mode?: IngestMode
    /** How many catalog pages to pull (20 shows/page). */
    pages?: number
    /** First page number (1-based). */
    startPage?: number
    /** Max concurrent enrichment requests. */
    concurrency?: number
}

/**
 * End-to-end run: pull catalog pages → enrich each show (detail + keywords) →
 * ingest. Backfill seeds the full catalog; incremental pulls the popular feed.
 */
export async function runIngestTv(opts: RunIngestTvOptions = {}): Promise<IngestStats> {
    const { mode = 'backfill', pages = 1, startPage = 1, concurrency = 8 } = opts
    const fetchPage = mode === 'incremental' ? getPopularTvPage : discoverTvPage

    const summaries = await collectCatalogPages(fetchPage, startPage, pages, `TV ${mode}`, 'shows')

    const ids = [
        ...new Set(summaries.map((s) => s.id).filter((id): id is number => typeof id === 'number')),
    ]
    console.log(`📺 Enriching ${ids.length} shows (detail + keywords)…`)
    const details = await mapWithConcurrency(ids, getTvForIngest, concurrency)

    const stats = await ingestTvShows(details.filter((d): d is TvForIngest => d !== null))
    console.log('✅ TV ingest complete:', stats)
    return stats
}

// CLI entry: `bun run src/jobs/ingest-tv.ts [--incremental] [--pages=N] [--start-page=N]`
if (import.meta.main) {
    const args = process.argv.slice(2)
    const mode: IngestMode = args.includes('--incremental') ? 'incremental' : 'backfill'
    const numFlag = (flag: string, fallback: number) => {
        const arg = args.find((a) => a.startsWith(flag))
        return arg ? Number(arg.split('=')[1]) : fallback
    }

    runIngestTv({
        mode,
        pages: numFlag('--pages=', 1),
        startPage: numFlag('--start-page=', 1),
    })
        .then(() => process.exit(0))
        .catch((err) => {
            console.error('❌ TV ingest failed:', err)
            process.exit(1)
        })
}
