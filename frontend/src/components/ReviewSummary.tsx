import type { ReviewSummary as ReviewSummaryData } from '@themovie/schemas'

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
        <section className="summary" aria-label="Spoiler-free review summary">
            <div className="summary__head">
                <h2 className="summary__title">What audiences say</h2>
                <span className="summary__badge">AI · spoiler-free</span>
            </div>
            <p className="summary__vibe">{vibe}</p>

            {hasDetail && (
                <div className="summary__cols">
                    {pros.length > 0 && (
                        <div className="summary__col">
                            <h3 className="summary__col-title summary__col-title--pro">Loved</h3>
                            <ul className="summary__list">
                                {pros.map((pro) => (
                                    <li key={pro}>{pro}</li>
                                ))}
                            </ul>
                        </div>
                    )}
                    {cons.length > 0 && (
                        <div className="summary__col">
                            <h3 className="summary__col-title summary__col-title--con">
                                Critiqued
                            </h3>
                            <ul className="summary__list">
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
