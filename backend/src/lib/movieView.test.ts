import { describe, expect, it } from 'bun:test'
import { MovieDetailViewSchema, MovieExtrasSchema, MovieResultSchema } from '@themovie/schemas'
import {
    genreNames,
    pickTrailer,
    toMovieDetailView,
    toMovieExtrasView,
    toMovieResult,
    toMovieResults,
    toTvDetailView,
    toTvExtrasView,
    toTvResult,
    toTvResults,
    toWatchProviders,
    tvGenreNames,
} from './movieView'

const RAW_LIST_ITEM = {
    id: 550,
    title: 'Fight Club',
    overview: 'An insomniac…',
    release_date: '1999-10-15',
    poster_path: '/poster.jpg',
    backdrop_path: '/backdrop.jpg',
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
            backdropPath: '/backdrop.jpg',
            voteAverage: 8.4,
            mediaType: 'movie',
        })
        // The output satisfies the contract the frontend will validate against.
        expect(MovieResultSchema.safeParse(movie).success).toBe(true)
    })

    it('resolves numeric genre_ids to names (feature)', () => {
        expect(genreNames([28, 878])).toEqual(['Action', 'Science Fiction'])
    })

    it('maps a full list payload, dropping id-less items (feature)', () => {
        const movies = toMovieResults([
            RAW_LIST_ITEM,
            { ...RAW_LIST_ITEM, id: 551 },
            { title: 'x' },
        ])
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
            backdropPath: null,
            voteAverage: null,
            mediaType: 'movie',
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

const RAW_EXTRAS = {
    id: 27205,
    title: 'Inception',
    credits: {
        cast: [
            { id: 6193, name: 'Leonardo DiCaprio', character: 'Cobb', profile_path: '/leo.jpg' },
            { id: 24045, name: 'Joseph Gordon-Levitt', character: 'Arthur', profile_path: null },
        ],
        crew: [
            { name: 'Christopher Nolan', job: 'Director' },
            { name: 'Hans Zimmer', job: 'Original Music Composer' },
        ],
    },
    videos: {
        results: [
            { key: 'teaser1', name: 'Teaser', site: 'YouTube', type: 'Teaser', official: true },
            {
                key: 'trailer1',
                name: 'Official Trailer',
                site: 'YouTube',
                type: 'Trailer',
                official: true,
            },
            { key: 'fan1', name: 'Fan Trailer', site: 'YouTube', type: 'Trailer', official: false },
        ],
    },
    recommendations: {
        results: [
            { id: 155, title: 'The Dark Knight', genre_ids: [28, 80, 18] },
            { title: 'no id' },
        ],
    },
    'watch/providers': {
        results: {
            US: {
                link: 'https://www.themoviedb.org/movie/27205/watch',
                flatrate: [{ provider_id: 8, provider_name: 'Netflix', logo_path: '/nf.jpg' }],
                rent: [{ provider_id: 2, provider_name: 'Apple TV', logo_path: '/atv.jpg' }],
            },
            GB: {
                flatrate: [
                    { provider_id: 9, provider_name: 'Amazon Prime', logo_path: '/amz.jpg' },
                ],
            },
        },
    },
}

describe('toMovieExtrasView (cast/trailer/where-to-watch/recommendations)', () => {
    // ── Feature / happy path ──────────────────────────────────────────────
    it('maps cast, director, best trailer, US providers, and recs (feature)', () => {
        const extras = toMovieExtrasView(RAW_EXTRAS)
        expect(extras.cast).toHaveLength(2)
        expect(extras.cast[0]).toEqual({
            id: 6193,
            name: 'Leonardo DiCaprio',
            character: 'Cobb',
            profilePath: '/leo.jpg',
        })
        expect(extras.director).toBe('Christopher Nolan')
        // Official Trailer beats the (also official) Teaser and the fan trailer.
        expect(extras.trailer?.key).toBe('trailer1')
        expect(extras.watchProviders?.region).toBe('US')
        expect(extras.watchProviders?.flatrate[0]?.name).toBe('Netflix')
        expect(extras.watchProviders?.buy).toEqual([])
        // Recommendation without an id is dropped.
        expect(extras.recommendations).toHaveLength(1)
        expect(extras.recommendations[0]?.title).toBe('The Dark Knight')
        expect(MovieExtrasSchema.safeParse(extras).success).toBe(true)
    })

    it('selects the requested region for where-to-watch (feature)', () => {
        const extras = toMovieExtrasView(RAW_EXTRAS, 'GB')
        expect(extras.watchProviders?.region).toBe('GB')
        expect(extras.watchProviders?.flatrate[0]?.name).toBe('Amazon Prime')
        expect(extras.watchProviders?.link).toBeNull()
    })

    // ── Edge cases ────────────────────────────────────────────────────────
    it('returns empty/null fields for a bare payload (edge: missing append blocks)', () => {
        const extras = toMovieExtrasView({})
        expect(extras.cast).toEqual([])
        expect(extras.director).toBeNull()
        expect(extras.trailer).toBeNull()
        expect(extras.watchProviders).toBeNull()
        expect(extras.recommendations).toEqual([])
        expect(MovieExtrasSchema.safeParse(extras).success).toBe(true)
    })

    it('returns null providers for a region with no offers (edge)', () => {
        expect(toWatchProviders({ US: { flatrate: [], rent: [], buy: [] } })).toBeNull()
        expect(toWatchProviders({ US: { flatrate: [] } }, 'FR')).toBeNull()
        expect(toWatchProviders(undefined)).toBeNull()
    })

    it('returns null when there is no YouTube video to embed (edge)', () => {
        expect(pickTrailer(undefined)).toBeNull()
        expect(pickTrailer([{ key: 'x', site: 'Vimeo', type: 'Trailer' }])).toBeNull()
        // A YouTube clip that isn't a trailer/teaser is still embeddable.
        expect(pickTrailer([{ key: 'clip', site: 'YouTube', type: 'Clip' }])?.key).toBe('clip')
    })
})

const RAW_TV_LIST_ITEM = {
    id: 1399,
    name: 'Game of Thrones',
    overview: 'Seven noble families fight…',
    first_air_date: '2011-04-17',
    poster_path: '/got.jpg',
    backdrop_path: '/got-bd.jpg',
    genre_ids: [10765, 18],
    vote_average: 8.4,
}

describe('TV mapping (TMDB /tv → shared display schemas, mediaType: tv)', () => {
    // ── Feature / happy path ──────────────────────────────────────────────
    it('maps a raw TV list item onto MovieResult with tv fields (feature)', () => {
        const show = toTvResult(RAW_TV_LIST_ITEM)
        expect(show).toEqual({
            tmdbId: 1399,
            title: 'Game of Thrones',
            overview: 'Seven noble families fight…',
            releaseDate: '2011-04-17',
            genres: ['Sci-Fi & Fantasy', 'Drama'],
            posterPath: '/got.jpg',
            backdropPath: '/got-bd.jpg',
            voteAverage: 8.4,
            mediaType: 'tv',
        })
        expect(MovieResultSchema.safeParse(show).success).toBe(true)
    })

    it('resolves TV genre ids against the TV genre set (feature)', () => {
        expect(tvGenreNames([10759, 10765])).toEqual(['Action & Adventure', 'Sci-Fi & Fantasy'])
        // A movie-only id (28 = Action) is unknown to the TV set.
        expect(tvGenreNames([28])).toEqual([])
    })

    it('maps TV details, taking the first episode runtime (feature)', () => {
        const details = toTvDetailView(
            {
                id: 1399,
                name: 'Game of Thrones',
                first_air_date: '2011-04-17',
                genres: [{ id: 18, name: 'Drama' }],
                episode_run_time: [60, 55],
                tagline: 'Winter is coming.',
                vote_average: 8.4,
                backdrop_path: '/got-bd.jpg',
            },
            1399,
        )
        expect(details.title).toBe('Game of Thrones')
        expect(details.runtime).toBe(60)
        expect(details.mediaType).toBe('tv')
        expect(MovieDetailViewSchema.safeParse(details).success).toBe(true)
    })

    it('maps TV extras with recommendations as tv shows (feature)', () => {
        const extras = toTvExtrasView({
            credits: {
                cast: [{ id: 1, name: 'Emilia Clarke', character: 'Daenerys', profile_path: null }],
                crew: [{ name: 'David Benioff', job: 'Series Director' }],
            },
            videos: { results: [{ key: 'k', site: 'YouTube', type: 'Trailer' }] },
            recommendations: { results: [{ id: 1396, name: 'Breaking Bad', genre_ids: [18] }] },
        })
        expect(extras.cast[0]?.name).toBe('Emilia Clarke')
        expect(extras.director).toBe('David Benioff')
        expect(extras.recommendations[0]).toMatchObject({
            tmdbId: 1396,
            title: 'Breaking Bad',
            mediaType: 'tv',
        })
        expect(MovieExtrasSchema.safeParse(extras).success).toBe(true)
    })

    // ── Edge cases ────────────────────────────────────────────────────────
    it('returns null for a TV item without a numeric id (edge)', () => {
        expect(toTvResult({ name: 'no id' })).toBeNull()
    })

    it('handles missing episode_run_time and genres (edge)', () => {
        const details = toTvDetailView({ id: 5, name: 'Mystery Show', genres: null }, 5)
        expect(details.runtime).toBeNull()
        expect(details.genres).toEqual([])
        expect(toTvResults([{ id: 1, name: 'A' }, { name: 'no id' }])).toHaveLength(1)
    })
})
