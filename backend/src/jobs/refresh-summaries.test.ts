import { describe, expect, it } from 'bun:test'
import {
    isDue,
    refreshSummaries,
    tierFor,
    type DueCandidate,
    type RefreshDeps,
} from './refresh-summaries'

const NOW = new Date('2026-06-27T00:00:00Z')
const daysAgo = (n: number) => new Date(NOW.getTime() - n * 86_400_000)

// ── tierFor (pure) ───────────────────────────────────────────────────────────
describe('tierFor', () => {
    it('buckets by release-date age: hot < 90d, warm < 365d, else cold (feature)', () => {
        expect(tierFor(daysAgo(20).toISOString(), NOW)).toBe('hot')
        expect(tierFor(daysAgo(180).toISOString(), NOW)).toBe('warm')
        expect(tierFor(daysAgo(800).toISOString(), NOW)).toBe('cold')
    })

    it('treats a missing or unparseable release date as cold (edge)', () => {
        expect(tierFor(null, NOW)).toBe('cold')
        expect(tierFor('not-a-date', NOW)).toBe('cold')
    })
})

// ── isDue (pure) ─────────────────────────────────────────────────────────────
const candidate = (over: Partial<DueCandidate> = {}): DueCandidate => ({
    tmdbId: 1,
    releaseDate: daysAgo(20).toISOString(), // hot by default (2-day interval)
    reviewSummaryAt: daysAgo(1),
    reviewCountAtSummary: 5,
    ...over,
})

describe('isDue', () => {
    it('a never-summarized movie is always due (feature: backfill)', () => {
        expect(isDue(candidate({ reviewSummaryAt: null }), NOW)).toBe(true)
    })

    it('respects the tier interval — hot re-checks after 2 days (feature)', () => {
        expect(isDue(candidate({ reviewSummaryAt: daysAgo(1) }), NOW)).toBe(false)
        expect(isDue(candidate({ reviewSummaryAt: daysAgo(3) }), NOW)).toBe(true)
    })

    it('cold movies wait a full month between checks (feature: cost)', () => {
        const cold = { releaseDate: daysAgo(800).toISOString() }
        expect(isDue(candidate({ ...cold, reviewSummaryAt: daysAgo(10) }), NOW)).toBe(false)
        expect(isDue(candidate({ ...cold, reviewSummaryAt: daysAgo(40) }), NOW)).toBe(true)
    })
})

// ── refreshSummaries (orchestration) ─────────────────────────────────────────
const fakeDeps = (
    candidates: DueCandidate[],
    meta: Record<number, { totalResults: number; reviews: string[] }>,
    over: Partial<RefreshDeps> = {},
) => {
    const calls = {
        regenerated: [] as { id: number; total: number }[],
        marked: [] as number[],
        fetched: [] as number[],
    }
    const deps: RefreshDeps = {
        async listCandidates() {
            return candidates
        },
        async fetchReviewMeta(id) {
            calls.fetched.push(id)
            return meta[id] ?? { totalResults: 0, reviews: [] }
        },
        async regenerate(id, _reviews, total) {
            calls.regenerated.push({ id, total })
        },
        async markChecked(id) {
            calls.marked.push(id)
        },
        ...over,
    }
    return { deps, calls }
}

describe('refreshSummaries', () => {
    it('skips a due movie whose review count is unchanged — for free (feature: delta trigger)', async () => {
        const { deps, calls } = fakeDeps(
            [candidate({ tmdbId: 1, reviewSummaryAt: daysAgo(5), reviewCountAtSummary: 12 })],
            { 1: { totalResults: 12, reviews: ['still here'] } },
        )
        const stats = await refreshSummaries(deps, NOW)
        expect(stats.skippedUnchanged).toBe(1)
        expect(stats.regenerated).toBe(0)
        expect(calls.regenerated).toHaveLength(0)
        expect(calls.marked).toEqual([1]) // clock reset, no LLM spend
    })

    it('regenerates when the review count has moved (feature)', async () => {
        const { deps, calls } = fakeDeps(
            [candidate({ tmdbId: 2, reviewSummaryAt: daysAgo(5), reviewCountAtSummary: 12 })],
            { 2: { totalResults: 30, reviews: ['a', 'b'] } },
        )
        const stats = await refreshSummaries(deps, NOW)
        expect(stats.regenerated).toBe(1)
        expect(calls.regenerated).toEqual([{ id: 2, total: 30 }]) // stores the new total
    })

    it('backfills a never-summarized movie that has reviews (feature)', async () => {
        const { deps, calls } = fakeDeps(
            [candidate({ tmdbId: 3, reviewSummaryAt: null, reviewCountAtSummary: null })],
            { 3: { totalResults: 4, reviews: ['great'] } },
        )
        const stats = await refreshSummaries(deps, NOW)
        expect(stats.regenerated).toBe(1)
        expect(calls.regenerated).toEqual([{ id: 3, total: 4 }])
    })

    it('marks a no-reviews movie checked without summarizing (edge)', async () => {
        const { deps, calls } = fakeDeps(
            [candidate({ tmdbId: 4, reviewSummaryAt: null, reviewCountAtSummary: null })],
            { 4: { totalResults: 0, reviews: [] } },
        )
        const stats = await refreshSummaries(deps, NOW)
        expect(stats.noReviews).toBe(1)
        expect(stats.regenerated).toBe(0)
        expect(calls.marked).toEqual([4])
    })

    it('processes only DUE candidates, leaving fresh ones alone (feature: tier filter)', async () => {
        const fresh = candidate({ tmdbId: 5, reviewSummaryAt: daysAgo(1), reviewCountAtSummary: 9 })
        const stale = candidate({ tmdbId: 6, reviewSummaryAt: daysAgo(9), reviewCountAtSummary: 9 })
        const { deps, calls } = fakeDeps([fresh, stale], {
            6: { totalResults: 9, reviews: ['x'] },
        })
        const stats = await refreshSummaries(deps, NOW)
        expect(stats.due).toBe(1) // only the stale one
        expect(calls.fetched).toEqual([6]) // movie 5 never touched
    })

    it('isolates a per-movie failure and keeps going (edge: resilience)', async () => {
        const { deps, calls } = fakeDeps(
            [
                candidate({ tmdbId: 7, reviewSummaryAt: null }),
                candidate({ tmdbId: 8, reviewSummaryAt: null }),
            ],
            { 7: { totalResults: 1, reviews: ['boom'] }, 8: { totalResults: 2, reviews: ['ok'] } },
            {
                async regenerate(id, _reviews, total) {
                    if (id === 7) throw new Error('llm down')
                    calls.regenerated.push({ id, total })
                },
            },
        )
        const stats = await refreshSummaries(deps, NOW, 1) // serial so order is deterministic
        expect(stats.failed).toBe(1)
        expect(stats.regenerated).toBe(1)
        expect(calls.regenerated).toEqual([{ id: 8, total: 2 }]) // movie 8 still done
    })
})
