import { tanstackStart } from '@tanstack/react-start/plugin/vite'
import viteReact from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

// TanStack Start runs on plain Vite (no Vinxi). The Start plugin owns route-tree
// codegen + the server/client entries; `viteReact` must come AFTER it.
export default defineConfig({
    server: { port: 3000 },
    plugins: [tanstackStart(), viteReact()],
})
