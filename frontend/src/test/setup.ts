// Registers @testing-library/jest-dom matchers (toBeInTheDocument, …) on
// Vitest's `expect`, and auto-unmounts React trees between tests.
import '@testing-library/jest-dom/vitest'
import { cleanup } from '@testing-library/react'
import { afterEach } from 'vitest'

// jsdom doesn't implement scrollIntoView; stub it so auto-scroll effects (e.g.
// the chat window scrolling to the latest message) don't throw on mount.
Element.prototype.scrollIntoView = () => {}

// jsdom doesn't implement matchMedia; stub it (always non-matching) so responsive
// hooks like the sidebar's `useIsMobile` don't throw when components mount.
if (!window.matchMedia) {
    window.matchMedia = (query: string): MediaQueryList =>
        ({
            matches: false,
            media: query,
            onchange: null,
            addEventListener: () => {},
            removeEventListener: () => {},
            addListener: () => {},
            removeListener: () => {},
            dispatchEvent: () => false,
        }) as unknown as MediaQueryList
}

afterEach(() => {
    cleanup()
})
