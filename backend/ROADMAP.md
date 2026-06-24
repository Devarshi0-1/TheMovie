# 🎬 TheMovie — AI-Native Movie Discovery Roadmap

> A Netflix-style movie platform with a **conversational AI agent** at its core, built on **Bun's native APIs**.
>
> Ask it *"show me a movie where the hero later becomes the villain"* and it performs **RAG over embedded movie data** (plots, keywords, themes) to find and explain matches — then helps you manage your watchlist, summarizes reviews, and builds a personalized feed.

> ▸ **Current focus:** Phase 3 — vector & embedding pipeline (pgvector extension + `embedding` column, OpenAI embedding service, ingestion). _(✅ Phase 0 · ✅ Phase 1 — auth hardening deferred to Phase 6 · ✅ Phase 2 data engine + `movies` table.)_ Update this pointer as phases complete so a fresh session knows where to start (see `CLAUDE.md` → "Working cadence & context hygiene")._

## 📦 Tech Stack

The foundation aggressively uses Bun's built-in, high-performance C++ implementations. The **AI layer is a deliberate, scoped exception** to the zero-dependency goal — semantic search and the chat agent require external AI services (OpenAI for both reasoning and embeddings). We stay **Bun-native everywhere else**, and **single-vendor (OpenAI) on the AI side**.

| Layer | Technology | Notes |
| --- | --- | --- |
| **Runtime** | **Bun** | Replaces Node.js, `ts-node`, `nodemon` |
| **Server** | **Hono** | Native `Request`/`Response`, `Bun.serve()` |
| **Database** | **Bun.SQL** (PostgreSQL) | Native C++ driver — no `pg` |
| **Vector store** | **pgvector** | Embeddings live alongside relational data in Postgres |
| **ORM** | **Drizzle** (`bun-sql` driver) | Includes `vector` column type for pgvector |
| **Cache** | **Bun Redis** | Native — no `ioredis`/`redis` |
| **Hashing** | **Bun.password** | Native Argon2 — no `bcrypt` |
| **Auth** | **BetterAuth** | Drizzle adapter over Bun.SQL |
| **Testing** | **Bun Test** | No `jest`/`vitest` |
| --- AI layer (Vercel AI SDK + OpenAI, single vendor) --- | | |
| **AI toolkit** | **Vercel AI SDK** (`ai`, `@ai-sdk/openai`, `@ai-sdk/react`) | Model calls, tools, structured output, embeddings, streaming |
| **LLM / Agent** | **OpenAI GPT** via `openai('gpt-5')` | `streamText` + tools + `stopWhen: stepCountIs(...)`; loop hosted in Hono |
| **Embeddings** | **OpenAI** `text-embedding-3-small` | 1536-dim vectors via the AI SDK's `embed` / `embedMany` |
| **Chat streaming** | `toUIMessageStreamResponse()` → `useChat` | UI message stream end-to-end |
| **Deployment** | **Docker** (`oven/bun`) | Alpine image |

### AI architecture at a glance

```
   Chat window          ┌─────────────────────────────────────────────┐
   (useChat)  ◀───────▶ │  POST /api/v1/chat  (UI message stream)     │
                        │  Vercel AI SDK agent (streamText + tools)   │
                        │  intent gate → tiered retrieval → synthesize│
                        │  model: gpt-5 (via @ai-sdk/openai)          │
                        └───────────────┬─────────────────────────────┘
                                        │ the model calls YOUR tools
            ┌───────────────────────────┼───────────────────────────┐
            ▼                           ▼                           ▼
   semantic_search_movies   get_movie_details / trending   manage_watchlist
   (pgvector cosine kNN      (TMDB service + Redis cache)   (Postgres + Redis)
    over OpenAI embeddings)
```

We host the agent loop ourselves in Hono with the **Vercel AI SDK** — `streamText` drives the multi-step tool loop, `@ai-sdk/openai` makes the GPT calls, and the route returns `toUIMessageStreamResponse()` which the frontend consumes via `useChat`. Multi-turn state is persisted as per-user conversation history in Postgres.

---

## ⚡️ Bun Native Patterns (the "secret sauce")

```typescript
// ✅ Native Redis — reads REDIS_URL automatically. No 'ioredis'.
import { redis } from "bun";
await redis.set("session:123", "user_data", "EX", 3600);

// ✅ Native SQL — Bun's C++ PostgreSQL driver. No 'pg'.
import { SQL } from "bun";
import { drizzle } from "drizzle-orm/bun-sql";
const db = drizzle({ client: new SQL(process.env.DATABASE_URL!) });

// ✅ Native password hashing — Argon2. No 'bcrypt'.
const hash = await Bun.password.hash("supersecret");
const ok = await Bun.password.verify("supersecret", hash);
```

---

## 🚩 Phase 0: Fix & Cleanup (do first)

Known issues in the current code, to be resolved before building on top.

* [x] **Fix `getTrendingMovies` return shape** (`src/lib/tmdb.ts`): now returns the `results` array on both cache hit and miss (caches the array, not the wrapper).
* [x] **Reconcile trending endpoint vs. type**: `TrendingMoviesResponse` retyped to `/3/trending/movie/{time_window}` to match the endpoint actually called.
* [x] **Remove vestigial `pg` dependency**: dropped `pg` + `@types/pg` from `package.json` (only `drizzle-orm/pg-core` types are used; nothing imports the `pg` package).
* [x] ~~**Generate the missing `watchlist` migration**~~ — **already present.** `watchlist` is in `0000_majestic_karma.sql` and the snapshot; `drizzle-kit generate` reports no drift. The original analysis was wrong; no migration needed.
* [x] **Add a real `/health` endpoint**: pings Postgres + Redis with **bounded, parallel probes** (fail-fast → `down` instead of hanging), returns per-dependency status + 200/503. Covered by `src/app.test.ts`.

---

## 🚩 Phase 1: The Native Foundation  _(mostly complete)_

### Milestone 1.1: Core Infrastructure
* [x] **Bun + Hono** initialized with native `Bun.serve()` (`src/index.ts`).
* [x] **Database (Bun.SQL)**: Drizzle on the `drizzle-orm/bun-sql` adapter (`src/db/index.ts`).
* [x] **Redis (Bun Native)**: connected via `import { redis } from 'bun'` (`src/lib/redis.ts`).
* [x] **Health check** — `/health` pings Postgres + Redis with per-dependency status (done in Phase 0).

### Milestone 1.2: Authentication (BetterAuth + Native)
* [x] **BetterAuth** with Drizzle adapter, email/password (`src/lib/auth.ts`), mounted at `/api/auth/*`.
* [x] **Session check** endpoint `/api/me`.
* [ ] **Harden auth before production** (see Phase 6): raise `minPasswordLength`, re-enable origin checks, consider Redis-backed session storage with TTLs.

---

## 🚩 Phase 2: Movie Data Engine & Persistence

### Milestone 2.1: TMDB Fetching & Caching  _(complete)_
* [x] **TMDB service** using native `fetch` (`src/lib/tmdb.ts`).
* [x] **Stale-while-revalidate** caching in Redis for trending / search / details (1h TTL).

### Milestone 2.2: Database Schema (Drizzle)
* [x] **`movies` table** (`src/db/schema.ts`): `id`, `tmdb_id` (unique), `title`, `overview`, `poster_path`, `backdrop_path`, `release_date`, `genres`/`keywords`/`metadata` (jsonb), timestamps. Migration `0001_add_movies.sql`. _Live apply pending a reachable Postgres._
* [x] **GIN index** on `movies.metadata` (`movies_metadata_gin_idx`) for JSON containment queries.
* [ ] **`embedding` column**: `vector(1536)` on `movies` (pgvector) — deferred to **Phase 3.1** (requires the pgvector extension); populated by the ingestion pipeline.

---

## 🚩 Phase 3: Vector & Embedding Pipeline

The data engine behind semantic search. Embeds movie text so the agent can find films by plot/theme rather than keyword.

### Milestone 3.1: pgvector setup
* [ ] **Enable pgvector**: `CREATE EXTENSION IF NOT EXISTS vector;` via a Drizzle migration.
* [ ] **Vector column + index**: add `embedding vector(1536)` to `movies`; create an **HNSW** index with `vector_cosine_ops` for fast cosine kNN.

### Milestone 3.2: OpenAI embedding service
* [ ] **`src/lib/embeddings.ts`**: embed via the AI SDK's `embedMany({ model: openai.textEmbeddingModel('text-embedding-3-small'), values })` (1536-dim), reading `OPENAI_API_KEY`. Batch inputs; handle rate limits and retries explicitly.
* [ ] **Compose the embedding text** per movie from `title + overview + genres + keywords` (the fields that capture plot/theme — what "hero becomes villain" matches against).
* [ ] **Cache embeddings**: never re-embed unchanged text. Key by a hash of the source text.

### Milestone 3.3: Ingestion pipeline
* [ ] **Background job** (`src/jobs/ingest.ts`, runnable via `bun run`): fetch TMDB catalog pages → upsert into `movies` → embed → store vectors.
* [ ] **Chunk long text** (plots/reviews) with a small splitter util before embedding, where a single field exceeds the model's input window.
* [ ] **Idempotent upserts** keyed on `tmdb_id`; skip rows whose source text hash is unchanged.
* [ ] **Backfill + incremental** modes (full catalog seed vs. daily new releases).

---

## 🚩 Phase 4: AI Chat Agent & RAG  _(headline feature)_

The conversational window: natural-language movie discovery powered by a **Vercel AI SDK** agent (`streamText` + tools) over GPT + the vector store. The full pipeline (intent gate → tiered retrieval → synthesis) is specified in `CLAUDE.md` → "The chat agent: query-handling pipeline".

### Milestone 4.1: Intent gate (guardrail)
* [ ] **`src/agent/intent.ts`**: a cheap **`gpt-5-mini`** `generateObject({ schema })` call (shared **Zod** schema) returning `{ relevant, intent, ... }`.
* [ ] **Block** off-topic, abusive, and prompt-injection queries **before** the expensive `gpt-5` loop runs (safety + cost control). Return a friendly refusal for blocked queries.

### Milestone 4.2: Retrieval tools (tiered)
* [ ] **`search_movies_sql`**: structured/exact lookups (title, genre, year) against Postgres. Cheapest, most precise — the agent's first choice for concrete queries.
* [ ] **`semantic_search_movies`**: embed the query (OpenAI) → cosine kNN against `movies.embedding` (pgvector, via Drizzle) → top matches. Answers conceptual queries like *"hero later becomes the villain."*
* [ ] **`fetch_from_tmdb`**: last-resort lookup on a local-catalog miss; on a hit, **write back** (upsert + embed) so the catalog self-heals.
* [ ] **`get_movie_details`** / **`get_trending`** / **`manage_watchlist`** / **`get_user_watchlist`**: wrap existing services / Phase 5 user features.
* [ ] Define every tool with the AI SDK's **`tool({ inputSchema, execute })`** using **Zod** schemas, and write **prescriptive descriptions** stating *when* to call each (prefer cheapest sufficient tier; escalate only on insufficient results).

### Milestone 4.3: Agent loop + streaming
* [ ] **`src/agent/agent.ts`**: a **`streamText`** agent — `model: openai('gpt-5')`, the retrieval tools, and a multi-step loop via `stopWhen: stepCountIs(...)`. The system prompt encodes cheapest-sufficient-first escalation; the pipeline (intent gate → tool-driven retrieval → synthesis) is plain TS control flow.
* [ ] **`POST /api/v1/chat`** (authenticated): return `result.toUIMessageStreamResponse()` directly from Hono so the frontend `useChat` renders tokens + tool activity live. Validate the request body with a shared **Zod** schema.
* [ ] **Log the retrieval path(s) taken** per request (sql / semantic / tmdb) alongside token usage (`usage`) for observability.

### Milestone 4.4: State, memory & confirmation
* [ ] **Conversation memory**: persist per-user chat turns in Postgres — load prior messages on each request, append new turns via `streamText`'s `onFinish` — so multi-turn context ("the sci-fi one we discussed") works and conversations resume.
* [ ] **Human-in-the-loop confirmation**: gate chat-driven mutations (e.g. watchlist edits) on client approval via the AI SDK tool-confirmation pattern (`useChat` + `addToolResult`) before committing.

### Milestone 4.5: Review & synopsis summarization
* [ ] **Spoiler-free summaries**: GPT summarizes TMDB reviews into pros/cons + a one-line "vibe" per movie. Cache the summary in Redis keyed by `movie:{id}:summary`.
* [ ] Use a **cheaper model (`gpt-5-mini`)** for this bounded summarization task to control cost (see CLAUDE.md cost rules).

---

## 🚩 Phase 5: High-Performance User Features

### Milestone 5.1: Watchlist
* [ ] **CRUD endpoints** for `watchlist` (`src/routes/watchlist.ts`): add/remove/list, authenticated, respecting the existing `unique_user_movie` constraint.
* [ ] **O(1) membership** via Redis Sets (`SADD`/`SREM`/`SISMEMBER`) for "is this in my watchlist?"; sync to Postgres (dual-write or write-behind).
* [ ] **Conversational watchlist**: wire the `manage_watchlist` agent tool (Phase 4.1) to these endpoints so users can add/remove via chat.

### Milestone 5.2: Reviews & Personalized Recs
* [ ] **User reviews** stored in Postgres; cache "recent reviews" per movie in a Redis List (`LPUSH`/`LTRIM`).
* [ ] **Personalized AI recommendations** ("because you watched X"): a dedicated step that combines the user's watchlist with **vector similarity** (kNN from watched movies' embeddings) to assemble candidates, then has the agent (`generateText`/`generateObject`) rank and explain the picks.

---

## 🚩 Phase 6: Production Hardening

### Milestone 6.1: Security & limits
* [ ] **Rate limiting**: sliding-window limiter using Redis `INCR` + `EXPIRE`. Apply tighter limits to the AI chat endpoint (it's the expensive one).
* [ ] **Secure headers**: Hono `secureHeaders` middleware.
* [ ] **Auth hardening**: raise `minPasswordLength`, re-enable origin checks, review CORS.
* [ ] **Validate inputs** at every API boundary (chat prompts, search queries, watchlist mutations).

### Milestone 6.2: AI cost & observability
* [ ] **Prompt caching**: keep the agent's stable system prompt + tool definitions at the start of the prompt so OpenAI's automatic prompt caching applies.
* [ ] **Token/usage logging** per request (input/output/cache tokens) for cost tracking.
* [ ] **Embedding cost control**: confirm no redundant re-embedding; monitor ingestion spend.

### Milestone 6.3: DevOps
* [ ] **Docker image** `FROM oven/bun:1-alpine`, `CMD ["bun", "run", "src/index.ts"]`.
* [ ] **CI/CD**: run backend `bun test` + frontend `vitest` + `oxlint` + `tsgo` type-check on every PR; block merge on failure.

---

## 🚩 Phase 7: Frontend (TanStack Start + React 19)

Lives in `frontend/`. Shares Zod schemas with the backend via `packages/schemas/`.

### Milestone 7.1: Scaffold
* [ ] **Vite+ workspace** with **oxlint** (lint), **oxfmt** (format), **Vitest** (test), **tsgo v7** (type-check). Pin versions.
* [ ] **TanStack Start + React 19** app; file-based **TanStack Router** (ships with Start); **TanStack Query** for server state.
* [ ] **`packages/schemas/`**: shared Zod schemas consumed by both backend and frontend.

### Milestone 7.2: Core screens
* [ ] **Auth UI** (sign-up / sign-in) against BetterAuth; session-aware routing.
* [ ] **Discovery**: trending grid + search, backed by TanStack Query against the movie endpoints.
* [ ] **Movie detail**: details + spoiler-free AI summary; add/remove from watchlist.
* [ ] **Watchlist** screen.

### Milestone 7.3: Chat window  _(headline UX)_
* [ ] **Conversational chat UI** built on the AI SDK's **`useChat`** (`@ai-sdk/react`) against `POST /api/v1/chat` — streams tokens live, renders tool/retrieval activity, and supports stop/regenerate.
* [ ] **Tool confirmation UI** for chat-driven watchlist mutations (approve/deny → `addToolResult`).
* [ ] **Forms validated with TanStack Form + Zod** (shared schemas). Handle blocked/irrelevant queries gracefully (the intent-gate refusal).

> Every frontend change ships feature tests + edge-case tests (Vitest) + a UX overview, per `CLAUDE.md`.

---

## Environment variables

```
DATABASE_URL=          # Postgres (pgvector-enabled)
REDIS_URL=             # Bun Redis
FRONTEND_URL=          # CORS origin
TMDB_READ_ACCESS_API_KEY=
OPENAI_API_KEY=        # GPT agent/summarization + text-embedding-3-small (single AI vendor)
BETTER_AUTH_SECRET=
```
