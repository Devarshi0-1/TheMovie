import { describe, expect, it } from 'bun:test'
import {
    findMoviesByPerson,
    findSimilarMovies,
    getWatchProviders,
    type ExtrasLookupDeps,
    type PersonLookupDeps,
} from './lookups'
import type { MovieExtrasResponse, PersonMovieCredits, PersonSearchResult } from '../lib/tmdb'

// ── find_movies_by_person ────────────────────────────────────────────────────

const personDeps = (over: Partial<PersonLookupDeps> = {}): PersonLookupDeps => ({
    searchPerson: async () => [{ id: 525, name: 'Christopher Nolan' }] as PersonSearchResult[],
    personMovieCredits: async () =>
        ({
            cast: [],
            crew: [
                {
                    id: 27205,
                    title: 'Inception',
                    job: 'Director',
                    genre_ids: [878, 28],
                    popularity: 50,
                },
                {
                    id: 155,
                    title: 'The Dark Knight',
                    job: 'Director',
                    genre_ids: [28, 80],
                    popularity: 90,
                },
            ],
        }) as unknown as PersonMovieCredits,
    ...over,
})

describe('findMoviesByPerson ("movies starring / directed by X")', () => {
    // ── Feature / happy path ──────────────────────────────────────────────
    it('resolves the top person and returns their movies ranked by popularity (feature)', async () => {
        const out = await findMoviesByPerson({ name: 'Christopher Nolan', limit: 10 }, personDeps())
        expect(out.map((m) => m.title)).toEqual(['The Dark Knight', 'Inception'])
        // genre_ids are resolved to names via the shared mapper.
        expect(out[0]!.genres).toEqual(['Action', 'Crime'])
    })

    it('merges acting + directing credits and dedupes by tmdbId (feature)', async () => {
        const out = await findMoviesByPerson(
            { name: 'x', limit: 10 },
            personDeps({
                personMovieCredits: async () =>
                    ({
                        cast: [{ id: 27205, title: 'Inception', genre_ids: [], popularity: 10 }],
                        crew: [{ id: 27205, title: 'Inception', job: 'Director', popularity: 50 }],
                    }) as unknown as PersonMovieCredits,
            }),
        )
        expect(out).toHaveLength(1)
        expect(out[0]!.tmdbId).toBe(27205)
    })

    it('honors the limit (feature)', async () => {
        const out = await findMoviesByPerson({ name: 'x', limit: 1 }, personDeps())
        expect(out).toHaveLength(1)
        expect(out[0]!.title).toBe('The Dark Knight')
    })

    // ── Edge cases ────────────────────────────────────────────────────────
    it('returns [] when no person matches (edge)', async () => {
        const out = await findMoviesByPerson(
            { name: 'nobody', limit: 10 },
            personDeps({ searchPerson: async () => [] }),
        )
        expect(out).toEqual([])
    })

    it('skips a person with no usable id and credits with no id (edge)', async () => {
        const out = await findMoviesByPerson(
            { name: 'x', limit: 10 },
            personDeps({
                searchPerson: async () =>
                    [{ name: 'No Id' }, { id: 1, name: 'Has Id' }] as PersonSearchResult[],
                personMovieCredits: async () =>
                    ({
                        cast: [{ title: 'no id', popularity: 5 }],
                        crew: [{ id: 99, title: 'Kept', popularity: 1 }],
                    }) as unknown as PersonMovieCredits,
            }),
        )
        expect(out).toHaveLength(1)
        expect(out[0]!.title).toBe('Kept')
    })
})

// ── get_watch_providers / find_similar_movies ────────────────────────────────

const EXTRAS_RAW = {
    id: 27205,
    title: 'Inception',
    recommendations: {
        results: [
            { id: 155, title: 'The Dark Knight', genre_ids: [28] },
            { id: 49026, title: 'TDKR', genre_ids: [28] },
        ],
    },
    'watch/providers': {
        results: {
            US: {
                link: 'https://x',
                flatrate: [{ provider_id: 8, provider_name: 'Netflix', logo_path: '/n.jpg' }],
            },
            GB: { rent: [{ provider_id: 9, provider_name: 'Prime', logo_path: '/p.jpg' }] },
        },
    },
} as unknown as MovieExtrasResponse

const extrasDeps = (raw: MovieExtrasResponse = EXTRAS_RAW): ExtrasLookupDeps => ({
    movieExtras: async () => raw,
})

describe('getWatchProviders ("where can I watch X")', () => {
    it('returns the requested region’s providers (feature)', async () => {
        const us = await getWatchProviders({ tmdbId: 27205, region: 'US' }, extrasDeps())
        expect(us?.region).toBe('US')
        expect(us?.flatrate[0]?.name).toBe('Netflix')
    })

    it('defaults to US and uppercases the region (feature/edge)', async () => {
        const def = await getWatchProviders({ tmdbId: 27205 }, extrasDeps())
        expect(def?.region).toBe('US')
        const gb = await getWatchProviders({ tmdbId: 27205, region: 'gb' }, extrasDeps())
        expect(gb?.rent[0]?.name).toBe('Prime')
    })

    it('returns null for a region with no offers (edge)', async () => {
        const fr = await getWatchProviders({ tmdbId: 27205, region: 'FR' }, extrasDeps())
        expect(fr).toBeNull()
    })
})

describe('findSimilarMovies ("more like this")', () => {
    it('returns TMDB recommendations as MovieResults (feature)', async () => {
        const out = await findSimilarMovies({ tmdbId: 27205, limit: 10 }, extrasDeps())
        expect(out.map((m) => m.title)).toEqual(['The Dark Knight', 'TDKR'])
    })

    it('honors the limit (edge)', async () => {
        const out = await findSimilarMovies({ tmdbId: 27205, limit: 1 }, extrasDeps())
        expect(out).toHaveLength(1)
    })
})
