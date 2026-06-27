import { useRouterState } from '@tanstack/react-router'
import { useEffect, useRef } from 'react'

/**
 * Returns a ref that receives focus on client-side navigation (but never on the
 * initial paint). Point it at the page's main landmark so keyboard / screen-
 * reader users land on the new content instead of staying on the link they
 * activated (A11Y Project: manage focus on route change). Shared by the app-shell
 * main region and the auth-pages main region.
 */
export function useFocusOnNavigate<T extends HTMLElement>() {
    const ref = useRef<T>(null)
    const pathname = useRouterState({ select: (s) => s.location.pathname })
    const firstRender = useRef(true)

    useEffect(() => {
        if (firstRender.current) {
            firstRender.current = false
            return
        }
        ref.current?.focus()
    }, [pathname])

    return ref
}
