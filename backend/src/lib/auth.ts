import { betterAuth } from 'better-auth'
import { drizzleAdapter } from 'better-auth/adapters/drizzle'
import { db } from './../db'
import * as schema from './../db/schema'

export const auth = betterAuth({
    database: drizzleAdapter(db, {
        provider: 'pg',
        schema: schema,
    }),
    emailAndPassword: {
        enabled: true,
        minPasswordLength: 8,
        requireEmailVerification: false,
    },
    // Origin checks are ON (the dev-only `disableOriginCheck` escape hatch is
    // removed for Phase 6 hardening); requests must come from a trusted origin.
    trustedOrigins: [process.env.FRONTEND_URL!, 'http://localhost:3000'],
})
