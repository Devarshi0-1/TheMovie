import { tanstackStart } from '@tanstack/react-start/plugin/vite'
import viteReact, { reactCompilerPreset } from '@vitejs/plugin-react'
import rolldownBabel from '@rolldown/plugin-babel'
import tailwindcss from '@tailwindcss/vite'
import { defineConfig } from 'vite'

// TanStack Start runs on plain Vite (no Vinxi). The Start plugin owns route-tree
// codegen + the server/client entries; `viteReact` must come AFTER it.
// Dev server runs on 5173 (matches the backend's `FRONTEND_URL` / CORS +
// BetterAuth trusted-origins config) so it doesn't collide with the backend on
// :3000. The frontend reaches the API via `VITE_API_URL` (see `.env.example`).
//
// React Compiler (LT-6): @vitejs/plugin-react v6 transforms with oxc (no `babel`
// option), so the compiler runs as a separate rolldown Babel pass via the
// plugin's `reactCompilerPreset`. It targets React 19's built-in
// `react/compiler-runtime` (no extra runtime package). The compiler auto-memoizes
// components/hooks and bails safely on any it can't prove correct.
export default defineConfig({
    server: { port: 5173 },
    // Vite resolves the `@/*` alias from tsconfig `paths` natively. `tailwindcss`
    // is the Tailwind v4 Vite plugin. The Start plugin owns codegen + entries and
    // must precede `viteReact`; the React Compiler Babel pass runs last.
    resolve: { tsconfigPaths: true },
    plugins: [
        tailwindcss(),
        tanstackStart(),
        viteReact(),
        rolldownBabel({ presets: [reactCompilerPreset()] }),
    ],
})
