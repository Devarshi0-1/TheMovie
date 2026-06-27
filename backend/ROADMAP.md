# 🎬 TheMovie — AI-Native Movie Discovery Roadmap

> A Netflix-style movie platform with a **conversational AI agent** at its core, built on **Bun's native APIs**.
>
> Ask it *"show me a movie where the hero later becomes the villain"* and it performs **RAG over embedded movie data** (plots, keywords, themes) to find and explain matches — then helps you manage your watchlist, summarizes reviews, and builds a personalized feed.

> ▸ **Current focus:** **🎉 Roadmap complete (Phases 0–7).** ✅ Phase 7.3 — the **headline chat window** — fully done: a `useChat` (`@ai-sdk/react` v3 / `ai` v6) conversation against the auth-gated `POST /api/v1/chat`, streaming live with a **tool/retrieval activity** trail, **stop/regenerate**, a **TanStack Form + Zod** composer, and the **HITL watchlist confirmation** (approve → REST mutate + cache sync → `addToolResult` → the agent auto-continues; deny → declined). Shipping it also **fixed the backend HITL continuation** (the model now receives the resolved tool result instead of a dangling tool call → no OpenAI 400), **scoped the message upsert** to its conversation, and **closed an intent-gate bypass** (a forged "continuation" can no longer skip the gate — only a continuation resolving a server-proposed call in trusted history is honored). **Live-verified the whole loop against the running backend (:3100 / live OpenAI):** real retrieval queries stream tool activity; off-topic queries stream the gate refusal as plain text; the 2-turn HITL round-trip ends in "Done — added Inception to your watchlist". Frontend **108** tests (was 79) + backend **165** + schemas **42** all green; oxlint + tsgo + `tsc` clean; `vite build` builds client + SSR. _Phase 7.2 recap: the four core screens (Auth / Discovery / Movie detail / Watchlist) on a shared-Zod data layer; dev server on **:5173**, backend on **:3100** (`VITE_API_URL` knob). Phase 7.1 recap: Bun workspace + `@themovie/schemas` + scaffolded TanStack Start app._ **Post-Phase-7 enhancements (all shipped, merged & live-verified — the earlier "polish" list is now done):** (#32) retry transient TMDB failures with exponential backoff; (#33) **cross-session chat resume** — the conversation id is persisted and the thread + history restored on reload (`X-Conversation-Id` is now CORS-exposed; a GET `/api/v1/chat/:id` rehydrates turns), plus a **New chat** button; (#34) the intent-gate refusal now **streams token-by-token**; (#35) **batch watchlist confirmations** — one "Yes, add all N" applies a whole multi-movie proposal; (#36) a **Bun-native `db:migrate` runner** (`src/db/migrate.ts`, replacing the unusable `drizzle-kit migrate`) and **graceful cross-user conversation handling** (a request bearing another user's conversation id starts a fresh thread instead of 500-ing). A full **headed browser E2E** pass — auth, discovery/search, movie detail + AI summary, watchlist CRUD, chat streaming + tool activity, HITL approve, and cross-session resume — was run against the live stack (frontend :5173 ↔ backend :3100 ↔ live OpenAI/TMDB). **Current suites: frontend 116 / backend 182 / schemas 43**, all green; tsgo + oxlint + `tsc` clean; `vite build` builds client + SSR. No known open follow-ups remain. **Live E2E verification is ✅ done** — the whole backend (Phases 0–6) was exercised against live Postgres+pgvector / Redis / OpenAI / TMDB per [`backend/VERIFICATION.md`](./VERIFICATION.md); all "Verification debt" boxes below are ticked. The live run surfaced and fixed **six bugs that only manifest against real services**: jsonb double-encoding (genres/keywords/metadata stored as string scalars → SQL `@>`/GIN filters silently matched nothing), Bun.serve's 10s `idleTimeout` killing the streaming chat agent mid-answer, `fetch_from_tmdb` treating a `tmdbId: 0` placeholder as a real id, the agent exhausting its step budget on heavy fan-out and streaming an empty answer, the review recent-list cache keeping a stale duplicate after an edit, and the Redis client never reconnecting after an outage. _(✅ Phase 0–7 complete.)_ Update this pointer as work proceeds so a fresh session knows where to start (see `CLAUDE.md` → "Working cadence & context hygiene")._

> ✅ **Verification debt — CLEARED (live run, 2026-06-25; re-verified on `gpt-5-nano` 2026-06-26).** These were originally built/verified **offline** (schema, generated SQL, `tsc`, mocked unit tests), then exercised end-to-end against live **Postgres+pgvector**, **Redis**, **`OPENAI_API_KEY`**, and **`TMDB_READ_ACCESS_API_KEY`** per [`backend/VERIFICATION.md`](./VERIFICATION.md). Datastores stand up via the new root `docker-compose.yml`.
>
> **Re-verification (2026-06-26):** commit `9834d2c` switched every LLM call to `gpt-5-nano` *after* the original 2026-06-25 run (which used `gpt-5`/`gpt-5-mini`), so the whole pipeline was re-exercised live on `:3100` against the deployed model. Usage logs confirm `model=gpt-5-nano` on the **intent gate** (allowed + blocked), the **agent loop** (SQL + semantic tiers + synthesis), **multi-turn memory**, **recommendations**, and **review summaries**, with prompt-cache (`cached=`) and embedding-cache (`fromCache=1`) hits observed; watchlist CRUD, reviews upsert/edit, cross-user isolation, and rate limiting all held. The `fetch_from_tmdb` **write-back** tier could not be re-confirmed this run — the agent correctly escalated to it, but the TMDB call hit intermittent `ECONNRESET`s reaching `api.themoviedb.org` (an environment network issue, not a code regression); the write-back stands as verified on 2026-06-25.
> - [x] **Phase 0 `/health`** — `{"status":"ok","checks":{"db":"up","redis":"up"}}` 200 when both up; `degraded`/503 when Redis is down, and **auto-recovers** (~2s) once Redis returns (self-healing Redis client that recreates the connection on failure — Bun's `autoReconnect`/`maxRetries` alone do **not** recover a wedged connection; see PR #23).
> - [x] **Phase 2.2 `movies` migration** (`0001`) — applied live; rows insert/query; GIN index present (and now actually usable — see jsonb fix).
> - [x] **Phase 3.1 pgvector migration** (`0002`) — `vector` 0.8.3 extension enabled; `embedding vector(1536)` + HNSW (cosine) index built.
> - [x] **Phase 3.3 `source_hash` migration** (`0003`) — column added.
> - [x] **Phase 3.3 ingestion run** — `bun run ingest --pages=5`: 99 rows upserted with vectors; re-run a no-op (`embedded=0 skipped=99`); `--incremental` pulls now-playing. Embedding cache makes re-seeds zero-cost (`fromCache`).
> - [x] **Phase 4.1 intent gate** — `gpt-5-nano` allows movie queries (`intent=search`/`details`/`recommendation`); blocks off-topic + injection with a streamed refusal and **0 agent-loop calls** (only the intent line logs, no `label=chat`); prompt-cache reads register in the usage log.
> - [x] **Phase 4.2 retrieval tiers** — `search_movies_sql` (genre/year/title filters; jsonb `@>` fixed), `semantic_search_movies` (cosine kNN), and `fetch_from_tmdb` write-back self-heal (catalog grew 99→102 on a miss) all confirmed.
> - [x] **Phase 4.3 chat endpoint** — `gpt-5-nano` streams a synthesized answer; tool/retrieval activity surfaces in the stream; blocked query streams the refusal; `onFinish` logs `retrieval=…` paths + token usage (with `cached=` prompt-cache hits). _(Fixed: Bun.serve 10s idle-timeout cutting the stream; empty-answer on step-budget exhaustion.)_
> - [x] **Phase 4.4 conversation memory** — turns persist; a follow-up loads prior history (multi-turn context confirmed); another user can neither read nor append to someone else's conversation.
> - [x] **Phase 4.5 review summary** — spoiler-free vibe/pros/cons returns; no-reviews placeholder works; 2nd call served from Redis (exactly one `review-summary` model call across repeats).
> - [x] **Phase 5.1 watchlist** — add/remove/list round-trips; `unique_user_movie` makes re-add idempotent; `/:movieId/status` correct; cross-user isolation + 401 unauth enforced.
> - [x] **Phase 5.2 reviews + recs** — review upsert + per-movie list + cache cold-hydrate (fixed a stale-duplicate-on-edit cache bug); `GET /api/v1/recommendations` returns "because you watched X" picks via `gpt-5-nano` over pgvector candidates; empty watchlist → `[]` with no model call.
> - [x] **Phase 6.1 rate limiting** — `/api/v1/chat` 429s after 15/min with `X-RateLimit-*` + `Retry-After: 60`; counter key TTLs out (window reset); limiter **fails open** when Redis is down.
> - [x] **Phase 6.3 Docker/CI** — `docker build` + `docker run` boots and serves `/health` 200 (note: pass an **unquoted** env file — see VERIFICATION.md §8). GitHub Actions backend job green on this PR.

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
| **LLM / Agent** | **OpenAI GPT** via `openai('gpt-5-nano')` | `streamText` + tools + `stopWhen: stepCountIs(...)`; loop hosted in Hono |
| **Embeddings** | **OpenAI** `text-embedding-3-small` | 1536-dim vectors via the AI SDK's `embed` / `embedMany` |
| **Chat streaming** | `toUIMessageStreamResponse()` → `useChat` | UI message stream end-to-end |
| **Deployment** | **Docker** (`oven/bun`) | Alpine image |

### AI architecture at a glance

```
   Chat window          ┌─────────────────────────────────────────────┐
   (useChat)  ◀───────▶ │  POST /api/v1/chat  (UI message stream)     │
                        │  Vercel AI SDK agent (streamText + tools)   │
                        │  intent gate → tiered retrieval → synthesize│
                        │  model: gpt-5-nano (via @ai-sdk/openai)     │
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
* [x] **Harden auth before production** (done in Phase 6.1): raised `minPasswordLength` (4 → 8), re-enabled origin checks (removed `disableOriginCheck`), restricted CORS to an allow-list. _(Redis-backed session storage remains an optional future enhancement.)_

---

## 🚩 Phase 2: Movie Data Engine & Persistence

### Milestone 2.1: TMDB Fetching & Caching  _(complete)_
* [x] **TMDB service** using native `fetch` (`src/lib/tmdb.ts`).
* [x] **Stale-while-revalidate** caching in Redis for trending / search / details (1h TTL).

### Milestone 2.2: Database Schema (Drizzle)
* [x] **`movies` table** (`src/db/schema.ts`): `id`, `tmdb_id` (unique), `title`, `overview`, `poster_path`, `backdrop_path`, `release_date`, `genres`/`keywords`/`metadata` (jsonb), timestamps. Migration `0001_add_movies.sql`. _Live apply pending a reachable Postgres._
* [x] **GIN index** on `movies.genres` (`movies_genres_gin_idx`) for jsonb membership/containment queries (the `genres ? 'Action'` filter in `search_movies_sql`). _Swapped from `metadata` — which no query filters — in migration `0006`._
* [x] **`embedding` column**: `vector(1536)` on `movies` — added in **Phase 3.1** (migration `0002`); populated by the ingestion pipeline (Phase 3.3).

---

## 🚩 Phase 3: Vector & Embedding Pipeline

The data engine behind semantic search. Embeds movie text so the agent can find films by plot/theme rather than keyword.

### Milestone 3.1: pgvector setup
* [x] **Enable pgvector**: `CREATE EXTENSION IF NOT EXISTS vector;` prepended to migration `0002_add_embedding.sql`.
* [x] **Vector column + index**: `embedding vector(1536)` on `movies` + **HNSW** index `movies_embedding_hnsw_idx` with `vector_cosine_ops` (cosine kNN). _Live apply pending a reachable pgvector DB._

### Milestone 3.2: OpenAI embedding service  _(complete)_
* [x] **`src/lib/embeddings.ts`**: embeds via the AI SDK's `embedMany({ model: openai.embeddingModel('text-embedding-3-small'), values })` (1536-dim), reading `OPENAI_API_KEY`. Batches inputs; bounds fan-out with `maxParallelCalls` and retries rate limits with `maxRetries`. _(Uses `openai.embeddingModel` — the current API; `textEmbeddingModel` is deprecated in `@ai-sdk/openai` v3.)_
* [x] **Composes the embedding text** per movie from `title + overview + genres + keywords` (`composeEmbeddingText`) — the fields that capture plot/theme. Normalizes string-or-`{name}` jsonb shapes and de-dupes labels.
* [x] **Caches embeddings** in Redis keyed by a SHA-256 hash of the source text (`contentHashFor`), namespaced by model; never re-embeds unchanged text. De-dupes identical texts within a batch and embeds only cache misses. _Validated offline with mocked AI SDK + Redis (`src/lib/embeddings.test.ts`); live OpenAI/Redis exercise pending env._

### Milestone 3.3: Ingestion pipeline  _(complete; live run pending env)_
* [x] **Background job** (`src/jobs/ingest.ts`, runnable via `bun run ingest`): pulls TMDB catalog pages → enriches each movie (detail + keywords in one `append_to_response` call) → upserts into `movies` → embeds via `embedTexts` → stores vectors. Bounded-concurrency enrichment; one failed lookup yields `null` rather than aborting the run. TMDB catalog calls (`discoverMoviePage` / `getNowPlayingPage` / `getMovieForIngest`) live in `src/lib/tmdb.ts`.
* [x] **Chunk long text** with a `chunkText` splitter (paragraph → sentence → word boundaries); `capForEmbedding` caps composed text to the model's input window before embedding (reviews are the realistic chunk case in Phase 4.5/5.2).
* [x] **Idempotent upserts** keyed on `tmdb_id` (`onConflictDoUpdate`); persists a `source_hash` column (migration `0003`) and skips rows whose hash is unchanged — no re-embed, no re-write. De-dupes repeated `tmdb_id` within a batch (keeps last).
* [x] **Backfill + incremental** modes — `--pages`/`--start-page` flags; backfill reads popularity-ordered `/discover/movie`, `--incremental` reads `/movie/now_playing`. _(Idempotency core verified offline with injected deps in `src/jobs/ingest.test.ts`; live TMDB+DB+OpenAI run tracked in the verification-debt list above.)_

---

## 🚩 Phase 4: AI Chat Agent & RAG  _(headline feature)_

The conversational window: natural-language movie discovery powered by a **Vercel AI SDK** agent (`streamText` + tools) over GPT + the vector store. The full pipeline (intent gate → tiered retrieval → synthesis) is specified in `CLAUDE.md` → "The chat agent: query-handling pipeline".

### Milestone 4.1: Intent gate (guardrail)  _(complete; live model call pending env)_
* [x] **`src/agent/intent.ts`**: `runIntentGate(query)` runs a cheap **`gpt-5-nano`** `generateObject({ schema })` call returning `{ intent, relevant, safe, confidence, reason }`. Stable system prompt kept first (volatile query last) for OpenAI prompt caching; token usage (incl. cached reads) logged per call. The classifier is injectable so the gate is unit-tested without an OpenAI call.
* [x] **Block** off-topic, abusive, and prompt-injection queries **before** the multi-step `gpt-5-nano` agent loop (safety + cost control), via `decideGate` → `{ allowed, refusal? }`. Blocks when `!relevant || !safe || intent ∈ {off_topic, injection}` (relevant/safe treated as authoritative — defense in depth); empty queries short-circuit without a model call. Returns a friendly, non-echoing refusal.
* [x] **Shared Zod schema** `IntentResultSchema` + `INTENTS` + pure `isBlocked`/`refusalFor`/`decideGate`. _Now lifted to `packages/schemas/` (`@themovie/schemas`, Phase 7.1); the backend imports it from there._ Verified offline (`intent.test.ts` in the schemas package + `src/agent/intent.test.ts`); live `gpt-5-nano` call confirmed in the E2E pass.

### Milestone 4.2: Retrieval tools (tiered)  _(retrieval tiers complete; watchlist tools deferred to Phase 5; live DB/API pending env)_
* [x] **`search_movies_sql`**: structured/exact lookups (title ILIKE, genre jsonb-containment, year prefix) against Postgres; returns `[]` when no filter is given so the agent escalates. Cheapest, most precise.
* [x] **`semantic_search_movies`**: `embedText(query)` → `cosineDistance(movies.embedding, vec)` kNN (Drizzle, ascending distance over the HNSW index) → top matches with `similarity = 1 - distance`.
* [x] **`fetch_from_tmdb`**: last-resort lookup by `query` or `tmdbId`; maps the TMDB detail to the result and **writes back** (`ingestMovies` → upsert + embed) best-effort so the catalog self-heals without failing the answer.
* [x] **`get_movie_details`** / **`get_trending`**: wrap the TMDB detail/trending services.
* [x] **`manage_watchlist`** / **`get_user_watchlist`**: **done in Phase 5.1** — implemented in `src/agent/userTools.ts` (`createUserTools`), request-scoped and bound to the authed user via `runAgent(messages, { userId })`. `get_user_watchlist` auto-executes (read); **`manage_watchlist` deliberately has no `execute`** — the model only *proposes* the mutation, which the user confirms (HITL — see 4.4 / Phase 7.3).
* [x] Every tool defined with the AI SDK's **`tool({ inputSchema, execute })`** over shared **Zod** schemas (`src/schemas/movie.ts`), with **prescriptive descriptions** encoding cheapest-sufficient-first escalation (SQL → semantic → TMDB). Core logic is in `src/agent/retrieval.ts` (injectable deps), tools in `src/agent/tools.ts` (`retrievalTools`). _Verified offline (`retrieval.test.ts`, `tools.test.ts`, `movie.test.ts`); live pgvector kNN + TMDB pending env._
* [x] **Fix:** `searchMovie` (`src/lib/tmdb.ts`) returned the results array on a cache miss but the whole response wrapper on a hit — now returns the array on both (regression test in `src/lib/tmdb.test.ts`). Also switched `tmdb.ts` to the `./redis` re-export + global `fetch` for testability.

### Milestone 4.3: Agent loop + streaming  _(complete; live model stream pending env)_
* [x] **`src/agent/agent.ts`**: `runAgent(messages)` is a **`streamText`** agent — `model: openai('gpt-5-nano')`, `retrievalTools`, multi-step loop via `stopWhen: stepCountIs(8)`. Stable system prompt (first, for prompt caching) encodes cheapest-sufficient-first escalation; the pipeline (intent gate → tool retrieval → synthesis) is plain TS control flow. Pure helpers `latestUserText` / `summarizeToolPaths` are unit-tested.
* [x] **`POST /api/v1/chat`** (`src/routes/chat.ts`, authenticated via BetterAuth session): `handleChat` runs the intent gate first, then returns `runAgent(...).toUIMessageStreamResponse()` for allowed queries; blocked/empty queries get a **streamed refusal** (`createUIMessageStream`) so `useChat` renders it without ever invoking the `streamText` agent loop. Body validated with the shared **Zod** `ChatRequestSchema`. Mounted in `app.ts`.
* [x] **Log the retrieval path(s) taken** per request (which retrieval tools ran) alongside token usage (in/out/cached) via `streamText`'s `onFinish`.
* [x] Gate→agent orchestration is injectable (`ChatDeps`) and unit-tested (`src/routes/chat.test.ts`): allowed→agent runs, blocked→refusal + agent skipped, empty→refusal without a gate call. _Live gpt-5-nano streaming + tool execution against a seeded DB pending env._

### Milestone 4.4: State, memory & confirmation
* [x] **Conversation memory**: per-user chat turns persisted in Postgres (`conversation` + `chat_message` tables, migration `0004`). `handleChat` loads prior messages (`conversationStore.load`, ownership-checked) and runs the agent over `[...history, newTurn]`; new turns are appended via the stream's `onFinish` (`conversationStore.save`, creates the conversation if new, dedupes on message id). The conversation id is returned in an `X-Conversation-Id` header so the client can resume. Refusals persist the user+refusal turn too, keeping threads coherent. Store injectable; orchestration verified offline (`src/routes/chat.test.ts`), live DB persistence pending env.
* [x] **Human-in-the-loop confirmation** — **done (Phase 5.1 tool + Phase 7.3 UI)**: chat-driven mutations are gated on client approval via the AI SDK tool-confirmation pattern. `manage_watchlist` has no `execute` (it only proposes); the frontend `WatchlistConfirm` handles approve → REST mutate + cache sync → `addToolResult` → the agent auto-continues, and deny → resolved as declined. The backend continuation was hardened too: the resolved tool result is threaded back so `convertToModelMessages` doesn't dangle the call (no OpenAI 400), and a forged "continuation" can't skip the intent gate.

### Milestone 4.5: Review & synopsis summarization  _(complete; live model call pending env)_
* [x] **Spoiler-free summaries**: `summarizeReviews(movieId)` (`src/lib/summary.ts`) fetches TMDB reviews (`getMovieReviews`) and summarizes them into a one-line `vibe` + `pros`/`cons` via `generateObject` (shared `ReviewSummarySchema`). System prompt enforces spoiler-free + reviews-only. **Cached in Redis** keyed by `movie:{id}:summary` (7-day TTL; a short-TTL neutral placeholder for movies with no reviews, so it's never re-summarized needlessly). Exposed both as the `summarize_reviews` agent tool and `GET /api/v1/movies/:id/summary` (for the Phase 7.2 detail screen).
* [x] Uses **`gpt-5-nano`** for this bounded task; logs token usage (in/out/cached). Deps injectable; verified offline (`src/lib/summary.test.ts`) — cache hit/miss, no-reviews placeholder, corrupt-cache regeneration, keying. Live `gpt-5-nano` summary pending a real `OPENAI_API_KEY`.

---

## 🚩 Phase 5: High-Performance User Features

### Milestone 5.1: Watchlist  _(complete; live DB/Redis + HITL UI pending)_
* [x] **CRUD endpoints** (`src/routes/watchlist.ts`, mounted at `/api/v1/watchlist`, authenticated via a session middleware): `GET /` (list), `POST /` (add — 201 new / 200 idempotent), `DELETE /:movieId` (idempotent), `GET /:movieId/status` (membership). Body validated with shared Zod (`WatchlistAddSchema`). Backed by `src/lib/watchlist.ts` respecting `unique_user_movie` (`onConflictDoNothing`).
* [x] **O(1) membership** via a Redis Set per user (`watchlist:{userId}`, `sadd`/`srem`/`sismember`), dual-written with Postgres (the source of truth) and **hydrated from Postgres on a cold miss** so membership is always correct.
* [x] **Conversational watchlist**: request-scoped agent tools (`src/agent/watchlistTools.ts`, bound to the authed user, merged into the agent toolset via `runAgent(messages, { userId })`): `get_user_watchlist` (read, auto-executes) and `manage_watchlist` (mutate). **HITL: `manage_watchlist` has no `execute`** — the model only *proposes* the change; the user confirms and the mutation is applied via the REST endpoint (this satisfies the Phase 4.4 human-in-the-loop requirement). The approve/deny UI + `addToolResult` wiring is **Phase 7.3** (frontend). _Service/tools verified offline (`watchlist.test.ts`, `watchlistTools.test.ts`); live DB/Redis CRUD + membership pending env._

### Milestone 5.2: Reviews & Personalized Recs  _(complete; live DB/Redis/model pending env)_
* [x] **User reviews** in Postgres (`review` table, migration `0005`, one per user/movie via `unique_user_movie_review`, editable by upsert). `src/lib/reviews.ts`: `upsertReview` / `getRecentReviews`, with recent reviews mirrored to a Redis List (`movie:{id}:reviews:recent`, `LPUSH`/`LTRIM`) and hydrated from Postgres on a cold miss. Endpoints (`src/routes/reviews.ts`, `/api/v1/reviews`): `POST /` (auth, upsert), `GET /movie/:movieId` (public, recent).
* [x] **Personalized AI recommendations** ("because you watched X"): `src/lib/recommendations.ts` `recommendForUser` seeds from the user's watchlist, runs **pgvector cosine kNN** per watched movie (`cosineDistance`, excluding already-watched), merges candidates (dedupe keeping the highest-similarity source for attribution), then has the agent (`generateObject`, **`gpt-5-nano`**, shared `RecommendationsSchema`) rank + explain. Empty watchlist / no candidates short-circuit with no model call. Exposed as `GET /api/v1/recommendations` (auth) and the `get_recommendations` agent tool. _Verified offline (`reviews.test.ts`, `recommendations.test.ts`); live DB kNN + ranking pending env._
* [x] **Per-user agent tools** consolidated in `src/agent/userTools.ts` (`createUserTools`): `get_user_watchlist`, `get_recommendations` (both read/auto-execute), and the HITL `manage_watchlist` (renamed from `watchlistTools.ts`).

---

## 🚩 Phase 6: Production Hardening

### Milestone 6.1: Security & limits  _(complete; live rate-limit counters pending env)_
* [x] **Rate limiting**: Redis `INCR` + `EXPIRE` fixed-window limiter (`src/middleware/rateLimit.ts`), keyed per client (forwarded IP) + route bucket, **fail-open** if Redis is down. Applied tightest to the AI chat endpoint: `/api/v1/chat` 15/min, `/api/v1/*` 120/min, `/api/auth/*` 30/5min. Emits `X-RateLimit-*` + `Retry-After`.
* [x] **Secure headers**: Hono `secureHeaders()` middleware on every response (nosniff, frame-deny, referrer policy, …).
* [x] **Auth hardening**: `minPasswordLength` 4 → 8; removed the dev-only `disableOriginCheck` so **origin checks are on** (trusted origins enforced); CORS restricted to an explicit allow-list (`FRONTEND_URL` + localhost) — never `*` with credentials. _(This also lands the Phase 1.2 "harden auth before production" item.)_
* [x] **Input validation** at the boundaries: chat (`ChatRequestSchema`), watchlist/review mutations (shared Zod), and the movies HTTP routes (`/search` query presence + length bound; numeric `:id` params). Agent tool inputs are Zod-validated by the AI SDK.
* Tests: rate limiter (under/over limit, per-IP buckets, headers, fail-open), movies validation 400s, secure-headers presence. _Live Redis counters pending env._

### Milestone 6.2: AI cost & observability  _(complete)_
* [x] **Prompt caching**: audited — every model call keeps its stable system prompt (and the agent's tool definitions) first, with volatile per-request content last (agent, intent gate, review summary, recommendations). `cached=` is now logged per call so cache hits are visible.
* [x] **Token/usage logging** centralized in `src/lib/usage.ts` (`logUsage` + `normalizeUsage`): one parseable `📊 usage label=… model=… in/out/total/cached …` line per AI call, with call-specific meta (retrieval path, candidate count, intent). Adopted by the agent, intent gate, summary, recommendations, and embeddings.
* [x] **Embedding cost control**: confirmed no redundant re-embedding (content-hash Redis cache + ingestion hash-skip); the embeddings usage log now reports `embedded` vs `fromCache` per batch so redundant spend (and the cache-hit ratio) is observable.

### Milestone 6.3: DevOps  _(backend complete; live build/CI run pending)_
* [x] **Docker image** (`backend/Dockerfile`): `FROM oven/bun:1-alpine`, `bun install --frozen-lockfile --production`, copies `src` only (type-only TMDB spec files erased by Bun, excluded), `CMD ["bun", "run", "src/index.ts"]`. `backend/.dockerignore` keeps `.env`/`node_modules`/tests/specs out of the image.
* [x] **CI/CD** (`.github/workflows/ci.yml`): on every PR + push to `main`, runs the **backend** job — `bun install --frozen-lockfile` → `tsc --noEmit` → `bun test` (all offline, no secrets needed). Frozen lockfile confirmed in sync. _Branch protection should require the "Backend — typecheck + test" check to block merge._
* [x] **Frontend CI** (`oxlint` + `tsgo` + `vitest`) — added in **Phase 7.1**: a `frontend` job in `.github/workflows/ci.yml` runs `bun install --frozen-lockfile` → `oxlint` → `bun run typecheck` (regenerates the gitignored route tree via `tsr generate`, then `tsgo --noEmit`) → `vitest run`. Verified locally (lint/typecheck/test all green; `vite build` builds client + SSR). _Branch protection should require both "Backend — typecheck + test" and "Frontend — lint + typecheck + test"._
* Config guarded by `src/devops.test.ts` (base image, CMD, frozen install, secret-exclusion, CI runs tests). _Live `docker build`/run + first green CI run are verification debt._

---

## 🚩 Phase 7: Frontend (TanStack Start + React 19)

Lives in `frontend/`. Shares Zod schemas with the backend via `packages/schemas/`.

### Milestone 7.1: Scaffold
* [x] **Bun workspace** at the repo root (`backend` + `packages/*`); single root lockfile. CI installs once at root and type-checks/tests `packages/schemas` + `backend`.
* [x] **`packages/schemas/`** (`@themovie/schemas`): the shared Zod schemas, **lifted out of the backend** (movie / intent / chat / review / watchlist / recommendation) and consumed by the backend via `@themovie/schemas`. Pinned to **zod 4** to match the AI SDK (a zod-3/zod-4 split made `tsc` crawl). 42 schema tests + backend's 159 stay green.
* [x] **Vite+ workspace** with **oxlint** (lint), **oxfmt** (format, 4-space/single-quote/no-semi to match the repo), **Vitest** (jsdom + Testing Library), **tsgo v7** (`@typescript/native-preview`, type-check). Versions pinned via the root lockfile (`bun install --frozen-lockfile`). `frontend` added to the root Bun workspace.
* [x] **TanStack Start + React 19** app (`frontend/`, plain Vite — no Vinxi): file-based **TanStack Router** under `src/routes/` (root document in `__root.tsx`, `/` index), router factory in `src/router.tsx`, route tree auto-generated (`tsr generate`, gitignored). **TanStack Query** wired via `setupRouterSsrQueryIntegration` (the current SSR-query bridge; replaces the deprecated `routerWithQueryClient`). The index route proves the full data path end-to-end — loader `ensureQueryData` → `useSuspenseQuery` → SSR dehydration — over movies validated with the shared `@themovie/schemas` `MovieResultSchema`. Verified by a live dev-server render (HTML carries the SSR'd cards + dehydrated query cache) and a clean `vite build`.

### Milestone 7.2: Core screens
* [x] **Auth UI** (sign-up / sign-in) against BetterAuth; session-aware routing. `AuthForm` (shared-Zod validated) drives `/signin` + `/signup`; session resolves on the client through a shared `['session']` TanStack Query (the cookie lives on the backend origin, so SSR can't read it — `AppHeader` + `RequireAuth` react to it), and `/watchlist` is client-guarded with a redirect-back. Live-verified: sign-up sets `better-auth.session_token`, get-session/watchlist round-trip works cross-origin (5173→3100).
* [x] **Discovery**: trending grid + search, backed by TanStack Query against the movie endpoints. `/` SSR-prefetches trending (best-effort — a trending outage degrades to the grid's error state, never a route crash); `?q=` drives client search. Movie endpoints return **raw TMDB snake_case**, so `lib/tmdb.ts` validates + maps them onto the shared `MovieResult` shape (incl. a static `genre_ids`→names map for the cards).
* [x] **Movie detail**: details + spoiler-free AI summary; add/remove from watchlist. `/movie/$id` SSRs details (backdrop, runtime/rating, genres, tagline, overview) via `useSuspenseQuery` (+ error/not-found components); the AI summary loads client-side (`ReviewSummary`); `WatchlistButton` toggles membership (or prompts sign-in).
* [x] **Watchlist** screen. `/watchlist` (protected) lists saved films with remove; the list + per-movie membership caches stay in sync after every mutation.

### Milestone 7.3: Chat window  _(headline UX)_
* [x] **Conversational chat UI** built on the AI SDK's **`useChat`** (`@ai-sdk/react` v3 / `ai` v6, pinned to the backend's major) against `POST /api/v1/chat` — `DefaultChatTransport` with `credentials:'include'`; streams tokens live, renders a per-step **tool/retrieval activity** trail (`ToolActivity`), and supports **stop/regenerate**. `/chat` is `RequireAuth`-guarded (the agent's tools are user-bound). Live-verified against the running backend: streaming reply + `search_movies_sql` activity.
* [x] **Tool confirmation UI** for chat-driven watchlist mutations (`WatchlistConfirm`: approve → REST add/remove + cache sync → `addToolResult`; deny → resolve as declined). **Backend HITL continuation fixed** — `handleChat` now threads the client's resolved tool result back to the model (`convertToModelMessages` no longer dangles the tool call → no OpenAI 400), heals the persisted proposal (`onConflictDoUpdate` scoped to the conversation), and **guards against a forged continuation skipping the intent gate** (a continuation is only honored when it resolves a server-proposed `input-available` call found in trusted history). Live-verified the full round-trip: model acknowledges "Done — added …", forged continuations are gated.
* [x] **Forms validated with TanStack Form + Zod** (`ChatComposer` + shared `ChatMessageInputSchema`). Blocked/irrelevant queries are handled gracefully — the intent-gate refusal streams as ordinary assistant text and renders inline (verified live: off-topic → "I'm a movie discovery assistant…").

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
