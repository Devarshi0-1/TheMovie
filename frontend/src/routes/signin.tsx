import { useQueryClient } from '@tanstack/react-query'
import { createFileRoute, Link, useNavigate } from '@tanstack/react-router'
import { z } from 'zod'
import { AuthForm } from '../components/AuthForm'
import {
    redirectIfAuthenticated,
    sessionQueryKey,
    signIn,
    type SignInValues,
    type SignUpValues,
} from '../lib/auth'
import { safeRedirect } from '../lib/redirect'

const searchSchema = z.object({ redirect: z.string().optional() })

export const Route = createFileRoute('/signin')({
    validateSearch: searchSchema,
    // Already signed in → don't sit on the auth screen (bounce before render).
    beforeLoad: ({ context, search }) =>
        redirectIfAuthenticated(context.queryClient, safeRedirect(search.redirect)),
    component: SignIn,
})

function SignIn() {
    const { redirect } = Route.useSearch()
    const dest = safeRedirect(redirect)
    const navigate = useNavigate()
    const queryClient = useQueryClient()

    async function handleSubmit(values: SignInValues | SignUpValues) {
        // Both modes carry email + password; sign-in needs only those.
        await signIn({ email: values.email, password: values.password })
        await queryClient.invalidateQueries({ queryKey: sessionQueryKey })
        void navigate({ to: dest })
    }

    return (
        <main className="page auth">
            <div className="auth__card">
                <h1 className="auth__title">Welcome back</h1>
                <p className="auth__sub">Sign in to save films and manage your watchlist.</p>
                <AuthForm mode="signin" onSubmit={handleSubmit} />
                <p className="auth__alt">
                    New to TheMovie? <Link to="/signup">Create an account</Link>
                </p>
            </div>
        </main>
    )
}
