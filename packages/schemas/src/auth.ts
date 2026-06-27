import { z } from 'zod'

// Shared auth schemas — one definition for the BetterAuth session/credential
// contracts, consumed by the frontend (client-side form validation + session
// parsing) and available to the backend. Mirrors the BetterAuth API shapes.

/** Minimum password length — mirrors the backend BetterAuth `minPasswordLength`. */
export const PASSWORD_MIN_LENGTH = 8

/** The authenticated user shape returned by BetterAuth's get-session. */
export const SessionUserSchema = z.object({
    id: z.string(),
    email: z.string(),
    name: z.string().nullish(),
})
export type SessionUser = z.infer<typeof SessionUserSchema>

/**
 * BetterAuth's get-session returns `{ session, user }` when authed and `null`
 * (HTTP 200) when not. We only need `user`.
 */
export const GetSessionResponseSchema = z.object({ user: SessionUserSchema.nullish() }).nullable()
export type GetSessionResponse = z.infer<typeof GetSessionResponseSchema>

/** Sign-in credentials. Client-side validation only; BetterAuth re-validates. */
export const SignInSchema = z.object({
    email: z.string().min(1, 'Email is required').email('Enter a valid email address'),
    password: z.string().min(1, 'Password is required'),
})
export type SignInValues = z.infer<typeof SignInSchema>

/** Sign-up credentials. Password minimum mirrors the backend. */
export const SignUpSchema = z.object({
    name: z.string().min(1, 'Name is required'),
    email: z.string().min(1, 'Email is required').email('Enter a valid email address'),
    password: z
        .string()
        .min(PASSWORD_MIN_LENGTH, `Password must be at least ${PASSWORD_MIN_LENGTH} characters`),
})
export type SignUpValues = z.infer<typeof SignUpSchema>
