import { describe, expect, it } from 'bun:test'
import { recommendForUser, type RankCandidate, type RecommendationDeps } from './recommendations'

// Fake deps: a watchlist, canned neighbours per seed, and a ranker that echoes
// the candidates so we can assert what reached it.
const fakeDeps = (
    watchlist: { tmdbId: number; title: string }[],
    neighboursBySeed: Record<
        number,
        { tmdbId: number; title: string; overview: string | null; similarity: number }[]
    >,
) => {
    const calls = {
        excludeArgs: [] as number[][],
        rankInput: null as RankCandidate[] | null,
        rankCount: 0,
    }
    const deps: RecommendationDeps = {
        async getWatchlist() {
            return watchlist
        },
        async similarToMovie(tmdbId, _limit, excludeTmdbIds) {
            calls.excludeArgs.push(excludeTmdbIds)
            return neighboursBySeed[tmdbId] ?? []
        },
        async rank(_watched, candidates) {
            calls.rankCount++
            calls.rankInput = candidates
            return candidates.map((c) => ({
                tmdbId: c.tmdbId,
                title: c.title,
                reason: `because you watched ${c.sourceTitle}`,
            }))
        },
    }
    return { deps, calls }
}

describe('recommendForUser', () => {
    it('returns nothing (and never ranks) for an empty watchlist (edge: cost)', async () => {
        const { deps, calls } = fakeDeps([], {})
        const out = await recommendForUser('u1', deps)
        expect(out.recommendations).toEqual([])
        expect(out.basis.watchedCount).toBe(0)
        expect(calls.rankCount).toBe(0)
    })

    it('excludes already-watched movies from the kNN search (feature)', async () => {
        const { deps, calls } = fakeDeps(
            [
                { tmdbId: 1, title: 'A' },
                { tmdbId: 2, title: 'B' },
            ],
            { 1: [], 2: [] },
        )
        await recommendForUser('u1', deps)
        // Each seed search is told to exclude the full watched set.
        for (const exclude of calls.excludeArgs) {
            expect(exclude).toEqual([1, 2])
        }
    })

    it('merges candidates across seeds, keeping the highest-similarity source (feature)', async () => {
        const { deps, calls } = fakeDeps(
            [
                { tmdbId: 1, title: 'Alien' },
                { tmdbId: 2, title: 'Heat' },
            ],
            {
                1: [{ tmdbId: 10, title: 'Aliens', overview: null, similarity: 0.8 }],
                2: [
                    { tmdbId: 10, title: 'Aliens', overview: null, similarity: 0.95 },
                    { tmdbId: 11, title: 'Collateral', overview: null, similarity: 0.7 },
                ],
            },
        )
        const out = await recommendForUser('u1', deps)

        const ranked = calls.rankInput!
        // movie 10 appears from both seeds; the higher-sim source (Heat, 0.95) wins.
        const ten = ranked.find((c) => c.tmdbId === 10)!
        expect(ten.sourceTitle).toBe('Heat')
        expect(ten.similarity).toBe(0.95)
        // Sorted best-first.
        expect(ranked.map((c) => c.tmdbId)).toEqual([10, 11])
        // Reasons reference the source movie.
        expect(out.recommendations.find((r) => r.tmdbId === 10)!.reason).toContain('Heat')
        expect(out.basis.candidateCount).toBe(2)
    })

    it('returns nothing (and never ranks) when no candidates are found (edge: cold catalog)', async () => {
        const { deps, calls } = fakeDeps([{ tmdbId: 1, title: 'A' }], { 1: [] })
        const out = await recommendForUser('u1', deps)
        expect(out.recommendations).toEqual([])
        expect(out.basis.watchedCount).toBe(1)
        expect(calls.rankCount).toBe(0) // no wasted model call
    })
})
