import { describe, expect, it } from 'bun:test'
import { Hono } from 'hono'
import { rateLimit, type RateLimitStore } from './rateLimit'

// In-memory store; counts per key like Redis INCR within a window.
const memoryStore = () => {
    const counts = new Map<string, number>()
    const store: RateLimitStore = {
        async hit(key) {
            const n = (counts.get(key) ?? 0) + 1
            counts.set(key, n)
            return n
        },
    }
    return { store, counts }
}

const appWith = (store: RateLimitStore, limit = 2) => {
    const app = new Hono()
    app.use('*', rateLimit({ prefix: 't', limit, windowSeconds: 60, store }))
    app.get('/x', (c) => c.text('ok'))
    return app
}

describe('rateLimit', () => {
    it('allows requests up to the limit, then 429s (feature)', async () => {
        const { store } = memoryStore()
        const app = appWith(store, 2)
        expect((await app.request('/x')).status).toBe(200)
        expect((await app.request('/x')).status).toBe(200)
        const blocked = await app.request('/x')
        expect(blocked.status).toBe(429)
        expect(blocked.headers.get('Retry-After')).toBe('60')
    })

    it('reports remaining quota in headers (feature: observability)', async () => {
        const { store } = memoryStore()
        const app = appWith(store, 5)
        const res = await app.request('/x')
        expect(res.headers.get('X-RateLimit-Limit')).toBe('5')
        expect(res.headers.get('X-RateLimit-Remaining')).toBe('4')
    })

    it('counts clients independently by forwarded IP (feature)', async () => {
        const { store } = memoryStore()
        const app = appWith(store, 1)
        const a = await app.request('/x', { headers: { 'x-forwarded-for': '1.1.1.1' } })
        const b = await app.request('/x', { headers: { 'x-forwarded-for': '2.2.2.2' } })
        expect(a.status).toBe(200)
        expect(b.status).toBe(200) // different bucket, not blocked
        const aAgain = await app.request('/x', { headers: { 'x-forwarded-for': '1.1.1.1' } })
        expect(aAgain.status).toBe(429)
    })

    it('fails OPEN when the store is unavailable (edge: availability)', async () => {
        const store: RateLimitStore = {
            async hit() {
                throw new Error('redis down')
            },
        }
        const app = appWith(store, 1)
        // Even past the limit, a store outage must not block traffic.
        expect((await app.request('/x')).status).toBe(200)
        expect((await app.request('/x')).status).toBe(200)
    })
})
