import { describe, expect, it } from 'vitest'
import {
    formatRuntime,
    genreNames,
    parseMovieDetails,
    parseMovieList,
    toMovieDetails,
    toMovieResult,
} from './tmdb'

const RAW_LIST_ITEM = {
    id: 550,
    title: 'Fight Club',
    overview: 'An insomniac…',
    release_date: '1999-10-15',
    poster_path: '/poster.jpg',
    genre_ids: [18, 53],
    vote_average: 8.4,
}

const RAW_DETAILS = {
    id: 550,
    title: 'Fight Club',
    overview: 'An insomniac…',
    release_date: '1999-10-15',
    poster_path: '/poster.jpg',
    backdrop_path: '/backdrop.jpg',
    genres: [{ id: 18, name: 'Drama' }],
    runtime: 139,
    tagline: 'Mischief. Mayhem. Soap.',
    vote_average: 8.4,
}

describe('tmdb mapping', () => {
    // ── Feature / happy path ──────────────────────────────────────────────
    it('maps a raw TMDB list item onto the shared MovieResult shape', () => {
        const movie = toMovieResult(RAW_LIST_ITEM)
        expect(movie).toEqual({
            tmdbId: 550,
            title: 'Fight Club',
            overview: 'An insomniac…',
            releaseDate: '1999-10-15',
            genres: ['Drama', 'Thriller'],
            posterPath: '/poster.jpg',
        })
    })

    it('resolves numeric genre_ids to names', () => {
        expect(genreNames([28, 878])).toEqual(['Action', 'Science Fiction'])
    })

    it('parses + maps a full list payload', () => {
        const movies = parseMovieList([RAW_LIST_ITEM, { ...RAW_LIST_ITEM, id: 551 }])
        expect(movies).toHaveLength(2)
        expect(movies[1]!.tmdbId).toBe(551)
    })

    it('maps full details including backdrop, runtime, tagline, and named genres', () => {
        const details = toMovieDetails(RAW_DETAILS)
        expect(details.backdropPath).toBe('/backdrop.jpg')
        expect(details.runtime).toBe(139)
        expect(details.tagline).toBe('Mischief. Mayhem. Soap.')
        expect(details.genres).toEqual(['Drama'])
        expect(details.voteAverage).toBe(8.4)
    })

    it('formats runtime into a human label', () => {
        expect(formatRuntime(139)).toBe('2h 19m')
        expect(formatRuntime(45)).toBe('45m')
    })

    // ── Edge cases ────────────────────────────────────────────────────────
    it('drops unknown genre ids rather than emitting undefined', () => {
        expect(genreNames([28, 999999])).toEqual(['Action'])
        expect(genreNames(null)).toEqual([])
        expect(genreNames(undefined)).toEqual([])
    })

    it('coerces missing title/poster/date/genres to safe display defaults', () => {
        const movie = toMovieResult({ id: 7 })
        expect(movie).toEqual({
            tmdbId: 7,
            title: 'Untitled',
            overview: null,
            releaseDate: null,
            genres: [],
            posterPath: null,
        })
    })

    it('handles null genres on a details payload', () => {
        const details = parseMovieDetails({ ...RAW_DETAILS, genres: null, runtime: null })
        expect(details.genres).toEqual([])
        expect(details.runtime).toBeNull()
    })

    it('returns null runtime label for missing or non-positive runtimes', () => {
        expect(formatRuntime(null)).toBeNull()
        expect(formatRuntime(0)).toBeNull()
    })

    it('throws when the payload is not the expected TMDB shape', () => {
        expect(() => parseMovieList([{ title: 'no id' }])).toThrow()
        expect(() => parseMovieDetails({ title: 'no id' })).toThrow()
    })
})
