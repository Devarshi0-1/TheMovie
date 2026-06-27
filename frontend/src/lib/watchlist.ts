import { queryOptions, useMutation, useQueryClient } from '@tanstack/react-query'
import {
    WatchlistAddResultSchema,
    WatchlistEntrySchema,
    WatchlistRemoveResultSchema,
    WatchlistStatusSchema,
    type WatchlistAdd,
    type WatchlistEntry,
} from '@themovie/schemas'
import { z } from 'zod'
import { apiDelete, apiFetch, apiPost } from './api'

// The watchlist API is auth-gated (401 when signed out). All reads/writes are
// validated against the shared `@themovie/schemas` shapes, and the two caches —
// the list and per-movie membership — are kept in sync after every mutation.
//
// Query keys are defined ONCE here so every caller (the hooks, the watchlist
// screen, and the chat HITL flow) references the same key shape — a future key
// change can't silently desync one path from another.
export const watchlistKeys = {
    /** The whole list. */
    all: ['watchlist'] as const,
    /** Per-movie membership. */
    status: (movieId: number) => ['watchlist', 'status', movieId] as const,
}

const WatchlistListSchema = z.array(WatchlistEntrySchema)

export async function fetchWatchlist(): Promise<WatchlistEntry[]> {
    return WatchlistListSchema.parse(await apiFetch('/api/v1/watchlist'))
}

export const watchlistQueryOptions = queryOptions({
    queryKey: watchlistKeys.all,
    queryFn: fetchWatchlist,
})

export async function fetchWatchlistStatus(movieId: number): Promise<boolean> {
    return WatchlistStatusSchema.parse(await apiFetch(`/api/v1/watchlist/${movieId}/status`))
        .inWatchlist
}

export function watchlistStatusQueryOptions(movieId: number, enabled = true) {
    return queryOptions({
        queryKey: watchlistKeys.status(movieId),
        queryFn: () => fetchWatchlistStatus(movieId),
        enabled,
    })
}

export async function addToWatchlist(body: WatchlistAdd) {
    return WatchlistAddResultSchema.parse(await apiPost('/api/v1/watchlist', body))
}

export async function removeFromWatchlist(movieId: number) {
    return WatchlistRemoveResultSchema.parse(await apiDelete(`/api/v1/watchlist/${movieId}`))
}

/** Add-to-watchlist mutation that refreshes the list and flips the badge. */
export function useAddToWatchlist() {
    const qc = useQueryClient()
    return useMutation({
        mutationFn: addToWatchlist,
        onSuccess: (_res, vars) => {
            qc.setQueryData(watchlistKeys.status(vars.movieId), true)
            void qc.invalidateQueries({ queryKey: watchlistKeys.all })
        },
        onError: (err) => {
            // Surface the failure for observability; callers also read `isError`.
            console.error('Failed to add to watchlist', err)
        },
    })
}

/** Remove-from-watchlist mutation; mirror image of the add hook. */
export function useRemoveFromWatchlist() {
    const qc = useQueryClient()
    return useMutation({
        mutationFn: removeFromWatchlist,
        onSuccess: (_res, movieId) => {
            qc.setQueryData(watchlistKeys.status(movieId), false)
            void qc.invalidateQueries({ queryKey: watchlistKeys.all })
        },
        onError: (err) => {
            console.error('Failed to remove from watchlist', err)
        },
    })
}
