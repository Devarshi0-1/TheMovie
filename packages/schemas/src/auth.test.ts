import { describe, expect, it } from 'bun:test'
import {
    GetSessionResponseSchema,
    PASSWORD_MIN_LENGTH,
    SignInSchema,
    SignUpSchema,
} from './auth'

describe('SignInSchema', () => {
    it('parses valid credentials (feature)', () => {
        const parsed = SignInSchema.parse({ email: 'a@b.com', password: 'secret123' })
        expect(parsed.email).toBe('a@b.com')
    })

    it('rejects an invalid email and an empty password (edge)', () => {
        expect(() => SignInSchema.parse({ email: 'nope', password: 'x' })).toThrow(
            'Enter a valid email address',
        )
        expect(() => SignInSchema.parse({ email: 'a@b.com', password: '' })).toThrow(
            'Password is required',
        )
    })
})

describe('SignUpSchema', () => {
    it('parses a valid sign-up (feature)', () => {
        const parsed = SignUpSchema.parse({ name: 'Ana', email: 'a@b.com', password: 'secret123' })
        expect(parsed.name).toBe('Ana')
    })

    it(`enforces the ${PASSWORD_MIN_LENGTH}-character password minimum and a name (edge)`, () => {
        expect(() =>
            SignUpSchema.parse({ name: 'Ana', email: 'a@b.com', password: 'short' }),
        ).toThrow(`Password must be at least ${PASSWORD_MIN_LENGTH} characters`)
        expect(() =>
            SignUpSchema.parse({ name: '', email: 'a@b.com', password: 'secret123' }),
        ).toThrow('Name is required')
    })
})

describe('GetSessionResponseSchema', () => {
    it('parses an authed response and a signed-out null (feature/edge)', () => {
        const authed = GetSessionResponseSchema.parse({ user: { id: 'u1', email: 'a@b.com' } })
        expect(authed?.user?.id).toBe('u1')
        expect(GetSessionResponseSchema.parse(null)).toBeNull()
    })
})
