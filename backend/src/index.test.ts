import { describe, expect, it } from 'bun:test'
import { resolvePort } from './index'

describe('resolvePort', () => {
    it('defaults to 3000 when PORT is unset or empty (feature)', () => {
        expect(resolvePort(undefined)).toBe(3000)
        expect(resolvePort('')).toBe(3000)
        expect(resolvePort('   ')).toBe(3000)
    })

    it('honors a valid port number (feature)', () => {
        expect(resolvePort('3100')).toBe(3100)
        expect(resolvePort('8080')).toBe(8080)
    })

    it('accepts PORT=0 (OS-assigned ephemeral port) instead of silently using 3000 (regression)', () => {
        // The old `Number(PORT) || 3000` treated 0 as falsy and bound 3000,
        // defeating the ephemeral-port idiom used in CI/tests.
        expect(resolvePort('0')).toBe(0)
    })

    it('throws on garbage instead of masking it as 3000 (regression: fail loud)', () => {
        // `Number("abc") || 3000` silently returned 3000; a typo should fail.
        expect(() => resolvePort('abc')).toThrow(/Invalid PORT/)
        expect(() => resolvePort('3000.5')).toThrow(/Invalid PORT/)
        expect(() => resolvePort('-1')).toThrow(/Invalid PORT/)
        expect(() => resolvePort('70000')).toThrow(/Invalid PORT/)
    })
})
