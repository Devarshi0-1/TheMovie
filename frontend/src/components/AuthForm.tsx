import { useForm, type AnyFieldApi } from '@tanstack/react-form'
import { useState } from 'react'
import { z } from 'zod'
import { Alert } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { Field, FieldError, FieldGroup, FieldLabel } from '@/components/ui/field'
import { Input } from '@/components/ui/input'
import { SignInSchema, SignUpSchema, type SignInValues, type SignUpValues } from '../lib/auth'

type AuthMode = 'signin' | 'signup'

interface AuthFormProps {
    mode: AuthMode
    // Resolves on success (the route then redirects); rejects with an Error
    // whose message is shown inline.
    onSubmit: (values: SignInValues | SignUpValues) => Promise<void>
}

/**
 * Sign-in / sign-up form built on TanStack Form + the shared Zod schemas. Fields
 * validate `onChange`, so per-field errors appear as the user types and clear as
 * soon as the input becomes valid. A rejected submission surfaces as an inline
 * form error. Navigation after success is the route's responsibility.
 */
export function AuthForm({ mode, onSubmit }: AuthFormProps) {
    const isSignup = mode === 'signup'
    // The form value always carries `name`. We validate sign-in against a schema
    // that includes an always-valid `name` (so the value shape matches), but
    // shape the SUBMITTED value with the strict schema, which strips `name`.
    const validationSchema = isSignup ? SignUpSchema : SignInSchema.extend({ name: z.string() })
    const outputSchema = isSignup ? SignUpSchema : SignInSchema
    const [formError, setFormError] = useState<string | null>(null)

    const form = useForm({
        defaultValues: { name: '', email: '', password: '' },
        validators: { onChange: validationSchema },
        onSubmit: async ({ value }) => {
            setFormError(null)
            // Strict schema → the callback gets exactly the right shape, no cast.
            const values = outputSchema.parse(value)
            try {
                await onSubmit(values)
            } catch (err) {
                setFormError(
                    err instanceof Error ? err.message : 'Something went wrong. Try again.',
                )
            }
        },
    })

    return (
        <form
            noValidate
            onSubmit={(e) => {
                e.preventDefault()
                e.stopPropagation()
                void form.handleSubmit()
            }}
        >
            <FieldGroup>
                {isSignup && (
                    <form.Field name="name">
                        {(field) => (
                            <AuthField field={field} label="Name" type="text" autoComplete="name" />
                        )}
                    </form.Field>
                )}
                <form.Field name="email">
                    {(field) => (
                        <AuthField field={field} label="Email" type="email" autoComplete="email" />
                    )}
                </form.Field>
                <form.Field name="password">
                    {(field) => (
                        <AuthField
                            field={field}
                            label="Password"
                            type="password"
                            autoComplete={isSignup ? 'new-password' : 'current-password'}
                        />
                    )}
                </form.Field>

                {formError && (
                    <Alert variant="destructive" role="alert">
                        {formError}
                    </Alert>
                )}

                <form.Subscribe selector={(s) => s.isSubmitting}>
                    {(isSubmitting) => (
                        <Button type="submit" className="w-full" disabled={isSubmitting}>
                            {isSubmitting
                                ? isSignup
                                    ? 'Creating account…'
                                    : 'Signing in…'
                                : isSignup
                                  ? 'Create account'
                                  : 'Sign in'}
                        </Button>
                    )}
                </form.Subscribe>
            </FieldGroup>
        </form>
    )
}

interface FieldProps {
    field: AnyFieldApi
    label: string
    type: string
    autoComplete: string
}

/** One labelled input wired to a TanStack Form field, with its validation error. */
function AuthField({ field, label, type, autoComplete }: FieldProps) {
    const firstError = field.state.meta.errors[0]
    const message: string | undefined = !firstError
        ? undefined
        : typeof firstError === 'string'
          ? firstError
          : firstError.message
    const errorId = `${field.name}-error`

    return (
        <Field data-invalid={message ? true : undefined}>
            <FieldLabel htmlFor={field.name}>{label}</FieldLabel>
            <Input
                id={field.name}
                name={field.name}
                type={type}
                autoComplete={autoComplete}
                value={field.state.value}
                onChange={(e) => field.handleChange(e.target.value)}
                onBlur={field.handleBlur}
                aria-invalid={message ? true : undefined}
                aria-describedby={message ? errorId : undefined}
            />
            {message && <FieldError id={errorId}>{message}</FieldError>}
        </Field>
    )
}
