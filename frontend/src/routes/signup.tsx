import { useQueryClient } from '@tanstack/react-query'
import { createFileRoute, Link, useNavigate } from '@tanstack/react-router'
import { useEffect } from 'react'
import { z } from 'zod'
import { AuthForm } from '../components/AuthForm'
import {
    sessionQueryKey,
    signUp,
    useSession,
    type SignInValues,
    type SignUpValues,
} from '../lib/auth'
import { safeRedirect } from '../lib/redirect'

const searchSchema = z.object({ redirect: z.string().optional() })

export const Route = createFileRoute('/signup')({
    validateSearch: searchSchema,
    component: SignUp,
})

function SignUp() {
    const { redirect } = Route.useSearch()
    const dest = safeRedirect(redirect)
    const navigate = useNavigate()
    const queryClient = useQueryClient()
    const { data: user } = useSession()

    useEffect(() => {
        if (user) void navigate({ to: dest })
    }, [user, dest, navigate])

    async function handleSubmit(values: SignInValues | SignUpValues) {
        // requireEmailVerification is off, so sign-up signs the user in.
        await signUp(values as SignUpValues)
        await queryClient.invalidateQueries({ queryKey: sessionQueryKey })
        void navigate({ to: dest })
    }

    return (
        <main className="page auth">
            <div className="auth__card">
                <h1 className="auth__title">Create your account</h1>
                <p className="auth__sub">Save films, build a watchlist, and get recommendations.</p>
                <AuthForm mode="signup" onSubmit={handleSubmit} />
                <p className="auth__alt">
                    Already have an account? <Link to="/signin">Sign in</Link>
                </p>
            </div>
        </main>
    )
}
