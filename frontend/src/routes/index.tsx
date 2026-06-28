import { useQuery } from '@tanstack/react-query'
import { createFileRoute, Link, useNavigate } from '@tanstack/react-router'
import { Sparkles } from 'lucide-react'
import { useState } from 'react'
import { z } from 'zod'
import { Button } from '@/components/ui/button'
import { GenreFilter } from '../components/GenreFilter'
import { MovieGrid } from '../components/MovieGrid'
import { SearchBox } from '../components/SearchBox'
import {
    discoverByGenreQueryOptions,
    genresQueryOptions,
    searchMoviesQueryOptions,
    trendingMoviesQueryOptions,
} from '../lib/movies'
import { TMDB_BACKDROP_BASE } from '../lib/tmdb'

// Browse modes (priority): `?q=` search → `?genre=` genre browse → trending. The
// trending grid is SSR-prefetched in the loader and read with `useQuery`; search
// and genre browse resolve on the client.
const searchSchema = z.object({
    q: z.string().optional(),
    genre: z.coerce.number().int().positive().optional(),
})

export const Route = createFileRoute('/')({
    validateSearch: searchSchema,
    // Best-effort SSR prefetch: `prefetchQuery` never throws, so a transient
    // trending outage degrades to the grid's error state instead of crashing
    // the whole discovery page (the hero + search must always render).
    loader: ({ context }) => context.queryClient.prefetchQuery(trendingMoviesQueryOptions),
    component: Discover,
})

function Discover() {
    const { q, genre } = Route.useSearch()
    const navigate = useNavigate({ from: '/' })
    const [draft, setDraft] = useState(q ?? '')

    const committed = q?.trim() ?? ''
    const isSearching = committed.length > 0
    // Genre browse applies only when not searching.
    const activeGenre = isSearching ? undefined : genre

    const trending = useQuery(trendingMoviesQueryOptions)
    const search = useQuery(searchMoviesQueryOptions(q ?? ''))
    const byGenre = useQuery(discoverByGenreQueryOptions(activeGenre))
    const genres = useQuery(genresQueryOptions)
    const genreName = genres.data?.find((g) => g.id === activeGenre)?.name
    // The top trending title's backdrop becomes the hero's cinematic backdrop —
    // reusing already-loaded data (no extra request). Absent on a trending miss,
    // where the gradient surface still carries the hero.
    const featuredBackdrop = trending.data?.[0]?.backdropPath ?? null

    function commit() {
        const next = draft.trim()
        // Searching supersedes any genre filter.
        void navigate({ search: next ? { q: next } : {} })
    }

    function handleChange(value: string) {
        setDraft(value)
        // Emptying the box returns to trending immediately.
        if (!value.trim()) void navigate({ search: {} })
    }

    function selectGenre(id?: number) {
        void navigate({ search: id ? { genre: id } : {} })
    }

    return (
        <main className="mx-auto w-full max-w-[1100px] px-6 py-10">
            <header className="relative mb-12 rounded-2xl border border-border bg-card">
                {/* Backdrop + scrim live in their own clipped layer so the hero's
                    rounded corners still mask the image, WITHOUT the header
                    clipping the search typeahead dropdown that overflows below it. */}
                <div
                    className="pointer-events-none absolute inset-0 overflow-hidden rounded-2xl"
                    aria-hidden="true"
                >
                    {featuredBackdrop && (
                        <div
                            className="absolute inset-0 bg-cover bg-[center_25%] opacity-40"
                            style={{
                                backgroundImage: `url(${TMDB_BACKDROP_BASE}${featuredBackdrop})`,
                            }}
                        />
                    )}
                    {/* Scrim so the headline/search stay legible over any backdrop. */}
                    <div className="absolute inset-0 bg-gradient-to-tr from-card via-card/95 to-card/55" />
                </div>

                <div className="relative px-6 py-12 sm:px-10 sm:py-16">
                    <p className="mb-4 text-xs font-semibold uppercase tracking-[0.2em] text-primary">
                        TheMovie
                    </p>
                    <h1 className="mb-4 max-w-[18ch] text-4xl font-semibold leading-[1.05] tracking-tight [&_em]:not-italic [&_em]:text-primary sm:text-5xl lg:text-6xl">
                        Find a film by <em>describing</em> it, not naming it.
                    </h1>
                    <p className="mb-8 max-w-[56ch] text-lg leading-relaxed text-muted-foreground">
                        Search the catalog, browse what’s trending, or chat with the AI agent to
                        find something by its vibe — “a slow-burn thriller where nobody’s the hero.”
                    </p>
                    <div className="flex max-w-[640px] flex-col gap-3 sm:flex-row sm:items-center">
                        <div className="flex-1">
                            <SearchBox
                                value={draft}
                                onChange={handleChange}
                                onSubmit={commit}
                                placeholder="Search by title…"
                                busy={isSearching && search.isFetching}
                            />
                        </div>
                        <Button asChild variant="outline" className="shrink-0">
                            <Link to="/chat">
                                <Sparkles data-icon aria-hidden="true" /> Ask the agent
                            </Link>
                        </Button>
                    </div>
                </div>
            </header>

            {!isSearching && (
                <div className="mb-8">
                    <GenreFilter activeId={activeGenre} onSelect={selectGenre} />
                </div>
            )}

            <section
                aria-label={
                    isSearching
                        ? 'Search results'
                        : genreName
                          ? `${genreName} movies`
                          : 'Trending movies'
                }
            >
                <h2 className="mb-6 text-xl font-semibold tracking-tight">
                    {isSearching
                        ? `Results for “${committed}”`
                        : genreName
                          ? `Top ${genreName}`
                          : 'Trending now'}
                </h2>
                {isSearching ? (
                    <MovieGrid
                        movies={search.data}
                        isLoading={search.isPending}
                        isError={search.isError}
                        emptyLabel={`No movies match “${committed}”. Try another title.`}
                        errorLabel="Search failed. Please try again."
                        onRetry={() => void search.refetch()}
                    />
                ) : activeGenre ? (
                    <MovieGrid
                        movies={byGenre.data}
                        isLoading={byGenre.isPending}
                        isError={byGenre.isError}
                        emptyLabel="No movies found for that genre."
                        errorLabel="Couldn’t load that genre. Please try again."
                        onRetry={() => void byGenre.refetch()}
                    />
                ) : (
                    <MovieGrid
                        movies={trending.data}
                        isLoading={trending.isPending}
                        isError={trending.isError}
                        errorLabel="Couldn’t load trending right now. Please try again."
                        onRetry={() => void trending.refetch()}
                    />
                )}
            </section>
        </main>
    )
}
