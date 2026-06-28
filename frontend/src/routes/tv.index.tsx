import { useQuery } from '@tanstack/react-query'
import { createFileRoute, useNavigate } from '@tanstack/react-router'
import { useState } from 'react'
import { z } from 'zod'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { MovieGrid } from '../components/MovieGrid'
import { searchTvQueryOptions, trendingTvQueryOptions } from '../lib/movies'

// `?q=` drives search; absent → trending TV. Trending is SSR-prefetched in the
// loader and read with `useQuery`; search resolves on the client.
const searchSchema = z.object({ q: z.string().optional() })

export const Route = createFileRoute('/tv/')({
    validateSearch: searchSchema,
    loader: ({ context }) => context.queryClient.prefetchQuery(trendingTvQueryOptions),
    component: TvBrowse,
})

function TvBrowse() {
    const { q } = Route.useSearch()
    const navigate = useNavigate({ from: '/tv/' })
    const [draft, setDraft] = useState(q ?? '')

    const trending = useQuery(trendingTvQueryOptions)
    const search = useQuery(searchTvQueryOptions(q ?? ''))

    const committed = q?.trim() ?? ''
    const isSearching = committed.length > 0

    function commit(e: React.FormEvent) {
        e.preventDefault()
        const next = draft.trim()
        void navigate({ search: next ? { q: next } : {} })
    }

    function handleChange(value: string) {
        setDraft(value)
        if (!value.trim()) void navigate({ search: {} })
    }

    return (
        <main className="mx-auto w-full max-w-[1100px] px-6 py-10">
            <header className="mb-10">
                <p className="mb-3 text-xs font-semibold uppercase tracking-[0.2em] text-primary">
                    TV Shows
                </p>
                <h1 className="mb-3 max-w-[18ch] text-3xl font-semibold leading-tight tracking-tight sm:text-4xl">
                    Browse series, not just films.
                </h1>
                <p className="mb-6 max-w-[56ch] text-lg leading-relaxed text-muted-foreground">
                    What’s trending in TV right now, plus full-text search across TMDB’s catalog.
                </p>
                <search>
                    <form onSubmit={commit} className="flex max-w-[560px] items-center gap-2">
                        <label className="sr-only" htmlFor="tv-search">
                            Search TV shows
                        </label>
                        <Input
                            id="tv-search"
                            type="search"
                            value={draft}
                            onChange={(e) => handleChange(e.target.value)}
                            placeholder="Search TV shows…"
                            autoComplete="off"
                        />
                        <Button type="submit" disabled={isSearching && search.isFetching}>
                            {isSearching && search.isFetching ? 'Searching…' : 'Search'}
                        </Button>
                    </form>
                </search>
            </header>

            <section aria-label={isSearching ? 'Search results' : 'Trending TV shows'}>
                <h2 className="mb-6 text-xl font-semibold tracking-tight">
                    {isSearching ? `Results for “${committed}”` : 'Trending now'}
                </h2>
                {isSearching ? (
                    <MovieGrid
                        movies={search.data}
                        isLoading={search.isPending}
                        isError={search.isError}
                        emptyLabel={`No shows match “${committed}”. Try another title.`}
                        errorLabel="Search failed. Please try again."
                        onRetry={() => void search.refetch()}
                    />
                ) : (
                    <MovieGrid
                        movies={trending.data}
                        isLoading={trending.isPending}
                        isError={trending.isError}
                        errorLabel="Couldn’t load trending TV right now. Please try again."
                        onRetry={() => void trending.refetch()}
                    />
                )}
            </section>
        </main>
    )
}
