import { useState } from 'react'
import { SignInSchema, SignUpSchema, type SignInValues, type SignUpValues } from '../lib/auth'

type AuthMode = 'signin' | 'signup'

interface AuthFormProps {
    mode: AuthMode
    // Resolves on success (the route then redirects); rejects with an Error
    // whose message is shown inline.
    onSubmit: (values: SignInValues | SignUpValues) => Promise<void>
}

/**
 * Sign-in / sign-up form. Self-contained: holds field state, validates with the
 * shared Zod schemas, surfaces per-field and server errors, and disables itself
 * while submitting. Navigation after success is the route's responsibility.
 */
export function AuthForm({ mode, onSubmit }: AuthFormProps) {
    const isSignup = mode === 'signup'
    const [name, setName] = useState('')
    const [email, setEmail] = useState('')
    const [password, setPassword] = useState('')
    const [errors, setErrors] = useState<Record<string, string>>({})
    const [formError, setFormError] = useState<string | null>(null)
    const [pending, setPending] = useState(false)

    async function handleSubmit(e: React.FormEvent) {
        e.preventDefault()
        setFormError(null)

        const schema = isSignup ? SignUpSchema : SignInSchema
        const candidate = isSignup ? { name, email, password } : { email, password }
        const result = schema.safeParse(candidate)

        if (!result.success) {
            const fieldErrors: Record<string, string> = {}
            for (const issue of result.error.issues) {
                const key = issue.path[0]
                if (typeof key === 'string' && !fieldErrors[key]) fieldErrors[key] = issue.message
            }
            setErrors(fieldErrors)
            return
        }

        setErrors({})
        setPending(true)
        try {
            await onSubmit(result.data)
        } catch (err) {
            setFormError(err instanceof Error ? err.message : 'Something went wrong. Try again.')
        } finally {
            setPending(false)
        }
    }

    return (
        <form className="authform" onSubmit={handleSubmit} noValidate>
            {isSignup && (
                <Field
                    label="Name"
                    name="name"
                    type="text"
                    autoComplete="name"
                    value={name}
                    onChange={setName}
                    error={errors.name}
                />
            )}
            <Field
                label="Email"
                name="email"
                type="email"
                autoComplete="email"
                value={email}
                onChange={setEmail}
                error={errors.email}
            />
            <Field
                label="Password"
                name="password"
                type="password"
                autoComplete={isSignup ? 'new-password' : 'current-password'}
                value={password}
                onChange={setPassword}
                error={errors.password}
            />

            {formError && (
                <p className="authform__error" role="alert">
                    {formError}
                </p>
            )}

            <button type="submit" className="authform__submit" disabled={pending}>
                {pending
                    ? isSignup
                        ? 'Creating account…'
                        : 'Signing in…'
                    : isSignup
                      ? 'Create account'
                      : 'Sign in'}
            </button>
        </form>
    )
}

interface FieldProps {
    label: string
    name: string
    type: string
    autoComplete: string
    value: string
    onChange: (value: string) => void
    error?: string
}

function Field({ label, name, type, autoComplete, value, onChange, error }: FieldProps) {
    const errorId = `${name}-error`
    return (
        <div className="authform__field">
            <label className="authform__label" htmlFor={name}>
                {label}
            </label>
            <input
                id={name}
                name={name}
                type={type}
                autoComplete={autoComplete}
                className="authform__input"
                value={value}
                onChange={(e) => onChange(e.target.value)}
                aria-invalid={error ? true : undefined}
                aria-describedby={error ? errorId : undefined}
            />
            {error && (
                <p id={errorId} className="authform__field-error" role="alert">
                    {error}
                </p>
            )}
        </div>
    )
}
