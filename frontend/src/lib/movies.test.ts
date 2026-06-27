import { describe, expect, it } from 'vitest'
import { parseMovie, parseMovies, releaseYear, safeParseMovie, SAMPLE_FEATURED } from './movies'

const VALID = {
    tmdbId: 27205,
    title: 'Inception',
    overview: 'A thief who steals corporate secrets…',
    releaseDate: '2010-07-16',
    genres: ['Action', 'Science Fiction'],
    posterPath: '/poster.jpg',
}

describe('movie schema consumption (shared @themovie/schemas)', () => {
    // ── Feature / happy path ──────────────────────────────────────────────
    it('parses a valid movie payload into a typed object', () => {
        const movie = parseMovie(VALID)
        expect(movie.title).toBe('Inception')
        expect(movie.genres).toEqual(['Action', 'Science Fiction'])
    })

    it('parses a list of valid movies', () => {
        const movies = parseMovies([VALID, VALID])
        expect(movies).toHaveLength(2)
    })

    it('ships sample featured data that already satisfies the schema', () => {
        expect(SAMPLE_FEATURED.length).toBeGreaterThan(0)
        // Re-parsing must not throw — proves the sample is schema-valid.
        expect(() => parseMovies(SAMPLE_FEATURED)).not.toThrow()
    })

    it('formats the release year for display', () => {
        expect(releaseYear(VALID)).toBe('2010')
    })

    // ── Edge cases ────────────────────────────────────────────────────────
    it('throws on a structurally invalid payload', () => {
        expect(() => parseMovie({ title: 'No id, wrong shape' })).toThrow()
    })

    it('safeParseMovie degrades gracefully instead of throwing', () => {
        const result = safeParseMovie({ tmdbId: 'not-a-number', title: 5 })
        expect(result.ok).toBe(false)
        if (!result.ok) {
            expect(result.error).toMatch(/tmdbId/)
        }
    })

    it('safeParseMovie returns the parsed movie on valid input', () => {
        const result = safeParseMovie(VALID)
        expect(result.ok).toBe(true)
        if (result.ok) expect(result.movie.tmdbId).toBe(27205)
    })

    it('renders an em dash when the release date is missing', () => {
        const movie = parseMovie({ ...VALID, releaseDate: null })
        expect(releaseYear(movie)).toBe('—')
    })

    it('rejects a null where the schema requires an array', () => {
        const result = safeParseMovie({ ...VALID, genres: null })
        expect(result.ok).toBe(false)
    })
})
