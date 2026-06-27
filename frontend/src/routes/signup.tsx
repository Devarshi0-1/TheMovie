import { useQueryClient } from '@tanstack/react-query'
import { createFileRoute, Link, useNavigate } from '@tanstack/react-router'
import { z } from 'zod'
import { AuthForm } from '../components/AuthForm'
import {
    redirectIfAuthenticated,
    sessionQueryKey,
    SignUpSchema,
    signUp,
    type SignInValues,
    type SignUpValues,
} from '../lib/auth'
import { safeRedirect } from '../lib/redirect'

const searchSchema = z.object({ redirect: z.string().optional() })

export const Route = createFileRoute('/signup')({
    validateSearch: searchSchema,
    beforeLoad: ({ context, search }) =>
        redirectIfAuthenticated(context.queryClient, safeRedirect(search.redirect)),
    component: SignUp,
})

function SignUp() {
    const { redirect } = Route.useSearch()
    const dest = safeRedirect(redirect)
    const navigate = useNavigate()
    const queryClient = useQueryClient()

    async function handleSubmit(values: SignInValues | SignUpValues) {
        // requireEmailVerification is off, so sign-up signs the user in. The form
        // ran in sign-up mode, so `values` carries `name`; re-validate to narrow.
        await signUp(SignUpSchema.parse(values))
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
