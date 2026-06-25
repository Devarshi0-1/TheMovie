import { app } from './app'

// Server bootstrap. The Hono app lives in ./app so it can be imported by
// tests without starting a listener.
export default {
    // Port is configurable via PORT so the server can run alongside other local
    // services (and in containers); defaults to 3000.
    port: Number(process.env.PORT) || 3000,
    // Bun.serve idles connections out after 10s by default. The chat agent
    // streams a gpt-5 loop (reasoning + multi-step tool calls) where many seconds
    // can pass between bytes, so the default tears the SSE stream down mid-answer
    // and aborts in-flight tool fetches. Raise to Bun's maximum (255s).
    idleTimeout: 255,
    fetch: app.fetch,
}
