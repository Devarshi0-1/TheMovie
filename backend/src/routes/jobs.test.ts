import { afterEach, beforeEach, describe, expect, it } from 'bun:test'
import { createJobsRoute } from './jobs'
import type { RefreshOutcome } from '../jobs/scheduler'

const SECRET = 'test-secret-abc123'
const STATS = { due: 1, regenerated: 1, skippedUnchanged: 0, noReviews: 0, failed: 0 }

// Build a route with an injected trigger so the auth gate is tested without
// touching Redis / OpenAI / the DB. Records whether the trigger actually ran.
const make = (outcome: RefreshOutcome = { status: 'ran', stats: STATS }) => {
    let triggered = 0
    const route = createJobsRoute(async () => {
        triggered++
        return outcome
    })
    const post = (headers: Record<string, string> = {}) =>
        route.request('/refresh-summaries', { method: 'POST', headers })
    return { post, triggered: () => triggered }
}

const original = process.env.JOB_TRIGGER_SECRET
beforeEach(() => {
    process.env.JOB_TRIGGER_SECRET = SECRET
})
afterEach(() => {
    if (original === undefined) delete process.env.JOB_TRIGGER_SECRET
    else process.env.JOB_TRIGGER_SECRET = original
})

describe('POST /jobs/refresh-summaries', () => {
    it('runs the job and returns stats with a valid X-Job-Secret (feature)', async () => {
        const { post, triggered } = make()
        const res = await post({ 'X-Job-Secret': SECRET })
        expect(res.status).toBe(200)
        expect(await res.json()).toEqual({ status: 'ran', stats: STATS })
        expect(triggered()).toBe(1)
    })

    it('accepts the secret as an Authorization: Bearer token too (feature)', async () => {
        const { post, triggered } = make()
        const res = await post({ Authorization: `Bearer ${SECRET}` })
        expect(res.status).toBe(200)
        expect(triggered()).toBe(1)
    })

    it('rejects a missing secret with 401 and never runs the job (edge: auth)', async () => {
        const { post, triggered } = make()
        const res = await post()
        expect(res.status).toBe(401)
        expect(triggered()).toBe(0)
    })

    it('rejects a wrong secret with 401 (edge: auth)', async () => {
        const { post, triggered } = make()
        const res = await post({ 'X-Job-Secret': 'nope' })
        expect(res.status).toBe(401)
        expect(triggered()).toBe(0)
    })

    it('is 404 (disabled) when JOB_TRIGGER_SECRET is not configured (edge: off by default)', async () => {
        delete process.env.JOB_TRIGGER_SECRET
        const { post, triggered } = make()
        const res = await post({ 'X-Job-Secret': SECRET })
        expect(res.status).toBe(404)
        expect(triggered()).toBe(0)
    })

    it('returns 200 with skipped when another run holds the lock (feature: single-flight)', async () => {
        const { post } = make({ status: 'skipped' })
        const res = await post({ 'X-Job-Secret': SECRET })
        expect(res.status).toBe(200)
        expect(await res.json()).toEqual({ status: 'skipped' })
    })

    it('surfaces a failed run as 500 (edge)', async () => {
        const { post } = make({ status: 'failed', error: 'boom' })
        const res = await post({ 'X-Job-Secret': SECRET })
        expect(res.status).toBe(500)
        expect(await res.json()).toEqual({ status: 'failed', error: 'boom' })
    })
})
