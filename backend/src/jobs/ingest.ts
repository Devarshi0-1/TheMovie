import { inArray, sql } from 'drizzle-orm'
import { db } from '../db'
import { movies } from '../db/schema'
import {
    composeEmbeddingText,
    contentHashFor,
    embedTexts,
    EMBEDDING_DIMENSIONS,
} from '../lib/embeddings'
import {
    discoverMoviePage,
    getMovieForIngest,
    getNowPlayingPage,
    type MovieForIngest,
} from '../lib/tmdb'

// text-embedding-3-small accepts ~8191 tokens (~30k chars). Movie text is far
// shorter, but cap defensively so an oversized field can never overflow the
// model's input window. Reviews (Phase 4.5/5.2) are the realistic chunk case.
const EMBED_INPUT_CHAR_BUDGET = 30_000

export type MovieInsertRow = typeof movies.$inferInsert
type MovieInsert = MovieInsertRow

/**
 * Split text into chunks no longer than `maxChars`, breaking on the coarsest
 * available boundary (paragraph → sentence → word) before falling back to a
 * hard cut. Keeps embeddable units semantically whole.
 */
export function chunkText(text: string, maxChars = 2000): string[] {
    if (maxChars <= 0) throw new Error('maxChars must be positive')

    const trimmed = text.trim()
    if (trimmed.length <= maxChars) return trimmed ? [trimmed] : []

    const chunks: string[] = []
    let rest = trimmed
    while (rest.length > maxChars) {
        const window = rest.slice(0, maxChars)
        // Prefer the last paragraph break, then sentence, then word boundary.
        const breakAt =
            lastBoundary(window, '\n\n') ?? lastBoundary(window, '. ') ?? window.lastIndexOf(' ')
        const cut = breakAt && breakAt > maxChars * 0.5 ? breakAt : maxChars
        chunks.push(rest.slice(0, cut).trim())
        rest = rest.slice(cut).trim()
    }
    if (rest) chunks.push(rest)
    return chunks
}

function lastBoundary(window: string, sep: string): number | null {
    const idx = window.lastIndexOf(sep)
    return idx === -1 ? null : idx + sep.length
}

// Cap composed text to the model window. Movie text never hits this, but a
// stray oversized overview would otherwise be rejected by the embeddings API.
function capForEmbedding(text: string): string {
    if (text.length <= EMBED_INPUT_CHAR_BUDGET) return text
    const [head] = chunkText(text, EMBED_INPUT_CHAR_BUDGET)
    return head ?? text.slice(0, EMBED_INPUT_CHAR_BUDGET)
}

export interface PreparedMovie {
    tmdbId: number
    /** The exact text that will be embedded (already capped). */
    sourceText: string
    /** Row to upsert, minus the `embedding` (filled in after embedding). */
    row: Omit<MovieInsert, 'embedding'>
}

/**
 * Map an enriched TMDB detail into a prepared, upsert-ready row plus the text to
 * embed and its content hash. Returns `null` for rows missing the natural key or
 * a title (a movie row is meaningless without either).
 */
export function prepareMovie(detail: MovieForIngest): PreparedMovie | null {
    const tmdbId = detail.id
    const title = detail.title?.trim()
    if (typeof tmdbId !== 'number' || !title) return null

    const genres = (detail.genres ?? [])
        .map((g) => g.name?.trim())
        .filter((n): n is string => Boolean(n))
    const keywords = (detail.keywords?.keywords ?? [])
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
            releaseDate: detail.release_date || null,
            genres,
            keywords,
            // Raw TMDB blob lives in the GIN-indexed metadata column.
            metadata: detail,
            sourceHash: contentHashFor(sourceText),
        },
    }
}

// Keep the last occurrence of each tmdb_id so a duplicate within one batch can't
// trigger a same-key conflict in a single INSERT statement.
function dedupeByTmdbId(prepared: PreparedMovie[]): PreparedMovie[] {
    const byId = new Map<number, PreparedMovie>()
    for (const p of prepared) byId.set(p.tmdbId, p)
    return [...byId.values()]
}

export interface IngestStats {
    /** Details handed to the ingester. */
    total: number
    /** Valid, de-duplicated rows. */
    prepared: number
    /** Dropped for missing id/title. */
    invalid: number
    /** Embedded + written (new or changed source text). */
    embedded: number
    /** Unchanged source hash — skipped, no embed, no write. */
    skipped: number
}

// IO seams, injected so the idempotency core is testable without a live DB/API.
export interface IngestDeps {
    fetchExistingHashes: (tmdbIds: number[]) => Promise<Map<number, string>>
    upsertMovies: (rows: MovieInsert[]) => Promise<void>
    embed: (texts: string[]) => Promise<number[][]>
}

function defaultDeps(): IngestDeps {
    return {
        async fetchExistingHashes(tmdbIds) {
            if (tmdbIds.length === 0) return new Map()
            const rows = await db
                .select({ tmdbId: movies.tmdbId, sourceHash: movies.sourceHash })
                .from(movies)
                .where(inArray(movies.tmdbId, tmdbIds))
            return new Map(rows.map((r) => [r.tmdbId, r.sourceHash ?? '']))
        },
        async upsertMovies(rows) {
            if (rows.length === 0) return
            await db
                .insert(movies)
                .values(rows)
                .onConflictDoUpdate({
                    target: movies.tmdbId,
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
export async function ingestMovies(
    details: MovieForIngest[],
    deps: IngestDeps = defaultDeps(),
): Promise<IngestStats> {
    const preparedRaw = details.map(prepareMovie)
    const invalid = preparedRaw.filter((p) => p === null).length
    const prepared = dedupeByTmdbId(preparedRaw.filter((p): p is PreparedMovie => p !== null))

    const existing = await deps.fetchExistingHashes(prepared.map((p) => p.tmdbId))
    const changed = prepared.filter((p) => existing.get(p.tmdbId) !== p.row.sourceHash)

    if (changed.length > 0) {
        const vectors = await deps.embed(changed.map((p) => p.sourceText))
        const rows: MovieInsert[] = changed.map((p, i) => {
            const embedding = vectors[i]
            if (!embedding || embedding.length !== EMBEDDING_DIMENSIONS) {
                throw new Error(
                    `Missing/invalid embedding for tmdb_id ${p.tmdbId} (got ${embedding?.length})`,
                )
            }
            return { ...p.row, embedding }
        })
        await deps.upsertMovies(rows)
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
// aborting the whole run (one 404 shouldn't sink a 500-movie backfill).
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
                results[i] = await fn(items[i])
            } catch (err) {
                console.error(`⚠️ Enrichment failed for item ${i}:`, err)
                results[i] = null
            }
        }
    })
    await Promise.all(workers)
    return results
}

export type IngestMode = 'backfill' | 'incremental'

export interface RunIngestOptions {
    /** `backfill` = popularity-ordered catalog; `incremental` = now-playing. */
    mode?: IngestMode
    /** How many catalog pages to pull (20 movies/page). */
    pages?: number
    /** First page number (1-based). */
    startPage?: number
    /** Max concurrent enrichment requests. */
    concurrency?: number
}

/**
 * End-to-end run: pull catalog pages → enrich each movie (detail + keywords) →
 * ingest. Backfill seeds the full catalog; incremental pulls fresh releases.
 */
export async function runIngest(opts: RunIngestOptions = {}): Promise<IngestStats> {
    const { mode = 'backfill', pages = 1, startPage = 1, concurrency = 8 } = opts
    const fetchPage = mode === 'incremental' ? getNowPlayingPage : discoverMoviePage

    const summaries = []
    for (let i = 0; i < pages; i++) {
        const page = startPage + i
        const list = await fetchPage(page)
        summaries.push(...list)
        console.log(`📃 ${mode} page ${page}: ${list.length} movies`)
    }

    const ids = [
        ...new Set(summaries.map((s) => s.id).filter((id): id is number => typeof id === 'number')),
    ]
    console.log(`🎬 Enriching ${ids.length} movies (detail + keywords)…`)
    const details = await mapWithConcurrency(ids, getMovieForIngest, concurrency)

    const stats = await ingestMovies(details.filter((d): d is MovieForIngest => d !== null))
    console.log('✅ Ingest complete:', stats)
    return stats
}

// CLI entry: `bun run src/jobs/ingest.ts [--incremental] [--pages=N] [--start-page=N]`
if (import.meta.main) {
    const args = process.argv.slice(2)
    const mode: IngestMode = args.includes('--incremental') ? 'incremental' : 'backfill'
    const numFlag = (flag: string, fallback: number) => {
        const arg = args.find((a) => a.startsWith(flag))
        return arg ? Number(arg.split('=')[1]) : fallback
    }

    runIngest({
        mode,
        pages: numFlag('--pages=', 1),
        startPage: numFlag('--start-page=', 1),
    })
        .then(() => process.exit(0))
        .catch((err) => {
            console.error('❌ Ingest failed:', err)
            process.exit(1)
        })
}
