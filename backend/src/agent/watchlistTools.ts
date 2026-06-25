import { tool } from 'ai'
import { z } from 'zod'
import { getWatchlist } from '../lib/watchlist'
import { ManageWatchlistInputSchema } from '../schemas/watchlist'

// Watchlist agent tools are request-scoped: they're bound to the authenticated
// user, so they're built per request rather than living as module singletons
// like the (stateless) retrieval tools.
export function createWatchlistTools(userId: string) {
    return {
        get_user_watchlist: tool({
            description:
                "List the movies on the current user's watchlist. Use when the user asks what's on " +
                'their list, or to give context for recommendations.',
            inputSchema: z.object({}),
            execute: () => getWatchlist(userId),
        }),

        // Human-in-the-loop: NO `execute`. Mutations must never auto-run from the
        // model — calling this surfaces a proposal the client confirms (approve →
        // perform the change via the REST endpoint → addToolResult). The
        // confirmation UI lands in Phase 7.3.
        manage_watchlist: tool({
            description:
                "Add or remove a movie from the user's watchlist. This REQUIRES the user's explicit " +
                'confirmation before anything changes — it does not modify the watchlist on its own. ' +
                'Call it to propose the change; the user approves or denies it.',
            inputSchema: ManageWatchlistInputSchema,
        }),
    }
}

export type WatchlistToolName = keyof ReturnType<typeof createWatchlistTools>
