import { tanstackStart } from '@tanstack/react-start/plugin/vite'
import viteReact from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

// TanStack Start runs on plain Vite (no Vinxi). The Start plugin owns route-tree
// codegen + the server/client entries; `viteReact` must come AFTER it.
// Dev server runs on 5173 (matches the backend's `FRONTEND_URL` / CORS +
// BetterAuth trusted-origins config) so it doesn't collide with the backend on
// :3000. The frontend reaches the API via `VITE_API_URL` (see `.env.example`).
export default defineConfig({
    server: { port: 5173 },
    plugins: [tanstackStart(), viteReact()],
})
