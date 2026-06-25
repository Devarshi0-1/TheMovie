import { tool } from 'ai'
import {
    FetchFromTmdbInputSchema,
    MovieDetailsInputSchema,
    ReviewSummaryInputSchema,
    SemanticSearchInputSchema,
    SqlSearchInputSchema,
    TrendingInputSchema,
} from '../schemas/movie'
import { summarizeReviews } from '../lib/summary'
import {
    fetchFromTmdb,
    getMovieDetails,
    getTrending,
    searchMoviesSql,
    semanticSearchMovies,
} from './retrieval'

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
        'TIER 2 — semantic similarity search over embedded movie plots/themes (pgvector). Use this for ' +
        'conceptual or thematic queries that keywords cannot capture, e.g. "a movie where the hero later ' +
        'becomes the villain" or "slow-burn dread like Hereditary". Prefer search_movies_sql first for exact ' +
        'queries. If this returns nothing relevant (the title may be missing from the catalog), escalate to ' +
        'fetch_from_tmdb.',
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

/** The retrieval toolset the agent loop exposes to gpt-5. */
export const retrievalTools = {
    search_movies_sql: searchMoviesSqlTool,
    semantic_search_movies: semanticSearchMoviesTool,
    fetch_from_tmdb: fetchFromTmdbTool,
    get_movie_details: getMovieDetailsTool,
    get_trending: getTrendingTool,
    summarize_reviews: summarizeReviewsTool,
}

export type RetrievalToolName = keyof typeof retrievalTools
