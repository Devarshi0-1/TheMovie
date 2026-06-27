import type {
    CastMember,
    MovieExtras as MovieExtrasData,
    MovieResult,
    MovieVideo,
    WatchProviders,
} from '@themovie/schemas'
import { Badge } from '@/components/ui/badge'
import { Skeleton } from '@/components/ui/skeleton'
import { MovieCardLink } from './MovieCardLink'
import { TMDB_LOGO_BASE, TMDB_PROFILE_BASE } from '../lib/tmdb'

// Detail-screen enrichment built from `GET /api/v1/movies/:id/extras`: trailer,
// top-billed cast + director, where-to-watch, and "more like this". Pure
// presentational — the route owns loading/error. Each section self-omits when it
// has nothing to show, so a sparse movie simply renders fewer blocks.

function Trailer({ trailer }: { trailer: MovieVideo }) {
    return (
        <section aria-label="Trailer">
            <h2 className="mb-3 text-lg font-semibold">Trailer</h2>
            {/* aspect-video reserves the 16:9 box up front so the iframe doesn't shift layout (CLS). */}
            <div className="aspect-video w-full max-w-[720px] overflow-hidden rounded-2xl border border-border bg-muted">
                {/* A privacy-mode YouTube player needs both allow-scripts and allow-same-origin
                    to run; the source is trusted (youtube-nocookie.com), so the combo is intended. */}
                {/* oxlint-disable react/iframe-missing-sandbox */}
                <iframe
                    src={`https://www.youtube-nocookie.com/embed/${trailer.key}`}
                    title={trailer.name}
                    loading="lazy"
                    allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
                    allowFullScreen
                    sandbox="allow-scripts allow-same-origin allow-presentation allow-popups"
                    className="h-full w-full"
                />
                {/* oxlint-enable react/iframe-missing-sandbox */}
            </div>
        </section>
    )
}

function CastStrip({ cast, director }: { cast: CastMember[]; director: string | null }) {
    if (cast.length === 0 && !director) return null

    return (
        <section aria-label="Cast">
            <div className="mb-3 flex flex-wrap items-baseline gap-x-3 gap-y-1">
                <h2 className="text-lg font-semibold">Cast</h2>
                {director && (
                    <p className="text-sm text-muted-foreground">
                        Directed by <span className="text-foreground">{director}</span>
                    </p>
                )}
            </div>
            {cast.length > 0 && (
                <ul className="flex list-none gap-4 overflow-x-auto p-0 pb-2">
                    {cast.map((member) => (
                        <li key={member.id} className="w-[110px] shrink-0">
                            <div className="aspect-[2/3] overflow-hidden rounded-xl border border-border bg-muted">
                                {member.profilePath ? (
                                    <img
                                        src={`${TMDB_PROFILE_BASE}${member.profilePath}`}
                                        alt={member.name}
                                        loading="lazy"
                                        width={185}
                                        height={278}
                                        className="h-full w-full object-cover"
                                    />
                                ) : (
                                    <div
                                        className="grid h-full w-full place-items-center text-3xl opacity-40"
                                        aria-hidden="true"
                                    >
                                        👤
                                    </div>
                                )}
                            </div>
                            <p className="mt-1.5 text-sm leading-tight">{member.name}</p>
                            {member.character && (
                                <p className="text-xs leading-tight text-muted-foreground">
                                    {member.character}
                                </p>
                            )}
                        </li>
                    ))}
                </ul>
            )}
        </section>
    )
}

function ProviderRow({ label, providers }: { label: string; providers: WatchProviders['rent'] }) {
    if (providers.length === 0) return null
    return (
        <div className="flex flex-wrap items-center gap-2">
            <span className="w-14 shrink-0 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                {label}
            </span>
            {providers.map((p) => (
                <span key={p.id} className="inline-flex items-center" title={p.name}>
                    {p.logoPath ? (
                        <img
                            src={`${TMDB_LOGO_BASE}${p.logoPath}`}
                            alt={p.name}
                            loading="lazy"
                            width={36}
                            height={36}
                            className="size-9 rounded-lg border border-border object-cover"
                        />
                    ) : (
                        <Badge variant="secondary">{p.name}</Badge>
                    )}
                </span>
            ))}
        </div>
    )
}

function WhereToWatch({ providers }: { providers: WatchProviders }) {
    return (
        <section aria-label="Where to watch">
            <div className="mb-3 flex items-center gap-3">
                <h2 className="text-lg font-semibold">Where to watch</h2>
                <Badge variant="secondary">{providers.region}</Badge>
            </div>
            <div className="flex flex-col gap-3">
                <ProviderRow label="Stream" providers={providers.flatrate} />
                <ProviderRow label="Rent" providers={providers.rent} />
                <ProviderRow label="Buy" providers={providers.buy} />
            </div>
            {providers.link && (
                <a
                    href={providers.link}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="mt-3 inline-block text-sm text-muted-foreground underline-offset-4 hover:text-foreground hover:underline"
                >
                    More options on JustWatch →
                </a>
            )}
            <p className="mt-2 text-xs text-muted-foreground">Streaming data by JustWatch.</p>
        </section>
    )
}

/** The "more like this" rail — recommendations as navigable poster cards. */
export function MoreLikeThis({ movies }: { movies: MovieResult[] }) {
    if (movies.length === 0) return null
    return (
        <section aria-label="More like this">
            <h2 className="mb-4 text-lg font-semibold">More like this</h2>
            <ul className="grid list-none grid-cols-2 gap-4 p-0 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6">
                {movies.map((movie) => (
                    <li key={movie.tmdbId}>
                        <MovieCardLink movie={movie} />
                    </li>
                ))}
            </ul>
        </section>
    )
}

/**
 * Trailer + cast + where-to-watch for the detail screen. (Recommendations render
 * separately via {@link MoreLikeThis} so they sit at the bottom of the page,
 * after the review summary.) Returns null when there's nothing to show.
 */
export function MovieExtras({ extras }: { extras: MovieExtrasData }) {
    const hasContent =
        extras.trailer ||
        extras.cast.length > 0 ||
        extras.director ||
        extras.watchProviders !== null

    if (!hasContent) return null

    return (
        <div className="flex flex-col gap-10">
            {extras.trailer && <Trailer trailer={extras.trailer} />}
            <CastStrip cast={extras.cast} director={extras.director} />
            {extras.watchProviders && <WhereToWatch providers={extras.watchProviders} />}
        </div>
    )
}

const CAST_KEYS = ['c0', 'c1', 'c2', 'c3', 'c4', 'c5']

/**
 * Loading placeholder for {@link MovieExtras}, mirroring the trailer + cast-strip
 * layout so the page doesn't shift when the data arrives (web.dev CLS).
 */
export function MovieExtrasSkeleton() {
    return (
        <div
            className="flex flex-col gap-10"
            aria-busy="true"
            aria-label="Loading cast and trailer"
        >
            <div>
                <Skeleton className="mb-3 h-6 w-28" />
                <Skeleton className="aspect-video w-full max-w-[720px] rounded-2xl" />
            </div>
            <div>
                <Skeleton className="mb-3 h-6 w-20" />
                <div className="flex gap-4 overflow-hidden">
                    {CAST_KEYS.map((key) => (
                        <div key={key} className="w-[110px] shrink-0">
                            <Skeleton className="aspect-[2/3] w-full rounded-xl" />
                            <Skeleton className="mt-1.5 h-4 w-3/4" />
                            <Skeleton className="mt-1 h-3 w-1/2" />
                        </div>
                    ))}
                </div>
            </div>
        </div>
    )
}
