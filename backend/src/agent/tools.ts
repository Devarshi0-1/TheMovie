import { tool } from 'ai'
import {
    FetchFromTmdbInputSchema,
    FindMoviesByPersonInputSchema,
    MovieDetailsInputSchema,
    ReviewSummaryInputSchema,
    SemanticSearchInputSchema,
    SimilarMoviesInputSchema,
    SqlSearchInputSchema,
    TrendingInputSchema,
    WatchProvidersInputSchema,
    type MovieResult,
} from '@themovie/schemas'
import { summarizeReviews, summaryDeps } from '../lib/summary'
import { findMoviesByPerson, findSimilarMovies, getWatchProviders } from './lookups'
import {
    fetchFromTmdb,
    getMovieDetails,
    getTrending,
    searchMoviesSql,
    semanticSearchMovies,
} from './retrieval'
import { fetchTvFromTmdb, getTrendingTvShows, searchTvSql, semanticSearchTv } from './retrieval-tv'

// Tool definitions for the agent loop (Phase 4.3). Descriptions are prescriptive
// about WHEN to call each, encoding the cheapest-sufficient-first escalation:
// SQL → semantic → TMDB. The agent should never fan out to all tiers by default.

const searchMoviesSqlTool = tool({
    description:
        'TIER 1 — structured catalog lookup over the local database. Use this FIRST for concrete, ' +
        'exact queries: a specific title, a genre, a release year, or a combination (e.g. "sci-fi from 2010"). ' +
        'Cheapest and most precise. If it returns nothing, or the query is conceptual/thematic rather than ' +
        'exact, escalate to semantic_search_movies.',
    inputSchema: SqlSearchInputSchema,
    execute: (input) => searchMoviesSql(input),
})

const semanticSearchMoviesTool = tool({
    description:
        'TIER 2 — semantic similarity search over embedded movies (pgvector). Use this for ' +
        'conceptual or thematic queries that keywords cannot capture, e.g. "a movie where the hero later ' +
        'becomes the villain" or "slow-burn dread like Hereditary". Prefer search_movies_sql first for exact ' +
        'queries. Set `mode` to match the query: "plot" for what a film is ABOUT (story, theme, premise); ' +
        '"reception" for how AUDIENCES experienced it (emotional impact, what people praise or criticize — ' +
        '"a movie audiences found genuinely terrifying", "a divisive ending people argue about"); "both" ' +
        '(the default) when unsure or when the query mixes the two. If this returns nothing relevant (the ' +
        'title may be missing from the catalog), escalate to fetch_from_tmdb.',
    inputSchema: SemanticSearchInputSchema,
    execute: (input) => semanticSearchMovies(input),
})

const fetchFromTmdbTool = tool({
    description:
        'TIER 3 — LAST RESORT. Fetch from the live TMDB API only when the local catalog misses: a brand-new ' +
        'release, an obscure title, or when both search_movies_sql and semantic_search_movies came up empty. ' +
        'On a hit the result is written back to the local catalog (upsert + embed) so future queries are ' +
        'served locally. Provide a `query` (title/keywords) or a specific `tmdbId`.',
    inputSchema: FetchFromTmdbInputSchema,
    execute: (input) => fetchFromTmdb(input),
})

const getMovieDetailsTool = tool({
    description:
        'Fetch full details (overview, genres, runtime, tagline, rating) for a SPECIFIC movie by its TMDB id. ' +
        'Use after a search has identified the movie the user means and you need more facts about it.',
    inputSchema: MovieDetailsInputSchema,
    execute: (input) => getMovieDetails(input),
})

const getTrendingTool = tool({
    description:
        'Get the movies currently trending on TMDB. Use for open-ended "what should I watch" / "what is ' +
        'popular right now" requests, not when the user already described what they want.',
    inputSchema: TrendingInputSchema,
    execute: (input) => getTrending(input),
})

const summarizeReviewsTool = tool({
    description:
        'Summarize a SPECIFIC movie’s audience reviews into spoiler-free pros/cons and a one-line ' +
        'vibe, by TMDB id. Use when the user asks what people think of a movie, its reception, or ' +
        'whether it’s worth watching. Results are cached, so it’s cheap to call.',
    inputSchema: ReviewSummaryInputSchema,
    execute: (input) => summarizeReviews(input.tmdbId),
})

const findMoviesByPersonTool = tool({
    description:
        'Find movies associated with a PERSON by name — an actor or director. Use for "movies starring ' +
        'Zendaya", "what has Christopher Nolan directed", "films with Tom Hardy". Returns their most ' +
        'notable movies (acting + directing credits, ranked by popularity). Do NOT use for movie titles — ' +
        'this resolves a person, not a film.',
    inputSchema: FindMoviesByPersonInputSchema,
    execute: (input) => findMoviesByPerson(input),
})

const getWatchProvidersTool = tool({
    description:
        'Where a SPECIFIC movie can be watched — streaming (subscription), rent, or buy — by TMDB id, ' +
        'for a region (default US). Use when the user asks "where can I watch / stream X", "is X on ' +
        'Netflix". Identify the movie via search first to get its tmdbId. Returns null when there are no ' +
        'offers in that region.',
    inputSchema: WatchProvidersInputSchema,
    execute: (input) => getWatchProviders(input),
})

const findSimilarMoviesTool = tool({
    description:
        'Get TMDB’s "more like this" recommendations for a SPECIFIC movie by tmdbId. Use for "movies like ' +
        'Inception", "what should I watch after X". This is the curated TMDB recommendation graph; for ' +
        'free-form thematic similarity ("films where the hero becomes the villain") use ' +
        'semantic_search_movies instead. Identify the movie via search first to get its tmdbId.',
    inputSchema: SimilarMoviesInputSchema,
    execute: (input) => findSimilarMovies(input),
})

// ── TV tools (Phase 10.4) ─────────────────────────────────────────────────────
// TV is a first-class media type with its own `tv_shows` catalog and retrieval
// tiers (retrieval-tv.ts), so it gets a parallel toolset rather than overloading
// the movie tools — the movie pipeline stays untouched. The TV retrieval helpers
// return the shared `MovieResult` shape (name/first_air_date normalized to
// title/releaseDate) but don't stamp `mediaType`; we tag each hit `'tv'` here so
// the chat UI routes its result cards to `/tv/:id` instead of `/movie/:id`.

export const asTvResults = <T extends MovieResult>(results: T[]): Array<T & { mediaType: 'tv' }> =>
    results.map((r) => ({ ...r, mediaType: 'tv' as const }))

const searchTvSqlTool = tool({
    description:
        'TIER 1 (TV) — structured catalog lookup over local TV shows. Use this FIRST for concrete, ' +
        'exact TV queries: a specific show title, a genre, a first-air year, or a combination ' +
        '(e.g. "crime dramas from 2015"). Cheapest and most precise for shows. If it returns nothing, ' +
        'or the query is conceptual/thematic, escalate to semantic_search_tv.',
    inputSchema: SqlSearchInputSchema,
    execute: async (input) => asTvResults(await searchTvSql(input)),
})

const semanticSearchTvTool = tool({
    description:
        'TIER 2 (TV) — semantic similarity search over embedded TV shows (pgvector). Use for ' +
        'conceptual or thematic TV queries keywords cannot capture, e.g. "a show about a teacher ' +
        'turned drug kingpin" or "a slow-burn prestige mystery". Prefer search_tv_sql for exact ' +
        'queries. Set `mode`: "plot" for what a show is ABOUT; "reception" for how AUDIENCES ' +
        'experienced it ("a sitcom people find genuinely comforting", "a finale fans argue about"); ' +
        '"both" (the default) when unsure. If nothing relevant comes back, escalate to fetch_tv_from_tmdb.',
    inputSchema: SemanticSearchInputSchema,
    execute: async (input) => asTvResults(await semanticSearchTv(input)),
})

const fetchTvFromTmdbTool = tool({
    description:
        'TIER 3 (TV) — LAST RESORT. Fetch TV shows from the live TMDB API only when the local ' +
        'catalog misses: a brand-new series, an obscure show, or when both search_tv_sql and ' +
        'semantic_search_tv came up empty. On a hit the show is written back to the local catalog ' +
        '(upsert + embed) so future queries are served locally. Provide a `query` (title/keywords) ' +
        'or a specific `tmdbId`.',
    inputSchema: FetchFromTmdbInputSchema,
    execute: async (input) => asTvResults(await fetchTvFromTmdb(input)),
})

const getTrendingTvTool = tool({
    description:
        'Get the TV shows currently trending on TMDB. Use for open-ended "what show should I watch" / ' +
        '"what series is popular right now" requests, not when the user already described what they want.',
    inputSchema: TrendingInputSchema,
    execute: async (input) => asTvResults(await getTrendingTvShows(input)),
})

const summarizeTvReviewsTool = tool({
    description:
        'Summarize a SPECIFIC TV show’s audience reviews into spoiler-free pros/cons and a one-line ' +
        'vibe, by TMDB show id. Use when the user asks what people think of a show, its reception, or ' +
        'whether it’s worth watching. Results are cached, so it’s cheap to call.',
    inputSchema: ReviewSummaryInputSchema,
    execute: (input) => summarizeReviews(input.tmdbId, summaryDeps('tv')),
})

/** The retrieval toolset the agent loop exposes to the model. */
export const retrievalTools = {
    search_movies_sql: searchMoviesSqlTool,
    semantic_search_movies: semanticSearchMoviesTool,
    fetch_from_tmdb: fetchFromTmdbTool,
    get_movie_details: getMovieDetailsTool,
    get_trending: getTrendingTool,
    summarize_reviews: summarizeReviewsTool,
    find_movies_by_person: findMoviesByPersonTool,
    get_watch_providers: getWatchProvidersTool,
    find_similar_movies: findSimilarMoviesTool,
    // TV parity (Phase 10.4) — same tiers over the `tv_shows` catalog.
    search_tv_sql: searchTvSqlTool,
    semantic_search_tv: semanticSearchTvTool,
    fetch_tv_from_tmdb: fetchTvFromTmdbTool,
    get_trending_tv: getTrendingTvTool,
    summarize_tv_reviews: summarizeTvReviewsTool,
}

export type RetrievalToolName = keyof typeof retrievalTools
