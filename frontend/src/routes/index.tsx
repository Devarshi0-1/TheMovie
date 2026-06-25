import { queryOptions, useSuspenseQuery } from '@tanstack/react-query'
import { createFileRoute } from '@tanstack/react-router'
import { MovieCard } from '../components/MovieCard'
import { parseMovies, SAMPLE_FEATURED } from '../lib/movies'

// A real TanStack Query query, prefetched in the route loader and read in the
// component. The queryFn validates with the shared schema before the data ever
// reaches React. Phase 7.2 swaps the queryFn for a `fetch('/api/v1/movies/...')`
// — the wiring (loader → ensureQueryData → useSuspenseQuery) stays identical.
const featuredMoviesQuery = queryOptions({
    queryKey: ['movies', 'featured'],
    queryFn: () => parseMovies(SAMPLE_FEATURED),
})

export const Route = createFileRoute('/')({
    loader: ({ context }) => context.queryClient.ensureQueryData(featuredMoviesQuery),
    component: Home,
})

const RETRIEVAL_TIERS = [
    {
        name: 'SQL search',
        blurb: 'Structured, exact intent — a title, a genre, a year. Cheapest tier.',
    },
    {
        name: 'Semantic search',
        blurb: 'Themes keywords can’t capture — “a hero who becomes the villain”. pgvector kNN.',
    },
    {
        name: 'TMDB fallback',
        blurb: 'Brand-new or obscure titles. On a hit, the catalog self-heals for next time.',
    },
]

function Home() {
    const { data: featured } = useSuspenseQuery(featuredMoviesQuery)

    return (
        <main className="home">
            <header className="home__hero">
                <p className="home__eyebrow">TheMovie</p>
                <h1 className="home__title">
                    Find a film by <em>describing</em> it, not naming it.
                </h1>
                <p className="home__lede">
                    An AI-native discovery platform. Ask in plain language — the agent escalates
                    across three retrieval tiers and reasons over the results.
                </p>
            </header>

            <section className="home__tiers" aria-label="Retrieval tiers">
                {RETRIEVAL_TIERS.map((tier, i) => (
                    <div key={tier.name} className="tier">
                        <span className="tier__index">{i + 1}</span>
                        <h2 className="tier__name">{tier.name}</h2>
                        <p className="tier__blurb">{tier.blurb}</p>
                    </div>
                ))}
            </section>

            <section className="home__featured" aria-label="Featured movies">
                <h2 className="home__section-title">Featured</h2>
                <div className="movie-grid">
                    {featured.map((movie) => (
                        <MovieCard key={movie.tmdbId} movie={movie} />
                    ))}
                </div>
            </section>
        </main>
    )
}
