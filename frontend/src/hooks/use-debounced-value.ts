import { useEffect, useState } from 'react'

/**
 * Returns a copy of `value` that only updates after it has stayed unchanged for
 * `delayMs`. Used to throttle typeahead queries: while the user is actively
 * typing the debounced value holds steady, so we fire **one** suggest request
 * after they pause instead of one per keystroke. The raw `value` still drives the
 * input itself, so the field stays fully responsive.
 */
export function useDebouncedValue<T>(value: T, delayMs = 250): T {
    const [debounced, setDebounced] = useState(value)

    useEffect(() => {
        const id = setTimeout(() => setDebounced(value), delayMs)
        return () => clearTimeout(id)
    }, [value, delayMs])

    return debounced
}
