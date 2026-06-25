// Registers @testing-library/jest-dom matchers (toBeInTheDocument, …) on
// Vitest's `expect`, and auto-unmounts React trees between tests.
import '@testing-library/jest-dom/vitest'
import { cleanup } from '@testing-library/react'
import { afterEach } from 'vitest'

afterEach(() => {
    cleanup()
})
