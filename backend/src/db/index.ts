import { drizzle } from 'drizzle-orm/bun-sql'

// Bun loads `.env` natively — no `dotenv` needed. Fail fast with a clear message
// rather than letting the driver throw something opaque when the URL is unset.
const DATABASE_URL = process.env.DATABASE_URL
if (!DATABASE_URL) throw new Error('DATABASE_URL is not set')

export const db = drizzle(DATABASE_URL)
