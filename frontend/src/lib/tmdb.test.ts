import { describe, expect, it } from 'vitest'
import { formatRuntime, TMDB_BACKDROP_BASE, TMDB_POSTER_BASE } from './tmdb'

// The TMDB → display mapping moved to the backend (see backend `movieView`), so
// this module is now just presentation helpers (DL-10).

describe('tmdb display helpers', () => {
    it('formats runtime into a human label (feature)', () => {
        expect(formatRuntime(139)).toBe('2h 19m')
        expect(formatRuntime(45)).toBe('45m')
    })

    it('returns a null runtime label for missing or non-positive runtimes (edge)', () => {
        expect(formatRuntime(null)).toBeNull()
        expect(formatRuntime(0)).toBeNull()
        expect(formatRuntime(-5)).toBeNull()
    })

    it('exposes the TMDB image CDN bases (feature)', () => {
        expect(TMDB_POSTER_BASE).toContain('image.tmdb.org')
        expect(TMDB_BACKDROP_BASE).toContain('image.tmdb.org')
    })
})
