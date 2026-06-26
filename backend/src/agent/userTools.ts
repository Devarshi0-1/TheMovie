import { tool } from 'ai'
import { z } from 'zod'
import { recommendForUser } from '../lib/recommendations'
import { getWatchlist } from '../lib/watchlist'
import { ManageWatchlistInputSchema } from '@themovie/schemas'

// Per-user agent tools — bound to the authenticated user, so they're built per
// request rather than living as module singletons like the (stateless)
// retrieval tools.
export function createUserTools(userId: string) {
    return {
        get_user_watchlist: tool({
            description:
                "List the movies on the current user's watchlist. Use when the user asks what's on " +
                'their list, or to give context for recommendations.',
            inputSchema: z.object({}),
            execute: () => getWatchlist(userId),
        }),

        get_recommendations: tool({
            description:
                'Get personalized "because you watched X" recommendations for the current user, ' +
                'derived from their watchlist via similarity search. Use for "recommend me something", ' +
                '"what should I watch", or when the user wants suggestions based on their taste.',
            inputSchema: z.object({}),
            execute: () => recommendForUser(userId),
        }),

        // Human-in-the-loop: NO `execute`. Mutations must never auto-run from the
        // model — calling this surfaces a proposal the client confirms (approve →
        // perform the change via the REST endpoint → addToolResult). The
        // confirmation UI lands in Phase 7.3.
        manage_watchlist: tool({
            description:
                "Add or remove movies on the user's watchlist. Pass EVERY movie the user wants " +
                'changed in ONE call via the `movies` array — never call this tool repeatedly, ' +
                "one per movie. This REQUIRES the user's explicit confirmation before anything " +
                'changes; it does not modify the watchlist on its own. Call it to propose the ' +
                'change; the user approves or denies it.',
            inputSchema: ManageWatchlistInputSchema,
        }),
    }
}

export type UserToolName = keyof ReturnType<typeof createUserTools>
