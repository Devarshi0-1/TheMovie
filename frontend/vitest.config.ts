import viteReact from '@vitejs/plugin-react'
import { defineConfig } from 'vitest/config'

// Unit tests run on a plain React + jsdom setup — deliberately WITHOUT the
// TanStack Start plugin, so component/unit tests stay fast and don't drag in
// SSR/route-tree machinery. Integration of the full router is exercised by the
// dev/build pipeline, not here. `resolve.tsconfigPaths` mirrors vite.config so
// the `@/*` alias (shadcn `@/components/ui/*`) resolves under Vitest too.
export default defineConfig({
    plugins: [viteReact()],
    resolve: { tsconfigPaths: true },
    test: {
        environment: 'jsdom',
        globals: true,
        setupFiles: ['./src/test/setup.ts'],
        include: ['src/**/*.{test,spec}.{ts,tsx}'],
        css: false,
    },
})
