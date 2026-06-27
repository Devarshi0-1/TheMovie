import { Skeleton } from '@/components/ui/skeleton'

// Index-free keys for placeholders (max 12).
const KEYS = ['sk0', 'sk1', 'sk2', 'sk3', 'sk4', 'sk5', 'sk6', 'sk7', 'sk8', 'sk9', 'sk10', 'sk11']

// Shared so the loading grid and the real card grid stay pixel-aligned. Caps at
// three richer cards per row (1 on mobile, 2 on small, 3 on large).
export const POSTER_GRID_CLASS = 'grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-3'

interface PosterGridSkeletonProps {
    /** How many placeholder cards to render. */
    count?: number
    /** Reserve a button-row placeholder under each poster (the watchlist's Remove). */
    withAction?: boolean
    /** Accessible name announced by the polite live region while loading. */
    label?: string
    testId?: string
}

/**
 * A skeleton grid that mirrors the poster-card layout so loading reserves the
 * exact space the real cards will occupy — no layout shift when data arrives
 * (web.dev CLS) and a faster-feeling wait (Doherty Threshold). Built on the
 * shadcn `Skeleton`.
 */
export function PosterGridSkeleton({
    count = 10,
    withAction = false,
    label = 'Loading…',
    testId,
}: PosterGridSkeletonProps) {
    return (
        <div className={POSTER_GRID_CLASS} aria-busy="true" aria-label={label} data-testid={testId}>
            {KEYS.slice(0, count).map((key) => (
                <div key={key} className="flex flex-col gap-2">
                    <Skeleton className="aspect-[2/3] rounded-xl" aria-hidden="true" />
                    {withAction && (
                        <Skeleton className="h-8 w-full rounded-md" aria-hidden="true" />
                    )}
                </div>
            ))}
        </div>
    )
}
