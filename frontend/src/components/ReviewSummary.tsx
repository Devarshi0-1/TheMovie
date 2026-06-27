import type { ReviewSummary as ReviewSummaryData } from '@themovie/schemas'
import { Badge } from '@/components/ui/badge'

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
