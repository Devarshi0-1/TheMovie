import { describe, expect, it } from 'bun:test'
import { MovieDetailViewSchema, MovieResultSchema } from '@themovie/schemas'
import { genreNames, toMovieDetailView, toMovieResult, toMovieResults } from './movieView'

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

describe('movieView mapping (DL-10: TMDB → shared display schemas)', () => {
    // ── Feature / happy path ──────────────────────────────────────────────
    it('maps a raw TMDB list item onto the shared MovieResult shape (feature)', () => {
        const movie = toMovieResult(RAW_LIST_ITEM)
        expect(movie).toEqual({
            tmdbId: 550,
            title: 'Fight Club',
            overview: 'An insomniac…',
            releaseDate: '1999-10-15',
            genres: ['Drama', 'Thriller'],
            posterPath: '/poster.jpg',
        })
        // The output satisfies the contract the frontend will validate against.
        expect(MovieResultSchema.safeParse(movie).success).toBe(true)
    })

    it('resolves numeric genre_ids to names (feature)', () => {
        expect(genreNames([28, 878])).toEqual(['Action', 'Science Fiction'])
    })

    it('maps a full list payload, dropping id-less items (feature)', () => {
        const movies = toMovieResults([RAW_LIST_ITEM, { ...RAW_LIST_ITEM, id: 551 }, { title: 'x' }])
        expect(movies).toHaveLength(2)
        expect(movies[1]!.tmdbId).toBe(551)
    })

    it('maps full details incl. backdrop, runtime, tagline, named genres (feature)', () => {
        const details = toMovieDetailView(RAW_DETAILS, 550)
        expect(details.backdropPath).toBe('/backdrop.jpg')
        expect(details.runtime).toBe(139)
        expect(details.tagline).toBe('Mischief. Mayhem. Soap.')
        expect(details.genres).toEqual(['Drama'])
        expect(details.voteAverage).toBe(8.4)
        expect(MovieDetailViewSchema.safeParse(details).success).toBe(true)
    })

    // ── Edge cases ────────────────────────────────────────────────────────
    it('drops unknown genre ids rather than emitting undefined (edge)', () => {
        expect(genreNames([28, 999999])).toEqual(['Action'])
        expect(genreNames(null)).toEqual([])
        expect(genreNames(undefined)).toEqual([])
    })

    it('coerces missing title/poster/date/genres to safe display defaults (edge)', () => {
        expect(toMovieResult({ id: 7 })).toEqual({
            tmdbId: 7,
            title: 'Untitled',
            overview: null,
            releaseDate: null,
            genres: [],
            posterPath: null,
        })
    })

    it('returns null for a list item without a numeric id (edge: malformed)', () => {
        expect(toMovieResult({ title: 'no id' })).toBeNull()
    })

    it('handles null genres on a details payload (edge)', () => {
        const details = toMovieDetailView({ ...RAW_DETAILS, genres: null, runtime: null }, 550)
        expect(details.genres).toEqual([])
        expect(details.runtime).toBeNull()
    })

    it('falls back to the route id when the details body omits its own id (edge)', () => {
        const details = toMovieDetailView({ title: 'Mystery', backdrop_path: null }, 999)
        expect(details.tmdbId).toBe(999)
        expect(MovieDetailViewSchema.safeParse(details).success).toBe(true)
    })
})
