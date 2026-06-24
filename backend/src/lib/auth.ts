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
        minPasswordLength: 4,
        requireEmailVerification: false,
    },
    trustedOrigins: [process.env.FRONTEND_URL!, 'http://localhost:3000'],
    advanced: { disableOriginCheck: true },
})
