import { act, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useDebouncedValue } from './use-debounced-value'

describe('useDebouncedValue', () => {
    beforeEach(() => vi.useFakeTimers())
    afterEach(() => vi.useRealTimers())

    // ── Feature / happy path ──────────────────────────────────────────────
    it('returns the initial value immediately (no first-render delay)', () => {
        const { result } = renderHook(() => useDebouncedValue('matrix', 250))
        expect(result.current).toBe('matrix')
    })

    it('updates only after the delay elapses with no further change', () => {
        const { result, rerender } = renderHook(({ v }) => useDebouncedValue(v, 250), {
            initialProps: { v: 'a' },
        })
        rerender({ v: 'ab' })
        expect(result.current).toBe('a') // not yet
        void act(() => vi.advanceTimersByTime(249))
        expect(result.current).toBe('a')
        void act(() => vi.advanceTimersByTime(1))
        expect(result.current).toBe('ab')
    })

    // ── Edge case: the whole point — rapid typing fires one update ─────────
    it('coalesces rapid changes into a single trailing update', () => {
        const { result, rerender } = renderHook(({ v }) => useDebouncedValue(v, 250), {
            initialProps: { v: 'm' },
        })
        rerender({ v: 'ma' })
        void act(() => vi.advanceTimersByTime(100))
        rerender({ v: 'mat' })
        void act(() => vi.advanceTimersByTime(100))
        rerender({ v: 'matrix' })
        // Each keystroke landed within the window, so it never settled.
        expect(result.current).toBe('m')
        void act(() => vi.advanceTimersByTime(250))
        expect(result.current).toBe('matrix')
    })
})
