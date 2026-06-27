import { useId } from 'react'
import { X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'

interface SearchBarProps {
    value: string
    onChange: (value: string) => void
    onSubmit: () => void
    placeholder?: string
    busy?: boolean
}

/**
 * Controlled search input for the discovery screen. Pure — the route owns the
 * query state (mirrored into the URL) and the actual fetching. Submitting (or
 * clearing) just notifies the parent.
 */
export function SearchBar({ value, onChange, onSubmit, placeholder, busy }: SearchBarProps) {
    const id = useId()

    return (
        <search>
            <form
                onSubmit={(e) => {
                    e.preventDefault()
                    onSubmit()
                }}
            >
                <label className="sr-only" htmlFor={id}>
                    Search movies
                </label>
                <div className="flex max-w-[560px] items-center gap-2">
                    <Input
                        id={id}
                        type="search"
                        value={value}
                        onChange={(e) => onChange(e.target.value)}
                        placeholder={placeholder ?? 'Search by title…'}
                        autoComplete="off"
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
        </search>
    )
}
