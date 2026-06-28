import { useQuery } from '@tanstack/react-query'
import { Button } from '@/components/ui/button'
import { genresQueryOptions } from '../lib/movies'

/**
 * A row of genre chips for the Discover page. "All" clears the filter; selecting
 * a genre browses that genre (popularity-ordered, via TMDB discover). The active
 * chip is filled; the rest are outlined. Renders nothing until the (static)
 * genre list loads.
 */
export function GenreFilter({
    activeId,
    onSelect,
}: {
    activeId?: number
    onSelect: (id?: number) => void
}) {
    const genres = useQuery(genresQueryOptions)
    if (!genres.data || genres.data.length === 0) return null

    return (
        <fieldset className="flex flex-wrap gap-2" aria-label="Filter by genre">
            <Button
                type="button"
                size="sm"
                variant={activeId === undefined ? 'default' : 'outline'}
                aria-pressed={activeId === undefined}
                onClick={() => onSelect(undefined)}
            >
                All
            </Button>
            {genres.data.map((genre) => (
                <Button
                    key={genre.id}
                    type="button"
                    size="sm"
                    variant={activeId === genre.id ? 'default' : 'outline'}
                    aria-pressed={activeId === genre.id}
                    onClick={() => onSelect(genre.id)}
                >
                    {genre.name}
                </Button>
            ))}
        </fieldset>
    )
}
