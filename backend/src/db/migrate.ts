import { migrate } from 'drizzle-orm/bun-sql/migrator'
import { db } from './index'

// Bun-native migration runner — replaces `drizzle-kit migrate`, which can't run
// on this stack: the drizzle-kit CLI insists on a node `pg`/`postgres` driver we
// deliberately don't install, whereas this uses Drizzle's own bun-sql migrator
// over Bun.SQL (the same driver the app runs on). Reads the SQL files + journal
// in ../../drizzle and applies any not yet recorded in the
// `drizzle.__drizzle_migrations` table, so it's idempotent (a no-op when the DB
// is already up to date). Run with `bun run db:migrate`.
await migrate(db, { migrationsFolder: `${import.meta.dir}/../../drizzle` })
console.log('✅ Migrations applied (or already up to date).')
process.exit(0)
