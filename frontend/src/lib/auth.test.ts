import { afterEach, describe, expect, it, vi } from 'vitest'
import { getSession, signIn, SignInSchema, signOut, signUp, SignUpSchema } from './auth'

function mockFetch(impl: (url: string, init?: RequestInit) => Response | Promise<Response>) {
    const spy = vi.fn(impl)
    vi.stubGlobal('fetch', spy)
    return spy
}

function jsonResponse(body: unknown, status = 200) {
    return new Response(body === null ? 'null' : JSON.stringify(body), {
        status,
        headers: { 'Content-Type': 'application/json' },
    })
}

afterEach(() => {
    vi.unstubAllGlobals()
})

describe('getSession', () => {
    // ── Feature / happy path ──────────────────────────────────────────────
    it('returns the user when a session exists', async () => {
        mockFetch(() => jsonResponse({ user: { id: 'u1', email: 'a@b.com', name: 'Ana' } }))
        await expect(getSession()).resolves.toEqual({ id: 'u1', email: 'a@b.com', name: 'Ana' })
    })

    // ── Edge cases ────────────────────────────────────────────────────────
    it('returns null when BetterAuth responds with a null body (signed out)', async () => {
        mockFetch(() => jsonResponse(null))
        await expect(getSession()).resolves.toBeNull()
    })

    it('returns null (not an error) on a 401', async () => {
        mockFetch(() => jsonResponse({ message: 'Unauthorized' }, 401))
        await expect(getSession()).resolves.toBeNull()
    })

    it('returns null when the payload has no user', async () => {
        mockFetch(() => jsonResponse({ session: { id: 's1' } }))
        await expect(getSession()).resolves.toBeNull()
    })
})

describe('auth mutations', () => {
    it('signIn posts credentials to the email sign-in endpoint', async () => {
        const spy = mockFetch(() => jsonResponse({ token: 't', user: { id: 'u1' } }))
        await signIn({ email: 'a@b.com', password: 'secret123' })
        expect(spy.mock.calls[0]![0]).toContain('/api/auth/sign-in/email')
        expect(spy.mock.calls[0]![1]?.method).toBe('POST')
    })

    it('signUp posts to the email sign-up endpoint', async () => {
        const spy = mockFetch(() => jsonResponse({ token: 't', user: { id: 'u1' } }))
        await signUp({ name: 'Ana', email: 'a@b.com', password: 'secret123' })
        expect(spy.mock.calls[0]![0]).toContain('/api/auth/sign-up/email')
    })

    it('signOut posts to the sign-out endpoint', async () => {
        const spy = mockFetch(() => jsonResponse({ success: true }))
        await signOut()
        expect(spy.mock.calls[0]![0]).toContain('/api/auth/sign-out')
    })

    it('surfaces the BetterAuth error message on a bad sign-in', async () => {
        mockFetch(() => jsonResponse({ message: 'Invalid email or password' }, 401))
        await expect(signIn({ email: 'a@b.com', password: 'wrong' })).rejects.toMatchObject({
            message: 'Invalid email or password',
            status: 401,
        })
    })
})

describe('auth form schemas', () => {
    it('rejects a malformed email and an empty password', () => {
        const r = SignInSchema.safeParse({ email: 'not-an-email', password: '' })
        expect(r.success).toBe(false)
    })

    it('requires an 8+ character password on sign-up', () => {
        const short = SignUpSchema.safeParse({ name: 'A', email: 'a@b.com', password: 'short' })
        expect(short.success).toBe(false)
        const ok = SignUpSchema.safeParse({ name: 'A', email: 'a@b.com', password: 'longenough' })
        expect(ok.success).toBe(true)
    })
})
