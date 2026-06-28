import { describe, expect, it } from 'bun:test'
import type { MediaType } from '@themovie/schemas'
import { recommendForUser, type RankCandidate, type RecommendationDeps } from './recommendations'

type Seed = { tmdbId: number; title: string; mediaType: MediaType }
type Neighbour = {
    tmdbId: number
    title: string
    overview: string | null
    similarity: number
    mediaType: MediaType
}

// Fake deps: a watchlist, canned neighbours per (mediaType, seed id), and a
// ranker that echoes the candidates so we can assert what reached it.
const fakeDeps = (watchlist: Seed[], neighboursBySeed: Record<string, Neighbour[]>) => {
    const calls = {
        seedArgs: [] as { tmdbId: number; mediaType: MediaType; exclude: number[] }[],
        rankInput: null as RankCandidate[] | null,
        rankCount: 0,
    }
    const key = (mediaType: MediaType, tmdbId: number) => `${mediaType}:${tmdbId}`
    const deps: RecommendationDeps = {
        async getWatchlist() {
            return watchlist
        },
        async similarToSeed(tmdbId, mediaType, _limit, excludeTmdbIds) {
            calls.seedArgs.push({ tmdbId, mediaType, exclude: excludeTmdbIds })
            return neighboursBySeed[key(mediaType, tmdbId)] ?? []
        },
        async rank(_watched, candidates) {
            calls.rankCount++
            calls.rankInput = candidates
            return candidates.map((c) => ({
                tmdbId: c.tmdbId,
                title: c.title,
                mediaType: c.mediaType,
                reason: `because you watched ${c.sourceTitle}`,
            }))
        },
    }
    return { deps, calls }
}

const movieSeed = (tmdbId: number, title: string): Seed => ({ tmdbId, title, mediaType: 'movie' })
const tvSeed = (tmdbId: number, title: string): Seed => ({ tmdbId, title, mediaType: 'tv' })
const neighbour = (
    tmdbId: number,
    title: string,
    similarity: number,
    mediaType: MediaType = 'movie',
): Neighbour => ({ tmdbId, title, overview: null, similarity, mediaType })

describe('recommendForUser', () => {
    it('returns nothing (and never ranks) for an empty watchlist (edge: cost)', async () => {
        const { deps, calls } = fakeDeps([], {})
        const out = await recommendForUser('u1', deps)
        expect(out.recommendations).toEqual([])
        expect(out.basis.watchedCount).toBe(0)
        expect(calls.rankCount).toBe(0)
    })

    it('excludes already-watched movies from the kNN search (feature)', async () => {
        const { deps, calls } = fakeDeps([movieSeed(1, 'A'), movieSeed(2, 'B')], {
            'movie:1': [],
            'movie:2': [],
        })
        await recommendForUser('u1', deps)
        // Each movie seed search is told to exclude the full watched MOVIE set.
        for (const seed of calls.seedArgs) {
            expect(seed.exclude).toEqual([1, 2])
        }
    })

    it('merges candidates across seeds, keeping the highest-similarity source (feature)', async () => {
        const { deps, calls } = fakeDeps([movieSeed(1, 'Alien'), movieSeed(2, 'Heat')], {
            'movie:1': [neighbour(10, 'Aliens', 0.8)],
            'movie:2': [neighbour(10, 'Aliens', 0.95), neighbour(11, 'Collateral', 0.7)],
        })
        const out = await recommendForUser('u1', deps)

        const ranked = calls.rankInput!
        // movie 10 appears from both seeds; the higher-sim source (Heat, 0.95) wins.
        const ten = ranked.find((c) => c.tmdbId === 10)!
        expect(ten.sourceTitle).toBe('Heat')
        expect(ten.similarity).toBe(0.95)
        // Sorted best-first.
        expect(ranked.map((c) => c.tmdbId)).toEqual([10, 11])
        // Reasons reference the source title.
        expect(out.recommendations.find((r) => r.tmdbId === 10)!.reason).toContain('Heat')
        expect(out.basis.candidateCount).toBe(2)
    })

    it('returns nothing (and never ranks) when no candidates are found (edge: cold catalog)', async () => {
        const { deps, calls } = fakeDeps([movieSeed(1, 'A')], { 'movie:1': [] })
        const out = await recommendForUser('u1', deps)
        expect(out.recommendations).toEqual([])
        expect(out.basis.watchedCount).toBe(1)
        expect(calls.rankCount).toBe(0) // no wasted model call
    })

    // ── TV parity (Phase 10.4) ───────────────────────────────────────────────

    it('seeds from TV entries and recommends shows within the TV catalog (feature: TV recs)', async () => {
        const { deps, calls } = fakeDeps([tvSeed(100, 'Breaking Bad')], {
            'tv:100': [neighbour(200, 'Ozark', 0.9, 'tv')],
        })
        const out = await recommendForUser('u1', deps)

        // The TV seed searched the TV catalog…
        expect(calls.seedArgs).toEqual([{ tmdbId: 100, mediaType: 'tv', exclude: [100] }])
        // …and its recommendation carries mediaType 'tv' so it routes to /tv/:id.
        expect(out.recommendations).toEqual([
            {
                tmdbId: 200,
                title: 'Ozark',
                mediaType: 'tv',
                reason: 'because you watched Breaking Bad',
            },
        ])
    })

    it('keeps movie and TV exclusions separate even when ids collide (edge: id namespacing)', async () => {
        const { deps, calls } = fakeDeps([movieSeed(5, 'Film'), tvSeed(5, 'Show')], {
            'movie:5': [],
            'tv:5': [],
        })
        await recommendForUser('u1', deps)
        const movie = calls.seedArgs.find((s) => s.mediaType === 'movie')!
        const tv = calls.seedArgs.find((s) => s.mediaType === 'tv')!
        // A movie seed only excludes watched movies; a TV seed only watched shows.
        expect(movie.exclude).toEqual([5])
        expect(tv.exclude).toEqual([5])
    })

    it('does not dedupe a movie and a show that share a tmdb id (edge: cross-media key)', async () => {
        const { deps, calls } = fakeDeps([movieSeed(1, 'Film'), tvSeed(2, 'Show')], {
            'movie:1': [neighbour(42, 'A Movie', 0.8, 'movie')],
            'tv:2': [neighbour(42, 'A Show', 0.7, 'tv')],
        })
        const out = await recommendForUser('u1', deps)
        // Same id, different media → two distinct candidates survive.
        expect(calls.rankInput!).toHaveLength(2)
        expect(out.basis.candidateCount).toBe(2)
        const media = out.recommendations.map((r) => r.mediaType).sort()
        expect(media).toEqual(['movie', 'tv'])
    })
})
