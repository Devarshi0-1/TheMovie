import { describe, expect, it } from 'bun:test'
import { app } from './app'

// These assert the /health contract and are deterministic whether or not
// Postgres/Redis are actually reachable: the handler catches connection
// failures and reports each dependency as 'down' rather than throwing.
describe('GET /health', () => {
    it('returns a well-formed payload (feature: shape + value domains)', async () => {
        const res = await app.request('/health')
        const body = (await res.json()) as {
            status: string
            checks: { db: string; redis: string }
        }

        expect(['ok', 'degraded']).toContain(body.status)
        expect(['up', 'down']).toContain(body.checks.db)
        expect(['up', 'down']).toContain(body.checks.redis)
    })

    it('status code and status field agree (edge: degraded ⇒ 503)', async () => {
        const res = await app.request('/health')
        const body = (await res.json()) as {
            status: string
            checks: { db: string; redis: string }
        }

        const bothUp = body.checks.db === 'up' && body.checks.redis === 'up'
        expect(body.status).toBe(bothUp ? 'ok' : 'degraded')
        expect(res.status).toBe(bothUp ? 200 : 503)
    })

    it('reports each dependency independently (edge: partial failure is representable)', async () => {
        const res = await app.request('/health')
        const body = (await res.json()) as { checks: { db: string; redis: string } }

        // db and redis are checked in isolation, so the payload must always
        // carry both keys even when one is down.
        expect(Object.keys(body.checks).sort()).toEqual(['db', 'redis'])
    })
})

describe('GET /ping', () => {
    it('liveness probe returns pong', async () => {
        const res = await app.request('/ping')
        expect(res.status).toBe(200)
        expect(await res.text()).toBe('pong')
    })

    it('applies secure headers to responses (feature: Phase 6 hardening)', async () => {
        const res = await app.request('/ping')
        // secureHeaders sets nosniff + frame protection on every response.
        expect(res.headers.get('x-content-type-options')).toBe('nosniff')
        expect(res.headers.get('x-frame-options')).toBe('SAMEORIGIN')
    })
})
