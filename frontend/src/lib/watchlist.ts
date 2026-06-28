import { queryOptions, useMutation, useQueryClient } from '@tanstack/react-query'
import {
    WatchlistAddResultSchema,
    WatchlistEntrySchema,
    WatchlistRemoveResultSchema,
    WatchlistStatusSchema,
    type MediaType,
    type WatchlistAdd,
    type WatchlistEntry,
} from '@themovie/schemas'
import { z } from 'zod'
import { apiDelete, apiFetch, apiPost } from './api'

// The watchlist API is auth-gated (401 when signed out). All reads/writes are
// validated against the shared `@themovie/schemas` shapes, and the two caches —
// the list and per-title membership — are kept in sync after every mutation.
//
// Because a movie and a show can share a TMDB id, membership is keyed on
// (mediaType, movieId) everywhere. Query keys are defined ONCE here so every
// caller (the hooks, the watchlist screen, and the chat HITL flow) references
// the same key shape — a future key change can't silently desync one path.
export const watchlistKeys = {
    /** The whole list. */
    all: ['watchlist'] as const,
    /** Per-title membership, scoped by media type. */
    status: (mediaType: MediaType, movieId: number) =>
        ['watchlist', 'status', mediaType, movieId] as const,
}

const WatchlistListSchema = z.array(WatchlistEntrySchema)

export async function fetchWatchlist(): Promise<WatchlistEntry[]> {
    return WatchlistListSchema.parse(await apiFetch('/api/v1/watchlist'))
}

export const watchlistQueryOptions = queryOptions({
    queryKey: watchlistKeys.all,
    queryFn: fetchWatchlist,
})

export async function fetchWatchlistStatus(
    movieId: number,
    mediaType: MediaType,
): Promise<boolean> {
    return WatchlistStatusSchema.parse(
        await apiFetch(`/api/v1/watchlist/${movieId}/status?mediaType=${mediaType}`),
    ).inWatchlist
}

export function watchlistStatusQueryOptions(movieId: number, mediaType: MediaType, enabled = true) {
    return queryOptions({
        queryKey: watchlistKeys.status(mediaType, movieId),
        queryFn: () => fetchWatchlistStatus(movieId, mediaType),
        enabled,
    })
}

export async function addToWatchlist(body: WatchlistAdd) {
    return WatchlistAddResultSchema.parse(await apiPost('/api/v1/watchlist', body))
}

export async function removeFromWatchlist(movieId: number, mediaType: MediaType) {
    return WatchlistRemoveResultSchema.parse(
        await apiDelete(`/api/v1/watchlist/${movieId}?mediaType=${mediaType}`),
    )
}

/** Add-to-watchlist mutation that refreshes the list and flips the badge. */
export function useAddToWatchlist() {
    const qc = useQueryClient()
    return useMutation({
        mutationFn: addToWatchlist,
        onSuccess: (res, vars) => {
            qc.setQueryData(watchlistKeys.status(res.mediaType, vars.movieId), true)
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
        mutationFn: ({ movieId, mediaType }: { movieId: number; mediaType: MediaType }) =>
            removeFromWatchlist(movieId, mediaType),
        onSuccess: (res, vars) => {
            qc.setQueryData(watchlistKeys.status(vars.mediaType, res.movieId), false)
            void qc.invalidateQueries({ queryKey: watchlistKeys.all })
        },
        onError: (err) => {
            console.error('Failed to remove from watchlist', err)
        },
    })
}
