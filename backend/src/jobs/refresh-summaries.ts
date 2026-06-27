import { eq, isNull, lt, or, sql } from 'drizzle-orm'
import { db } from '../db'
import { movies } from '../db/schema'
import { getMovieReviewMeta } from '../lib/tmdb'
import { generateAndStoreSummary, summaryDeps } from '../lib/summary'

// Tiered, delta-triggered refresh of audience-review summaries + their reception
// vectors. Run on a schedule (cron / Task Scheduler): `bun run summaries:refresh`.
//
// Two ideas keep this cheap (CLAUDE.md cost rules):
//   1. Tiered cadence — new films churn (premiere → word of mouth), old films are
//      static, so re-check frequency falls with release age.
//   2. Delta trigger — even when a movie is "due", if TMDB's review count hasn't
//      moved since the last summary, the reviews are effectively unchanged and we
//      skip re-summarizing entirely (just reset the clock). Most cold movies are
//      free no-ops forever.

export type Tier = 'hot' | 'warm' | 'cold'

const DAY_MS = 86_400_000
// Re-check cadence by release-date age.
const TIER_INTERVAL_DAYS: Record<Tier, number> = { hot: 2, warm: 7, cold: 30 }
// Hard cap on candidates pulled per run (BDB-3 / BJOB-1). Bounds memory and, more
// importantly, smooths the first-deploy cost spike: on a fresh catalog every row
// has `reviewSummaryAt = NULL` and would otherwise be fetched + re-summarized in
// a single run. Ordering oldest-first (NULLs first) means each run drains the
// most-overdue slice and the backlog clears across successive runs.
export const MAX_CANDIDATES_PER_RUN = 250
// Release-age tier boundaries (days).
const HOT_MAX_AGE_DAYS = 90
const WARM_MAX_AGE_DAYS = 365

/** Bucket a movie by how long ago it released (unknown release → cold). */
export function tierFor(releaseDate: string | null, now: Date): Tier {
    if (!releaseDate) return 'cold'
    const releasedAt = new Date(releaseDate).getTime()
    if (Number.isNaN(releasedAt)) return 'cold'
    const ageDays = (now.getTime() - releasedAt) / DAY_MS
    if (ageDays < HOT_MAX_AGE_DAYS) return 'hot'
    if (ageDays < WARM_MAX_AGE_DAYS) return 'warm'
    return 'cold'
}

export interface DueCandidate {
    tmdbId: number
    releaseDate: string | null
    reviewSummaryAt: Date | null
    reviewCountAtSummary: number | null
}

/** Due if never summarized, or the movie's tier interval has elapsed since. */
export function isDue(movie: DueCandidate, now: Date): boolean {
    if (!movie.reviewSummaryAt) return true
    const interval = TIER_INTERVAL_DAYS[tierFor(movie.releaseDate, now)]
    return now.getTime() - movie.reviewSummaryAt.getTime() >= interval * DAY_MS
}

export interface RefreshStats {
    due: number
    regenerated: number
    skippedUnchanged: number
    noReviews: number
    failed: number
}

/** IO seams, injected so the job is unit-testable without DB / TMDB / OpenAI. */
export interface RefreshDeps {
    listCandidates: (now: Date) => Promise<DueCandidate[]>
    fetchReviewMeta: (movieId: number) => Promise<{ totalResults: number; reviews: string[] }>
    regenerate: (movieId: number, reviews: string[], totalResults: number) => Promise<void>
    markChecked: (movieId: number) => Promise<void>
}

export function refreshDeps(): RefreshDeps {
    return {
        async listCandidates(now) {
            // Prefilter in SQL to rows that COULD be due — never summarized, or
            // older than the SMALLEST (hot) interval; isDue() then refines per
            // tier in JS. This bounds the working set without duplicating the
            // tier maths in SQL.
            const cutoff = new Date(now.getTime() - TIER_INTERVAL_DAYS.hot * DAY_MS)
            return (
                db
                    .select({
                        tmdbId: movies.tmdbId,
                        releaseDate: movies.releaseDate,
                        reviewSummaryAt: movies.reviewSummaryAt,
                        reviewCountAtSummary: movies.reviewCountAtSummary,
                    })
                    .from(movies)
                    .where(or(isNull(movies.reviewSummaryAt), lt(movies.reviewSummaryAt, cutoff)))
                    // Oldest-first (never-summarized rows first); the
                    // `review_summary_at` btree index (BDB-3) serves this ordering.
                    .orderBy(sql`${movies.reviewSummaryAt} asc nulls first`)
                    .limit(MAX_CANDIDATES_PER_RUN)
            )
        },
        fetchReviewMeta: getMovieReviewMeta,
        async regenerate(movieId, reviews, totalResults) {
            // Reuses the on-demand path's summarize + embed + persist + cache, so
            // the job and the live read produce identical durable state.
            await generateAndStoreSummary(movieId, reviews, totalResults, summaryDeps())
        },
        async markChecked(movieId) {
            // Reset the tier clock without regenerating (content didn't change, so
            // the Redis hot entry stays valid).
            await db
                .update(movies)
                .set({ reviewSummaryAt: new Date() })
                .where(eq(movies.tmdbId, movieId))
        },
    }
}

/** Bounded-concurrency worker pool over `items`. */
async function runConcurrently<T>(
    items: T[],
    limit: number,
    fn: (item: T) => Promise<void>,
): Promise<void> {
    let cursor = 0
    const workers = Array.from({ length: Math.max(1, Math.min(limit, items.length)) }, async () => {
        while (true) {
            const i = cursor++
            if (i >= items.length) break
            await fn(items[i]!)
        }
    })
    await Promise.all(workers)
}

/**
 * Refresh due summaries. For each due movie: if TMDB's review count is unchanged
 * since the last summary, skip (just reset the clock); else regenerate + re-embed
 * + persist. Per-movie failures are isolated and counted, not fatal.
 */
export async function refreshSummaries(
    deps: RefreshDeps = refreshDeps(),
    now: Date = new Date(),
    concurrency = 4,
): Promise<RefreshStats> {
    const candidates = await deps.listCandidates(now)
    const due = candidates.filter((m) => isDue(m, now))
    const stats: RefreshStats = {
        due: due.length,
        regenerated: 0,
        skippedUnchanged: 0,
        noReviews: 0,
        failed: 0,
    }

    await runConcurrently(due, concurrency, async (movie) => {
        try {
            const { totalResults, reviews } = await deps.fetchReviewMeta(movie.tmdbId)

            // Delta trigger: a movie with an existing summary whose review count
            // hasn't moved is skipped for free.
            if (movie.reviewCountAtSummary != null && totalResults === movie.reviewCountAtSummary) {
                await deps.markChecked(movie.tmdbId)
                stats.skippedUnchanged++
                return
            }
            if (reviews.length === 0) {
                await deps.markChecked(movie.tmdbId) // nothing to summarize; reset clock
                stats.noReviews++
                return
            }
            await deps.regenerate(movie.tmdbId, reviews, totalResults)
            stats.regenerated++
        } catch (err) {
            console.error(`⚠️ Summary refresh failed for movie ${movie.tmdbId}:`, err)
            stats.failed++
        }
    })

    return stats
}

// CLI entry: `bun run src/jobs/refresh-summaries.ts`
if (import.meta.main) {
    refreshSummaries()
        .then((stats) => {
            console.log('✅ Summary refresh complete:', stats)
            process.exit(0)
        })
        .catch((err) => {
            console.error('❌ Summary refresh failed:', err)
            process.exit(1)
        })
}
