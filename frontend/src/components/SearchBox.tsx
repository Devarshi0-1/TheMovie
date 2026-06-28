import { useQuery } from '@tanstack/react-query'
import { Link } from '@tanstack/react-router'
import { X } from 'lucide-react'
import { useId, useState } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Skeleton } from '@/components/ui/skeleton'
import { releaseYear, suggestMoviesQueryOptions } from '../lib/movies'

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
}

/**
 * The discovery search field with a live **typeahead**: as the user types we
 * query `/movies/suggest` (local catalog + TMDB, deduped) and show matching
 * titles below. Picking a suggestion jumps straight to that movie's detail page;
 * pressing Enter still runs a full search into the grid. The dropdown is a
 * labelled list of links (focusable, screen-reader navigable) that closes when
 * focus leaves the field.
 */
export function SearchBox({ value, onChange, onSubmit, placeholder, busy }: SearchBoxProps) {
    const id = useId()
    const listId = useId()
    const [open, setOpen] = useState(false)

    const q = value.trim()
    const suggestions = useQuery(suggestMoviesQueryOptions(q))
    const hasQuery = q.length >= 2
    const movies = suggestions.data ?? []
    const showLoading = hasQuery && suggestions.isFetching && movies.length === 0
    const showList = open && hasQuery && (movies.length > 0 || showLoading)

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
                    Search movies
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
                <ul
                    id={listId}
                    aria-label="Suggestions"
                    className="absolute left-0 right-0 top-full z-30 mt-2 max-h-[22rem] list-none overflow-y-auto rounded-xl border border-border bg-popover p-1.5 shadow-md"
                >
                    {showLoading
                        ? SKELETON_KEYS.map((key) => (
                              <li key={key} className="flex items-center gap-3 p-2">
                                  <Skeleton className="h-12 w-8 shrink-0 rounded" />
                                  <Skeleton className="h-4 w-40 rounded" />
                              </li>
                          ))
                        : movies.map((movie) => (
                              <li key={movie.tmdbId}>
                                  <Link
                                      to="/movie/$id"
                                      params={{ id: String(movie.tmdbId) }}
                                      onClick={() => setOpen(false)}
                                      className="flex items-center gap-3 rounded-lg p-2 text-sm hover:bg-accent focus-visible:bg-accent focus-visible:outline-none"
                                  >
                                      {movie.posterPath ? (
                                          <img
                                              src={`${TMDB_POSTER_THUMB_BASE}${movie.posterPath}`}
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
                                          <span className="block truncate font-medium">
                                              {movie.title}
                                          </span>
                                          <span className="block text-xs text-muted-foreground">
                                              {releaseYear(movie)}
                                          </span>
                                      </span>
                                  </Link>
                              </li>
                          ))}
                </ul>
            )}
        </search>
    )
}
