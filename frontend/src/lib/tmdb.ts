// Pure presentation helpers for movie data. The TMDB → display mapping (raw
// snake_case → the shared `MovieResult` / `MovieDetailView` schemas) now lives in
// the BACKEND (`movieView`), so the movie endpoints already return camelCase and
// the frontend only validates them (see `lib/movies.ts`). What remains here is
// just image-CDN bases and a runtime formatter (DL-10).

// TMDB image CDN bases (the API returns only the path segment).
export const TMDB_POSTER_BASE = 'https://image.tmdb.org/t/p/w342'
export const TMDB_BACKDROP_BASE = 'https://image.tmdb.org/t/p/w1280'

/** A human runtime label ("2h 28m"), or null when TMDB has no runtime. */
export function formatRuntime(minutes: number | null): string | null {
    if (!minutes || minutes <= 0) return null
    const hours = Math.floor(minutes / 60)
    const mins = minutes % 60
    return hours > 0 ? `${hours}h ${mins}m` : `${mins}m`
}
