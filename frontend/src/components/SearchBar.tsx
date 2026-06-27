import { useId } from 'react'

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
        <search className="searchbar">
            <form
                onSubmit={(e) => {
                    e.preventDefault()
                    onSubmit()
                }}
            >
                <label className="searchbar__label" htmlFor={id}>
                    Search movies
                </label>
                <div className="searchbar__row">
                    <input
                        id={id}
                        className="searchbar__input"
                        type="search"
                        value={value}
                        onChange={(e) => onChange(e.target.value)}
                        placeholder={placeholder ?? 'Search by title…'}
                        autoComplete="off"
                    />
                    {value && (
                        <button
                            type="button"
                            className="searchbar__clear"
                            onClick={() => onChange('')}
                            aria-label="Clear search"
                        >
                            ×
                        </button>
                    )}
                    <button type="submit" className="searchbar__submit" disabled={busy}>
                        {busy ? 'Searching…' : 'Search'}
                    </button>
                </div>
            </form>
        </search>
    )
}
