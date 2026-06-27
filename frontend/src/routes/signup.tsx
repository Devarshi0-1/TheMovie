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
        <main className="mx-auto grid min-h-[70vh] w-full max-w-[1100px] place-items-center px-6 py-10">
            <div className="w-full max-w-[400px] rounded-xl border border-border bg-card p-8">
                <h1 className="text-2xl font-semibold tracking-tight">Create your account</h1>
                <p className="mt-1.5 mb-6 text-sm text-muted-foreground">
                    Save films, build a watchlist, and get recommendations.
                </p>
                <AuthForm mode="signup" onSubmit={handleSubmit} />
                <p className="mt-5 text-center text-sm text-muted-foreground">
                    Already have an account?{' '}
                    <Link to="/signin" className="text-primary underline-offset-4 hover:underline">
                        Sign in
                    </Link>
                </p>
            </div>
        </main>
    )
}
