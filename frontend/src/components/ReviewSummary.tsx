import type { ReviewSummary as ReviewSummaryData } from '@themovie/schemas'
import { Badge } from '@/components/ui/badge'
import { Skeleton } from '@/components/ui/skeleton'

/**
 * Renders the spoiler-free AI summary of a movie's audience reviews
 * (`GET /api/v1/movies/:id/summary`). Pure presentational: the route owns
 * loading/error. The no-reviews case arrives as a vibe line with empty
 * pros/cons, so the columns simply collapse.
 */
export function ReviewSummary({ summary }: { summary: ReviewSummaryData }) {
    const { vibe, pros, cons } = summary
    const hasDetail = pros.length > 0 || cons.length > 0

    return (
        <section
            className="max-w-[720px] rounded-2xl border border-border bg-card p-6"
            aria-label="Spoiler-free review summary"
        >
            <div className="mb-3 flex items-center gap-3">
                <h2 className="text-lg font-semibold">What audiences say</h2>
                <Badge variant="secondary">AI · spoiler-free</Badge>
            </div>
            <p className="mb-5 text-base leading-relaxed">{vibe}</p>

            {hasDetail && (
                <div className="grid grid-cols-1 gap-6 sm:grid-cols-2">
                    {pros.length > 0 && (
                        <div>
                            <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-pro">
                                Loved
                            </h3>
                            <ul className="list-disc pl-5 text-sm leading-relaxed text-muted-foreground">
                                {pros.map((pro) => (
                                    <li key={pro}>{pro}</li>
                                ))}
                            </ul>
                        </div>
                    )}
                    {cons.length > 0 && (
                        <div>
                            <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-con">
                                Critiqued
                            </h3>
                            <ul className="list-disc pl-5 text-sm leading-relaxed text-muted-foreground">
                                {cons.map((con) => (
                                    <li key={con}>{con}</li>
                                ))}
                            </ul>
                        </div>
                    )}
                </div>
            )}
        </section>
    )
}

const PRO_KEYS = ['p0', 'p1']
const CON_KEYS = ['c0', 'c1']

/**
 * Loading placeholder for {@link ReviewSummary}, matching its card shape so the
 * detail page doesn't shift when the AI summary streams in (web.dev CLS). Built
 * on the shadcn `Skeleton`.
 */
export function ReviewSummarySkeleton() {
    return (
        <section
            className="max-w-[720px] rounded-2xl border border-border bg-card p-6"
            aria-busy="true"
            aria-label="Summarizing audience reviews"
        >
            <div className="mb-3 flex items-center gap-3">
                <Skeleton className="h-6 w-44" />
                <Skeleton className="h-5 w-28 rounded-full" />
            </div>
            <Skeleton className="mb-2 h-5 w-full" />
            <Skeleton className="mb-5 h-5 w-2/3" />
            <div className="grid grid-cols-1 gap-6 sm:grid-cols-2">
                <div className="flex flex-col gap-2">
                    <Skeleton className="h-3 w-16" />
                    {PRO_KEYS.map((key) => (
                        <Skeleton key={key} className="h-4 w-5/6" />
                    ))}
                </div>
                <div className="flex flex-col gap-2">
                    <Skeleton className="h-3 w-16" />
                    {CON_KEYS.map((key) => (
                        <Skeleton key={key} className="h-4 w-4/6" />
                    ))}
                </div>
            </div>
        </section>
    )
}
