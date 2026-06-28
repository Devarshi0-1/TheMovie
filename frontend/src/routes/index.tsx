import { useQuery } from '@tanstack/react-query'
import { createFileRoute, Link, useNavigate } from '@tanstack/react-router'
import { Sparkles } from 'lucide-react'
import { useState } from 'react'
import { z } from 'zod'
import { Button } from '@/components/ui/button'
import { MovieGrid } from '../components/MovieGrid'
import { SearchBox } from '../components/SearchBox'
import { searchMoviesQueryOptions, trendingMoviesQueryOptions } from '../lib/movies'
import { TMDB_BACKDROP_BASE } from '../lib/tmdb'

// `?q=` drives search; absent → trending. The trending grid is SSR-prefetched in
// the loader via best-effort `prefetchQuery` and read with `useQuery`, while
// search resolves on the client as the user queries.
const searchSchema = z.object({ q: z.string().optional() })

export const Route = createFileRoute('/')({
    validateSearch: searchSchema,
    // Best-effort SSR prefetch: `prefetchQuery` never throws, so a transient
    // trending outage degrades to the grid's error state instead of crashing
    // the whole discovery page (the hero + search must always render).
    loader: ({ context }) => context.queryClient.prefetchQuery(trendingMoviesQueryOptions),
    component: Discover,
})

function Discover() {
    const { q } = Route.useSearch()
    const navigate = useNavigate({ from: '/' })
    const [draft, setDraft] = useState(q ?? '')

    const trending = useQuery(trendingMoviesQueryOptions)
    const search = useQuery(searchMoviesQueryOptions(q ?? ''))

    const committed = q?.trim() ?? ''
    const isSearching = committed.length > 0
    // The top trending title's backdrop becomes the hero's cinematic backdrop —
    // reusing already-loaded data (no extra request). Absent on a trending miss,
    // where the gradient surface still carries the hero.
    const featuredBackdrop = trending.data?.[0]?.backdropPath ?? null

    function commit() {
        const next = draft.trim()
        void navigate({ search: next ? { q: next } : {} })
    }

    function handleChange(value: string) {
        setDraft(value)
        // Emptying the box returns to trending immediately.
        if (!value.trim()) void navigate({ search: {} })
    }

    return (
        <main className="mx-auto w-full max-w-[1100px] px-6 py-10">
            <header className="relative mb-12 overflow-hidden rounded-2xl border border-border bg-card">
                {featuredBackdrop && (
                    <div
                        className="pointer-events-none absolute inset-0 bg-cover bg-[center_25%] opacity-40"
                        style={{ backgroundImage: `url(${TMDB_BACKDROP_BASE}${featuredBackdrop})` }}
                        aria-hidden="true"
                    />
                )}
                {/* Scrim so the headline/search stay legible over any backdrop. */}
                <div
                    className="pointer-events-none absolute inset-0 bg-gradient-to-tr from-card via-card/95 to-card/55"
                    aria-hidden="true"
                />

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

            <section aria-label={isSearching ? 'Search results' : 'Trending movies'}>
                <h2 className="mb-6 text-xl font-semibold tracking-tight">
                    {isSearching ? `Results for “${committed}”` : 'Trending now'}
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
