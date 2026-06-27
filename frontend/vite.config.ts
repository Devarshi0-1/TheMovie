import { tanstackStart } from '@tanstack/react-start/plugin/vite'
import viteReact from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { defineConfig } from 'vite'

// TanStack Start runs on plain Vite (no Vinxi). The Start plugin owns route-tree
// codegen + the server/client entries; `viteReact` must come AFTER it.
// Dev server runs on 5173 (matches the backend's `FRONTEND_URL` / CORS +
// BetterAuth trusted-origins config) so it doesn't collide with the backend on
// :3000. The frontend reaches the API via `VITE_API_URL` (see `.env.example`).
//
// React Compiler (LT-6) is intentionally NOT wired here yet: on Vite 8 +
// @vitejs/plugin-react v6 it requires the rolldown `reactCompilerPreset` via
// `@rolldown/plugin-babel` (still 0.1.x), which deserves its own change with a
// build + runtime/SSR verification pass rather than being bundled in.
export default defineConfig({
    server: { port: 5173 },
    // Vite resolves the `@/*` alias from tsconfig `paths` natively. `tailwindcss`
    // is the Tailwind v4 Vite plugin. The Start plugin owns codegen + entries and
    // must precede `viteReact`.
    resolve: { tsconfigPaths: true },
    plugins: [tailwindcss(), tanstackStart(), viteReact()],
})
