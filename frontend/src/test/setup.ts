// Registers @testing-library/jest-dom matchers (toBeInTheDocument, …) on
// Vitest's `expect`, and auto-unmounts React trees between tests.
import '@testing-library/jest-dom/vitest'
import { cleanup } from '@testing-library/react'
import { afterEach } from 'vitest'

// jsdom doesn't implement scrollIntoView; stub it so auto-scroll effects (e.g.
// the chat window scrolling to the latest message) don't throw on mount.
Element.prototype.scrollIntoView = () => {}

afterEach(() => {
    cleanup()
})
