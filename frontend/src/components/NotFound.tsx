import { Link } from '@tanstack/react-router'
import { Empty, EmptyDescription, EmptyHeader, EmptyTitle } from '@/components/ui/empty'

/** App-level 404 — the router's `defaultNotFoundComponent` for unknown URLs. */
export function NotFound() {
    return (
        <main className="mx-auto w-full max-w-[1100px] px-6 py-10">
            <Empty>
                <EmptyHeader>
                    <EmptyTitle>Page not found</EmptyTitle>
                    <EmptyDescription>
                        That page doesn’t exist. <Link to="/">Back to discovery</Link>.
                    </EmptyDescription>
                </EmptyHeader>
            </Empty>
        </main>
    )
}
