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
        <main className="mx-auto grid min-h-[70vh] w-full max-w-[1100px] place-items-center px-6 py-10">
            <div className="w-full max-w-[400px] rounded-xl border border-border bg-card p-8">
                <h1 className="text-2xl font-semibold tracking-tight">Welcome back</h1>
                <p className="mt-1.5 mb-6 text-sm text-muted-foreground">
                    Sign in to save films and manage your watchlist.
                </p>
                <AuthForm mode="signin" onSubmit={handleSubmit} />
                <p className="mt-5 text-center text-sm text-muted-foreground">
                    New to TheMovie?{' '}
                    <Link to="/signup" className="text-primary underline-offset-4 hover:underline">
                        Create an account
                    </Link>
                </p>
            </div>
        </main>
    )
}
