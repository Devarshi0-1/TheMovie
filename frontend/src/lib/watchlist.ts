import { queryOptions, useMutation, useQueryClient } from '@tanstack/react-query'
import { WatchlistEntrySchema, type WatchlistAdd, type WatchlistEntry } from '@themovie/schemas'
import { z } from 'zod'
import { apiDelete, apiFetch, apiPost } from './api'

// The watchlist API is auth-gated (401 when signed out). All reads/writes are
// validated against the shared `@themovie/schemas` shapes, and the two caches —
// the list (`['watchlist']`) and per-movie membership
// (`['watchlist','status',id]`) — are kept in sync after every mutation.

const WatchlistListSchema = z.array(WatchlistEntrySchema)

export async function fetchWatchlist(): Promise<WatchlistEntry[]> {
    return WatchlistListSchema.parse(await apiFetch('/api/v1/watchlist'))
}

export const watchlistQueryOptions = queryOptions({
    queryKey: ['watchlist'] as const,
    queryFn: fetchWatchlist,
})

const StatusSchema = z.object({ inWatchlist: z.boolean() })

export async function fetchWatchlistStatus(movieId: number): Promise<boolean> {
    return StatusSchema.parse(await apiFetch(`/api/v1/watchlist/${movieId}/status`)).inWatchlist
}

export function watchlistStatusQueryOptions(movieId: number, enabled = true) {
    return queryOptions({
        queryKey: ['watchlist', 'status', movieId] as const,
        queryFn: () => fetchWatchlistStatus(movieId),
        enabled,
    })
}

const AddResultSchema = z.object({ added: z.boolean(), movieId: z.number() })
export async function addToWatchlist(body: WatchlistAdd) {
    return AddResultSchema.parse(await apiPost('/api/v1/watchlist', body))
}

const RemoveResultSchema = z.object({ removed: z.boolean(), movieId: z.number() })
export async function removeFromWatchlist(movieId: number) {
    return RemoveResultSchema.parse(await apiDelete(`/api/v1/watchlist/${movieId}`))
}

/** Add-to-watchlist mutation that refreshes the list and flips the badge. */
export function useAddToWatchlist() {
    const qc = useQueryClient()
    return useMutation({
        mutationFn: addToWatchlist,
        onSuccess: (_res, vars) => {
            qc.setQueryData(['watchlist', 'status', vars.movieId], true)
            void qc.invalidateQueries({ queryKey: ['watchlist'] })
        },
    })
}

/** Remove-from-watchlist mutation; mirror image of the add hook. */
export function useRemoveFromWatchlist() {
    const qc = useQueryClient()
    return useMutation({
        mutationFn: removeFromWatchlist,
        onSuccess: (_res, movieId) => {
            qc.setQueryData(['watchlist', 'status', movieId], false)
            void qc.invalidateQueries({ queryKey: ['watchlist'] })
        },
    })
}
