import { app } from './app'

// Server bootstrap. The Hono app lives in ./app so it can be imported by
// tests without starting a listener.
export default {
    port: 3000,
    fetch: app.fetch,
}
