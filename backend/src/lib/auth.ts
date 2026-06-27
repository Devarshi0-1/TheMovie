import { betterAuth } from 'better-auth'
import { drizzleAdapter } from 'better-auth/adapters/drizzle'
import { db } from './../db'
import * as schema from './../db/schema'

// Trusted origins (also the CORS allow-list — imported by app.ts so the two
// can't drift). Localhost is only trusted outside production, so the dev ports
// don't ship as trusted origins to prod.
const devOrigins =
    process.env.NODE_ENV === 'production'
        ? []
        : ['http://localhost:5173', 'http://localhost:3000']

export const trustedOrigins = [process.env.FRONTEND_URL, ...devOrigins].filter(
    (origin): origin is string => Boolean(origin),
)

// Cross-site cookies (SameSite=None; Secure) are needed only when the frontend
// and backend deploy to different registrable domains. Opt in via env; the
// default stays SameSite=Lax for the same-site dev setup. (Closes AU-2/BSEC-2.)
const crossSiteCookies = process.env.CROSS_SITE_COOKIES === 'true'

export const auth = betterAuth({
    database: drizzleAdapter(db, {
        provider: 'pg',
        schema: schema,
    }),
    emailAndPassword: {
        enabled: true,
        minPasswordLength: 8,
        requireEmailVerification: false,
        // Hash with Bun.password (Argon2id) per project policy, rather than
        // BetterAuth's built-in scrypt fallback.
        password: {
            hash: (password) => Bun.password.hash(password),
            verify: ({ password, hash }) => Bun.password.verify(password, hash),
        },
    },
    ...(crossSiteCookies
        ? { advanced: { defaultCookieAttributes: { sameSite: 'none', secure: true } } }
        : {}),
    // Origin checks are ON; requests must come from a trusted origin.
    trustedOrigins,
})
