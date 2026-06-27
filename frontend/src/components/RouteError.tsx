import { Link, type ErrorComponentProps } from '@tanstack/react-router'
import { Alert } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { Empty, EmptyContent, EmptyHeader, EmptyTitle } from '@/components/ui/empty'

/** App-level error screen — the router's `defaultErrorComponent`. */
export function RouteError({ error }: ErrorComponentProps) {
    const message = error instanceof Error ? error.message : 'Something went wrong.'
    return (
        <main className="mx-auto w-full max-w-[1100px] px-6 py-10">
            <Empty>
                <EmptyHeader>
                    <EmptyTitle>Something went wrong</EmptyTitle>
                </EmptyHeader>
                <EmptyContent>
                    <Alert variant="destructive" role="alert">
                        {message}
                    </Alert>
                    <Button asChild variant="link">
                        <Link to="/">Back to discovery</Link>
                    </Button>
                </EmptyContent>
            </Empty>
        </main>
    )
}
