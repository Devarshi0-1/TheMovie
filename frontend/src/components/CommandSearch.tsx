import { useQuery } from '@tanstack/react-query'
import { useNavigate } from '@tanstack/react-router'
import { Search } from 'lucide-react'
import { useEffect, useState } from 'react'
import type { MovieResult } from '@themovie/schemas'
import { Button } from '@/components/ui/button'
import {
    Command,
    CommandDialog,
    CommandGroup,
    CommandInput,
    CommandItem,
    CommandList,
} from '@/components/ui/command'
import { Kbd } from '@/components/ui/kbd'
import { Skeleton } from '@/components/ui/skeleton'
import { useDebouncedValue } from '../hooks/use-debounced-value'
import { releaseYear, suggestAllQueryOptions } from '../lib/movies'

// Small poster for the suggestion thumbnails (TMDB serves posters at w92).
const TMDB_POSTER_THUMB_BASE = 'https://image.tmdb.org/t/p/w92'
const SKELETON_KEYS = ['c0', 'c1', 'c2', 'c3']

// One palette row. `value` stays unique across both groups (id-suffixed) so the
// command list's keyboard selection never collides between a movie and a show
// that share a tmdbId.
function SuggestionItem({
    item,
    onSelect,
}: {
    item: MovieResult
    onSelect: (item: MovieResult) => void
}) {
    return (
        <CommandItem
            value={`${item.mediaType ?? 'movie'} ${item.title} ${item.tmdbId}`}
            onSelect={() => onSelect(item)}
        >
            {item.posterPath ? (
                <img
                    src={`${TMDB_POSTER_THUMB_BASE}${item.posterPath}`}
                    alt=""
                    loading="lazy"
                    width={32}
                    height={48}
                    className="h-12 w-8 shrink-0 rounded object-cover"
                />
            ) : (
                <span
                    className="grid h-12 w-8 shrink-0 place-items-center rounded bg-muted text-xs"
                    aria-hidden="true"
                >
                    🎬
                </span>
            )}
            <span className="min-w-0">
                <span className="block truncate font-medium">{item.title}</span>
                <span className="block text-xs text-muted-foreground">{releaseYear(item)}</span>
            </span>
        </CommandItem>
    )
}

/**
 * App-wide search, reachable from any page via the header button or
 * ⌘K / Ctrl+K. Opens a command palette that queries `/search/suggest` (local
 * catalog + TMDB) as you type; results are split into **Movies** and **TV Shows**
 * groups, picking one jumps to its detail page (movie or TV, by `mediaType`), and
 * a "Search all results" row runs a full search into the discovery grid. This is
 * how a user on the movie detail / chat / watchlist pages jumps to another title
 * without going back to Discover first.
 */
export function CommandSearch() {
    const navigate = useNavigate()
    const [open, setOpen] = useState(false)
    const [query, setQuery] = useState('')

    // ⌘K / Ctrl+K toggles the palette from anywhere.
    useEffect(() => {
        function onKey(e: KeyboardEvent) {
            if (e.key === 'k' && (e.metaKey || e.ctrlKey)) {
                e.preventDefault()
                setOpen((prev) => !prev)
            }
        }
        document.addEventListener('keydown', onKey)
        return () => document.removeEventListener('keydown', onKey)
    }, [])

    // Debounce the query feeding the request so fast typing fires one suggest
    // call after a pause, not one per keystroke. `liveQ` keeps the palette's
    // prompts/loading state responsive to what's actually in the box.
    const liveQ = query.trim()
    const q = useDebouncedValue(liveQ, 250)
    const hasLiveQuery = liveQ.length >= 2
    const hasQuery = q.length >= 2
    const suggestions = useQuery({ ...suggestAllQueryOptions(q), enabled: hasQuery })
    const movies = suggestions.data?.movies ?? []
    const tv = suggestions.data?.tv ?? []
    const total = movies.length + tv.length
    const debouncePending = hasLiveQuery && liveQ !== q
    const showLoading = hasLiveQuery && (debouncePending || suggestions.isFetching) && total === 0

    function close() {
        setOpen(false)
        setQuery('')
    }

    function openResult(item: MovieResult) {
        close()
        if (item.mediaType === 'tv') {
            void navigate({ to: '/tv/$id', params: { id: String(item.tmdbId) } })
        } else {
            void navigate({ to: '/movie/$id', params: { id: String(item.tmdbId) } })
        }
    }

    function searchAll() {
        const next = liveQ
        close()
        void navigate({ to: '/', search: next ? { q: next } : {} })
    }

    return (
        <>
            <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => setOpen(true)}
                className="gap-2 text-muted-foreground"
                aria-label="Search movies and TV shows"
            >
                <Search data-icon aria-hidden="true" />
                <span className="hidden sm:inline">Search movies & TV…</span>
                <Kbd className="ml-1 hidden sm:inline-flex">⌘K</Kbd>
            </Button>

            <CommandDialog
                open={open}
                onOpenChange={(next) => (next ? setOpen(true) : close())}
                title="Search movies and TV shows"
                description="Find a movie or TV show by title and jump to its page."
            >
                <Command shouldFilter={false}>
                    <CommandInput
                        value={query}
                        onValueChange={setQuery}
                        placeholder="Search movies & TV…"
                    />
                    <CommandList>
                        {!hasLiveQuery && (
                            <p className="py-6 text-center text-sm text-muted-foreground">
                                Type at least 2 characters to search.
                            </p>
                        )}
                        {showLoading &&
                            SKELETON_KEYS.map((key) => (
                                <div key={key} className="flex items-center gap-3 p-2">
                                    <Skeleton className="h-12 w-8 shrink-0 rounded" />
                                    <Skeleton className="h-4 w-40 rounded" />
                                </div>
                            ))}
                        {hasLiveQuery && !showLoading && total === 0 && (
                            <p className="py-6 text-center text-sm text-muted-foreground">
                                Nothing matches “{liveQ}”.
                            </p>
                        )}
                        {movies.length > 0 && (
                            <CommandGroup heading="Movies">
                                {movies.map((movie) => (
                                    <SuggestionItem
                                        key={`movie-${movie.tmdbId}`}
                                        item={movie}
                                        onSelect={openResult}
                                    />
                                ))}
                            </CommandGroup>
                        )}
                        {tv.length > 0 && (
                            <CommandGroup heading="TV Shows">
                                {tv.map((show) => (
                                    <SuggestionItem
                                        key={`tv-${show.tmdbId}`}
                                        item={show}
                                        onSelect={openResult}
                                    />
                                ))}
                            </CommandGroup>
                        )}
                        {hasLiveQuery && (
                            <CommandGroup>
                                <CommandItem value="__search_all__" onSelect={searchAll}>
                                    <Search aria-hidden="true" />
                                    Search all results for “{liveQ}”
                                </CommandItem>
                            </CommandGroup>
                        )}
                    </CommandList>
                </Command>
            </CommandDialog>
        </>
    )
}
