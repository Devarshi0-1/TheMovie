# TheMovie backend — Bun + Hono server.
FROM oven/bun:1-alpine

WORKDIR /app

# Install dependencies first for better layer caching. Only production deps are
# needed to run the server (drizzle-kit / typescript / concurrently are dev-only;
# Bun runs TypeScript directly, so no build/typecheck step is required at runtime).
COPY package.json bun.lock ./
RUN bun install --frozen-lockfile --production

# Application source. (Type-only imports like the TMDB OpenAPI types are erased
# by Bun, so the multi-MB spec files are intentionally not copied — see
# .dockerignore.)
COPY src ./src

EXPOSE 3000

# The default export in src/index.ts ({ port, fetch }) starts Bun.serve.
CMD ["bun", "run", "src/index.ts"]
