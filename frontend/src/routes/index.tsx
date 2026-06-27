import { useQuery } from '@tanstack/react-query'
import { createFileRoute, useNavigate } from '@tanstack/react-router'
import { useState } from 'react'
import { z } from 'zod'
import { MovieGrid } from '../components/MovieGrid'
import { SearchBar } from '../components/SearchBar'
import { searchMoviesQueryOptions, trendingMoviesQueryOptions } from '../lib/movies'

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
            <header className="mb-12">
                <p className="mb-4 text-xs font-semibold uppercase tracking-[0.2em] text-primary">
                    TheMovie
                </p>
                <h1 className="mb-4 max-w-[18ch] text-4xl font-semibold leading-[1.05] tracking-tight [&_em]:not-italic [&_em]:text-primary sm:text-5xl lg:text-6xl">
                    Find a film by <em>describing</em> it, not naming it.
                </h1>
                <p className="mb-8 max-w-[56ch] text-lg leading-relaxed text-muted-foreground">
                    Search the catalog or browse what’s trending. The conversational agent goes
                    deeper — it’s coming next.
                </p>
                <SearchBar
                    value={draft}
                    onChange={handleChange}
                    onSubmit={commit}
                    placeholder="Search by title…"
                    busy={isSearching && search.isFetching}
                />
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
