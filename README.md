# 🎬 TheMovie

An **AI-native movie discovery platform**. The headline feature is a **conversational chat agent**: ask something like *"a movie where the hero later becomes the villain"* and it embeds your query, runs **vector similarity search** over embedded movie data in **pgvector**, reasons over the results with an LLM, and streams back ranked suggestions. It also manages watchlists conversationally, summarizes reviews, and builds personalized recommendations.

> **Working with an AI agent on this repo?** Read [`CLAUDE.md`](./CLAUDE.md) (project rules + how the agent works) and [`backend/ROADMAP.md`](./backend/ROADMAP.md) (the authoritative, phased plan) first.

## Workspace layout

```
TheMovie/
├── backend/            Bun + Hono API — the agent, RAG, TMDB, auth   (active)
│   ├── src/
│   │   ├── routes/     HTTP routes (incl. POST /api/v1/chat)
│   │   ├── lib/        service modules (TMDB, OpenAI, embeddings, redis)
│   │   ├── agent/      the Vercel AI SDK agent: tools + streamText loop
│   │   ├── db/         Drizzle schema + client (Bun.SQL)
│   │   └── jobs/       background jobs (embedding ingestion)
│   ├── drizzle/        migrations
│   └── ROADMAP.md      the plan — start here
├── frontend/           TanStack Start + React 19 app                  (planned, Phase 7)
└── packages/
    └── schemas/        shared Zod schemas (API + LLM + forms)         (planned)
```

`frontend/` and `packages/schemas/` are scoped in the roadmap (Phase 7 / cross-cutting) and not yet scaffolded; `backend/` is the active package.

## Tech stack

- **Backend:** Bun + Hono, PostgreSQL via Bun.SQL + Drizzle, **pgvector**, Bun Redis, BetterAuth (Bun.password/Argon2). Bun-native wherever possible.
- **AI (single vendor — OpenAI via the Vercel AI SDK):** `gpt-5` reasoning agent (`streamText` + tools), `gpt-5-mini` intent gate / summaries, `text-embedding-3-small` embeddings. Streaming end-to-end (`toUIMessageStreamResponse()` → `useChat`).
- **Frontend:** TanStack Start + React 19, TanStack Query, Vite+ (oxlint / oxfmt / Vitest), tsgo v7.
- **Cross-cutting:** **Zod** schemas defined once in `packages/schemas/` and reused for API validation, LLM structured output, agent tool schemas, and frontend forms.

See [`CLAUDE.md`](./CLAUDE.md) for the full stack rules and rationale.

## Prerequisites

- **Bun** (latest)
- **PostgreSQL** with the **pgvector** extension available
- **Redis** (the backend `dev` script starts a Docker container named `my-movie-redis`)
- **OpenAI API key** and a **TMDB v4 read-access token**

## Getting started (backend)

```sh
cd backend
bun install

# configure environment
cp .env.example .env
# then fill in OPENAI_API_KEY, TMDB_READ_ACCESS_API_KEY, BETTER_AUTH_SECRET, DATABASE_URL, …

# make sure Postgres (with pgvector) and Redis are reachable, then run migrations
bunx drizzle-kit migrate

# start the API (hot reload + Drizzle Studio + Redis container)
bun run dev
```

The API listens on **http://localhost:3000** (`GET /ping` → `pong`).

## Testing

- **Backend:** `bun test`
- **Frontend:** `vitest` (once `frontend/` is scaffolded)

Every change ships **feature tests + edge-case tests + a short UX overview** (see `CLAUDE.md` → "How to work on this codebase").

## How the chat agent works

Every query flows through three stages (full spec in `CLAUDE.md`):

1. **Intent gate** — a cheap `gpt-5-mini` `generateObject` classifier blocks off-topic / abusive / prompt-injection queries before the expensive loop runs.
2. **Tiered retrieval (cheapest-first)** — the `gpt-5` agent picks among tools: **SQL** (exact: title/genre/year) → **semantic** (pgvector, for conceptual queries) → **TMDB** (last-resort miss; writes back + embeds so the catalog self-heals).
3. **Synthesize** — ranked suggestions with explanations, streamed to the UI.

## Project docs

- [`CLAUDE.md`](./CLAUDE.md) — project rules, tech-stack constraints, agent way-of-working
- [`backend/ROADMAP.md`](./backend/ROADMAP.md) — the phased build plan (Phase 0 fixes → AI agent → frontend → hardening)
- [`backend/.env.example`](./backend/.env.example) — required environment variables
