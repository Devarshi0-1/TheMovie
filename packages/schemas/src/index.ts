// Shared Zod schemas — the single definition consumed by the backend
// (Hono validation, AI SDK tool inputs + generateObject) and the frontend
// (TanStack Form). Re-exports every schema module.
export * from './auth'
export * from './chat'
export * from './intent'
export * from './movie'
export * from './recommendation'
export * from './review'
export * from './watchlist'
