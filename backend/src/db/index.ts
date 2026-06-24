import { drizzle } from 'drizzle-orm/bun-sql'
import 'dotenv/config'

export const db = drizzle(process.env.DATABASE_URL!)
