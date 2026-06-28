import { useQuery } from '@tanstack/react-query'
import { Link } from '@tanstack/react-router'
import { X } from 'lucide-react'
import { useId, useState } from 'react'
import type { MovieResult } from '@themovie/schemas'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Skeleton } from '@/components/ui/skeleton'
import { releaseYear, suggestAllQueryOptions, suggestTvQueryOptions } from '../lib/movies'

// Small poster for the suggestion thumbnails (TMDB serves posters at w92).
const TMDB_POSTER_THUMB_BASE = 'https://image.tmdb.org/t/p/w92'
const SKELETON_KEYS = ['s0', 's1', 's2', 's3']

interface SearchBoxProps {
    value: string
    onChange: (value: string) => void
    /** Full-text search submit (Enter / the Search button) — drives `?q=`. */
    onSubmit: () => void
    placeholder?: string
    busy?: boolean
    /**
     * Which catalog to suggest from. `'all'` (default, used on Discover) blends
     * Movies + TV in two groups; `'tv'` (used on the TV browse page) suggests
     * TV shows only. Either way a pick routes by the result's `mediaType`.
     */
    scope?: 'all' | 'tv'
}

// One suggestion row, routed to /movie/:id or /tv/:id by its mediaType.
function SuggestionLink({ item, onPick }: { item: MovieResult; onPick: () => void }) {
    const to = item.mediaType === 'tv' ? '/tv/$id' : '/movie/$id'
    return (
        <li>
            <Link
                to={to}
                params={{ id: String(item.tmdbId) }}
                onClick={onPick}
                className="flex items-center gap-3 rounded-lg p-2 text-sm hover:bg-accent focus-visible:bg-accent focus-visible:outline-none"
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
            </Link>
        </li>
    )
}

/**
 * The discovery search field with a live **typeahead**: as the user types we
 * query `/search/suggest` (local catalog + TMDB, deduped) and show matching
 * titles below, split into **Movies** and **TV Shows** groups. Picking a
 * suggestion jumps straight to that title's detail page (movie or TV, by its
 * `mediaType`); pressing Enter still runs a full search into the grid. The
 * dropdown is a labelled list of links (focusable, screen-reader navigable) that
 * closes when focus leaves the field.
 */
export function SearchBox({
    value,
    onChange,
    onSubmit,
    placeholder,
    busy,
    scope = 'all',
}: SearchBoxProps) {
    const id = useId()
    const listId = useId()
    const [open, setOpen] = useState(false)

    const q = value.trim()
    const hasQuery = q.length >= 2
    // Both hooks are always called (Rules of Hooks); only the in-scope one is
    // enabled, so the other never fetches.
    const allQuery = useQuery({
        ...suggestAllQueryOptions(q),
        enabled: scope === 'all' && hasQuery,
    })
    const tvQuery = useQuery({ ...suggestTvQueryOptions(q), enabled: scope === 'tv' && hasQuery })

    const movies = scope === 'all' ? (allQuery.data?.movies ?? []) : []
    const tv = scope === 'all' ? (allQuery.data?.tv ?? []) : (tvQuery.data ?? [])
    const total = movies.length + tv.length
    const isFetching = scope === 'all' ? allQuery.isFetching : tvQuery.isFetching
    const showLoading = hasQuery && isFetching && total === 0
    const showList = open && hasQuery && (total > 0 || showLoading)

    return (
        <search
            className="relative"
            // Close the dropdown once focus leaves the whole field (input + list),
            // but keep it open while moving between them.
            onBlur={(e) => {
                if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setOpen(false)
            }}
        >
            <form
                onSubmit={(e) => {
                    e.preventDefault()
                    setOpen(false)
                    onSubmit()
                }}
            >
                <label className="sr-only" htmlFor={id}>
                    {scope === 'tv' ? 'Search TV shows' : 'Search movies and TV shows'}
                </label>
                <div className="flex items-center gap-2">
                    <Input
                        id={id}
                        type="search"
                        value={value}
                        onChange={(e) => {
                            onChange(e.target.value)
                            setOpen(true)
                        }}
                        onFocus={() => setOpen(true)}
                        placeholder={placeholder ?? 'Search by title…'}
                        autoComplete="off"
                        aria-controls={listId}
                        aria-expanded={showList}
                    />
                    {value && (
                        <Button
                            type="button"
                            variant="ghost"
                            size="icon"
                            onClick={() => onChange('')}
                            aria-label="Clear search"
                        >
                            <X />
                        </Button>
                    )}
                    <Button type="submit" disabled={busy}>
                        {busy ? 'Searching…' : 'Search'}
                    </Button>
                </div>
            </form>

            {showList && (
                <div
                    id={listId}
                    className="absolute left-0 right-0 top-full z-30 mt-2 max-h-[26rem] overflow-y-auto rounded-xl border border-border bg-popover p-1.5 shadow-md"
                >
                    {showLoading ? (
                        <ul aria-label="Loading suggestions" className="list-none">
                            {SKELETON_KEYS.map((key) => (
                                <li key={key} className="flex items-center gap-3 p-2">
                                    <Skeleton className="h-12 w-8 shrink-0 rounded" />
                                    <Skeleton className="h-4 w-40 rounded" />
                                </li>
                            ))}
                        </ul>
                    ) : (
                        <>
                            {movies.length > 0 && (
                                <section>
                                    <h2 className="px-2 pb-1 pt-2 text-xs font-medium text-muted-foreground">
                                        Movies
                                    </h2>
                                    <ul aria-label="Movie suggestions" className="list-none">
                                        {movies.map((movie) => (
                                            <SuggestionLink
                                                key={`movie-${movie.tmdbId}`}
                                                item={movie}
                                                onPick={() => setOpen(false)}
                                            />
                                        ))}
                                    </ul>
                                </section>
                            )}
                            {tv.length > 0 && (
                                <section>
                                    <h2 className="px-2 pb-1 pt-2 text-xs font-medium text-muted-foreground">
                                        TV Shows
                                    </h2>
                                    <ul aria-label="TV show suggestions" className="list-none">
                                        {tv.map((show) => (
                                            <SuggestionLink
                                                key={`tv-${show.tmdbId}`}
                                                item={show}
                                                onPick={() => setOpen(false)}
                                            />
                                        ))}
                                    </ul>
                                </section>
                            )}
                        </>
                    )}
                </div>
            )}
        </search>
    )
}
