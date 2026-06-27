import { app } from './app'
import { startSummaryRefreshScheduler } from './jobs/scheduler'

// Resolve the listen port from PORT. Plain `Number(PORT) || 3000` is wrong: it
// treats the valid `PORT=0` (let the OS assign a free ephemeral port — common in
// CI/tests) as falsy and silently binds 3000 instead, and it masks a typo'd
// non-numeric PORT as 3000 too. Default only when PORT is unset/empty; otherwise
// require a valid integer in range (0 allowed) and fail loudly on garbage.
export function resolvePort(raw: string | undefined): number {
    if (raw === undefined || raw.trim() === '') return 3000
    const n = Number(raw)
    if (!Number.isInteger(n) || n < 0 || n > 65535) {
        throw new Error(`Invalid PORT "${raw}": expected an integer in [0, 65535]`)
    }
    return n
}

// Start the background summary-refresh scheduler, but ONLY when this file is the
// process entrypoint — importing it for `resolvePort` (see index.test.ts) must
// not spin up timers or touch Redis. No-op unless SUMMARY_REFRESH_INTERVAL_HOURS
// is set, so local/dev stays quiet by default.
if (import.meta.main) startSummaryRefreshScheduler()

// Server bootstrap. The Hono app lives in ./app so it can be imported by
// tests without starting a listener.
export default {
    // Port is configurable via PORT so the server can run alongside other local
    // services (and in containers); defaults to 3000.
    port: resolvePort(process.env.PORT),
    // Bun.serve idles connections out after 10s by default. The chat agent
    // streams a reasoning + multi-step tool-calling loop where many seconds
    // can pass between bytes, so the default tears the SSE stream down mid-answer
    // and aborts in-flight tool fetches. Raise to Bun's maximum (255s).
    idleTimeout: 255,
    fetch: app.fetch,
}
