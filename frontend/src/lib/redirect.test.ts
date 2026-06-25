import { describe, expect, it } from 'vitest'
import { safeRedirect } from './redirect'

describe('safeRedirect', () => {
    // ── Feature / happy path ──────────────────────────────────────────────
    it('keeps internal absolute paths', () => {
        expect(safeRedirect('/watchlist')).toBe('/watchlist')
        expect(safeRedirect('/movie/550')).toBe('/movie/550')
    })

    // ── Edge cases (open-redirect boundary) ───────────────────────────────
    it('falls back to / for missing or relative values', () => {
        expect(safeRedirect(undefined)).toBe('/')
        expect(safeRedirect('')).toBe('/')
        expect(safeRedirect('watchlist')).toBe('/')
    })

    it('rejects protocol-relative and backslash redirects', () => {
        expect(safeRedirect('//evil.com')).toBe('/')
        expect(safeRedirect('/\\evil.com')).toBe('/')
        expect(safeRedirect('https://evil.com')).toBe('/')
    })
})
