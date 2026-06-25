# 🎬 TheMovie — AI-Native Movie Discovery Roadmap

> A Netflix-style movie platform with a **conversational AI agent** at its core, built on **Bun's native APIs**.
>
> Ask it *"show me a movie where the hero later becomes the villain"* and it performs **RAG over embedded movie data** (plots, keywords, themes) to find and explain matches — then helps you manage your watchlist, summarizes reviews, and builds a personalized feed.

> ▸ **Current focus:** Phase 6.3 — DevOps: Docker image (`FROM oven/bun:1-alpine`, `CMD ["bun", "run", "src/index.ts"]`) and CI (run backend `bun test` on every PR; frontend `vitest`/`oxlint`/`tsgo` once Phase 7 exists). _(✅ Phase 0–5 · ✅ Phase 6.1 security & limits · ✅ Phase 6.2 cost & observability. Pending: HITL confirmation UI (Phase 7.3).)_ Update this pointer as phases complete so a fresh session knows where to start (see `CLAUDE.md` → "Working cadence & context hygiene")._

> ⚠️ **Verification debt — pending live env.** These were built and verified **offline** (schema, generated SQL, `tsc`, mocked unit tests) under autonomous mode B. Exercise them against a live **Postgres+pgvector**, **Redis**, and a real **`OPENAI_API_KEY`** once available, then tick:
> - [ ] **Phase 0 `/health`** — confirm it returns `ok`/200 when Postgres + Redis are actually up.
> - [ ] **Phase 2.2 `movies` migration** (`0001`) — apply to a live DB; insert + query a row; confirm the GIN index.
> - [ ] **Phase 3.1 pgvector migration** (`0002`) — apply to a live DB; confirm the `vector` extension enables and the HNSW index builds.
> - [ ] **Phase 3.3 `source_hash` migration** (`0003`) — apply to a live DB; confirm the column adds.
> - [ ] **Phase 3.3 ingestion run** — `bun run ingest --pages=1` against live TMDB + Postgres + `OPENAI_API_KEY`: confirm rows upsert with vectors, a re-run is a no-op (all skipped), and `--incremental` pulls now-playing.
> - [ ] **Phase 4.1 intent gate** — call `runIntentGate` with a real `OPENAI_API_KEY`: confirm `gpt-5-mini` classifies a movie query as allowed and an off-topic/injection query as blocked, and that prompt-cache reads register in the usage log.
> - [ ] **Phase 4.2 retrieval tiers** — against a seeded pgvector DB + live TMDB: confirm `search_movies_sql` filters, `semantic_search_movies` returns sensible cosine-ranked hits, and `fetch_from_tmdb` writes back so a repeat query is served locally.
> - [ ] **Phase 4.3 chat endpoint** — `POST /api/v1/chat` (authenticated) with a real `OPENAI_API_KEY` + seeded DB: confirm gpt-5 streams a synthesized answer, tool/retrieval activity surfaces to `useChat`, a blocked query streams the refusal, and the `onFinish` log shows retrieval paths + token usage.
> - [ ] **Phase 4.4 conversation memory** — apply migration `0004`; over a live DB confirm turns persist, a follow-up request loads prior history (multi-turn context works), and another user can't read/append to someone else's conversation.
> - [ ] **Phase 4.5 review summary** — `GET /api/v1/movies/:id/summary` (and the `summarize_reviews` tool) with live TMDB + `OPENAI_API_KEY`: confirm a spoiler-free pros/cons/vibe summary returns, the no-reviews placeholder works, and a second call is served from the Redis cache.
> - [ ] **Phase 5.1 watchlist** — over live DB + Redis: add/remove/list round-trips, `unique_user_movie` makes a re-add idempotent, `GET /:movieId/status` is correct (incl. cold-cache hydration), and another user can't see/mutate your list (auth).
> - [ ] **Phase 5.2 reviews + recs** — apply migration `0005`; confirm review upsert + recent-list cache (and cold-hydrate); and that `GET /api/v1/recommendations` returns sensible "because you watched X" picks over a seeded pgvector catalog + `OPENAI_API_KEY`.
> - [ ] **Phase 6.1 rate limiting** — against live Redis: confirm `/api/v1/chat` 429s after 15/min, `X-RateLimit-*`/`Retry-After` headers are set, counters reset after the window, and the limiter fails open when Redis is down.

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
* [x] **Harden auth before production** (done in Phase 6.1): raised `minPasswordLength` (4 → 8), re-enabled origin checks (removed `disableOriginCheck`), restricted CORS to an allow-list. _(Redis-backed session storage remains an optional future enhancement.)_

---

## 🚩 Phase 2: Movie Data Engine & Persistence

### Milestone 2.1: TMDB Fetching & Caching  _(complete)_
* [x] **TMDB service** using native `fetch` (`src/lib/tmdb.ts`).
* [x] **Stale-while-revalidate** caching in Redis for trending / search / details (1h TTL).

### Milestone 2.2: Database Schema (Drizzle)
* [x] **`movies` table** (`src/db/schema.ts`): `id`, `tmdb_id` (unique), `title`, `overview`, `poster_path`, `backdrop_path`, `release_date`, `genres`/`keywords`/`metadata` (jsonb), timestamps. Migration `0001_add_movies.sql`. _Live apply pending a reachable Postgres._
* [x] **GIN index** on `movies.metadata` (`movies_metadata_gin_idx`) for JSON containment queries.
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
* [x] **`src/agent/intent.ts`**: `runIntentGate(query)` runs a cheap **`gpt-5-mini`** `generateObject({ schema })` call returning `{ intent, relevant, safe, confidence, reason }`. Stable system prompt kept first (volatile query last) for OpenAI prompt caching; token usage (incl. cached reads) logged per call. The classifier is injectable so the gate is unit-tested without an OpenAI call.
* [x] **Block** off-topic, abusive, and prompt-injection queries **before** the expensive `gpt-5` loop (safety + cost control), via `decideGate` → `{ allowed, refusal? }`. Blocks when `!relevant || !safe || intent ∈ {off_topic, injection}` (relevant/safe treated as authoritative — defense in depth); empty queries short-circuit without a model call. Returns a friendly, non-echoing refusal.
* [x] **Shared Zod schema** in `src/schemas/intent.ts` (`IntentResultSchema` + `INTENTS` + pure `isBlocked`/`refusalFor`/`decideGate`). _Defined in the backend for now; lifts to `packages/schemas/` in Phase 7.1 when the frontend is a second consumer (deferred to avoid repo-wide workspace infra ahead of need)._ Verified offline (`src/schemas/intent.test.ts` + `src/agent/intent.test.ts`); live `gpt-5-mini` call pending a real `OPENAI_API_KEY`.

### Milestone 4.2: Retrieval tools (tiered)  _(retrieval tiers complete; watchlist tools deferred to Phase 5; live DB/API pending env)_
* [x] **`search_movies_sql`**: structured/exact lookups (title ILIKE, genre jsonb-containment, year prefix) against Postgres; returns `[]` when no filter is given so the agent escalates. Cheapest, most precise.
* [x] **`semantic_search_movies`**: `embedText(query)` → `cosineDistance(movies.embedding, vec)` kNN (Drizzle, ascending distance over the HNSW index) → top matches with `similarity = 1 - distance`.
* [x] **`fetch_from_tmdb`**: last-resort lookup by `query` or `tmdbId`; maps the TMDB detail to the result and **writes back** (`ingestMovies` → upsert + embed) best-effort so the catalog self-heals without failing the answer.
* [x] **`get_movie_details`** / **`get_trending`**: wrap the TMDB detail/trending services.
* [ ] **`manage_watchlist`** / **`get_user_watchlist`**: **deferred to Phase 5** — these need the watchlist CRUD service (5.1) and per-user auth context, which don't exist yet. The agent loop (4.3) wires the toolset and these slot in when 5.1 lands.
* [x] Every tool defined with the AI SDK's **`tool({ inputSchema, execute })`** over shared **Zod** schemas (`src/schemas/movie.ts`), with **prescriptive descriptions** encoding cheapest-sufficient-first escalation (SQL → semantic → TMDB). Core logic is in `src/agent/retrieval.ts` (injectable deps), tools in `src/agent/tools.ts` (`retrievalTools`). _Verified offline (`retrieval.test.ts`, `tools.test.ts`, `movie.test.ts`); live pgvector kNN + TMDB pending env._
* [x] **Fix:** `searchMovie` (`src/lib/tmdb.ts`) returned the results array on a cache miss but the whole response wrapper on a hit — now returns the array on both (regression test in `src/lib/tmdb.test.ts`). Also switched `tmdb.ts` to the `./redis` re-export + global `fetch` for testability.

### Milestone 4.3: Agent loop + streaming  _(complete; live model stream pending env)_
* [x] **`src/agent/agent.ts`**: `runAgent(messages)` is a **`streamText`** agent — `model: openai('gpt-5')`, `retrievalTools`, multi-step loop via `stopWhen: stepCountIs(8)`. Stable system prompt (first, for prompt caching) encodes cheapest-sufficient-first escalation; the pipeline (intent gate → tool retrieval → synthesis) is plain TS control flow. Pure helpers `latestUserText` / `summarizeToolPaths` are unit-tested.
* [x] **`POST /api/v1/chat`** (`src/routes/chat.ts`, authenticated via BetterAuth session): `handleChat` runs the intent gate first, then returns `runAgent(...).toUIMessageStreamResponse()` for allowed queries; blocked/empty queries get a **streamed refusal** (`createUIMessageStream`) so `useChat` renders it without ever invoking gpt-5. Body validated with the shared **Zod** `ChatRequestSchema`. Mounted in `app.ts`.
* [x] **Log the retrieval path(s) taken** per request (which retrieval tools ran) alongside token usage (in/out/cached) via `streamText`'s `onFinish`.
* [x] Gate→agent orchestration is injectable (`ChatDeps`) and unit-tested (`src/routes/chat.test.ts`): allowed→agent runs, blocked→refusal + agent skipped, empty→refusal without a gate call. _Live gpt-5 streaming + tool execution against a seeded DB pending env._

### Milestone 4.4: State, memory & confirmation
* [x] **Conversation memory**: per-user chat turns persisted in Postgres (`conversation` + `chat_message` tables, migration `0004`). `handleChat` loads prior messages (`conversationStore.load`, ownership-checked) and runs the agent over `[...history, newTurn]`; new turns are appended via the stream's `onFinish` (`conversationStore.save`, creates the conversation if new, dedupes on message id). The conversation id is returned in an `X-Conversation-Id` header so the client can resume. Refusals persist the user+refusal turn too, keeping threads coherent. Store injectable; orchestration verified offline (`src/routes/chat.test.ts`), live DB persistence pending env.
* [ ] **Human-in-the-loop confirmation**: gate chat-driven mutations (e.g. watchlist edits) on client approval via the AI SDK tool-confirmation pattern (`useChat` + `addToolResult`) before committing. **Deferred to Phase 5** — it gates the `manage_watchlist` tool, which needs the watchlist CRUD service (5.1); built alongside those tools.

### Milestone 4.5: Review & synopsis summarization  _(complete; live model call pending env)_
* [x] **Spoiler-free summaries**: `summarizeReviews(movieId)` (`src/lib/summary.ts`) fetches TMDB reviews (`getMovieReviews`) and summarizes them into a one-line `vibe` + `pros`/`cons` via `generateObject` (shared `ReviewSummarySchema`). System prompt enforces spoiler-free + reviews-only. **Cached in Redis** keyed by `movie:{id}:summary` (7-day TTL; a short-TTL neutral placeholder for movies with no reviews, so it's never re-summarized needlessly). Exposed both as the `summarize_reviews` agent tool and `GET /api/v1/movies/:id/summary` (for the Phase 7.2 detail screen).
* [x] Uses the **cheaper `gpt-5-mini`** for this bounded task; logs token usage (in/out/cached). Deps injectable; verified offline (`src/lib/summary.test.ts`) — cache hit/miss, no-reviews placeholder, corrupt-cache regeneration, keying. Live `gpt-5-mini` summary pending a real `OPENAI_API_KEY`.

---

## 🚩 Phase 5: High-Performance User Features

### Milestone 5.1: Watchlist  _(complete; live DB/Redis + HITL UI pending)_
* [x] **CRUD endpoints** (`src/routes/watchlist.ts`, mounted at `/api/v1/watchlist`, authenticated via a session middleware): `GET /` (list), `POST /` (add — 201 new / 200 idempotent), `DELETE /:movieId` (idempotent), `GET /:movieId/status` (membership). Body validated with shared Zod (`WatchlistAddSchema`). Backed by `src/lib/watchlist.ts` respecting `unique_user_movie` (`onConflictDoNothing`).
* [x] **O(1) membership** via a Redis Set per user (`watchlist:{userId}`, `sadd`/`srem`/`sismember`), dual-written with Postgres (the source of truth) and **hydrated from Postgres on a cold miss** so membership is always correct.
* [x] **Conversational watchlist**: request-scoped agent tools (`src/agent/watchlistTools.ts`, bound to the authed user, merged into the agent toolset via `runAgent(messages, { userId })`): `get_user_watchlist` (read, auto-executes) and `manage_watchlist` (mutate). **HITL: `manage_watchlist` has no `execute`** — the model only *proposes* the change; the user confirms and the mutation is applied via the REST endpoint (this satisfies the Phase 4.4 human-in-the-loop requirement). The approve/deny UI + `addToolResult` wiring is **Phase 7.3** (frontend). _Service/tools verified offline (`watchlist.test.ts`, `watchlistTools.test.ts`); live DB/Redis CRUD + membership pending env._

### Milestone 5.2: Reviews & Personalized Recs  _(complete; live DB/Redis/model pending env)_
* [x] **User reviews** in Postgres (`review` table, migration `0005`, one per user/movie via `unique_user_movie_review`, editable by upsert). `src/lib/reviews.ts`: `upsertReview` / `getRecentReviews`, with recent reviews mirrored to a Redis List (`movie:{id}:reviews:recent`, `LPUSH`/`LTRIM`) and hydrated from Postgres on a cold miss. Endpoints (`src/routes/reviews.ts`, `/api/v1/reviews`): `POST /` (auth, upsert), `GET /movie/:movieId` (public, recent).
* [x] **Personalized AI recommendations** ("because you watched X"): `src/lib/recommendations.ts` `recommendForUser` seeds from the user's watchlist, runs **pgvector cosine kNN** per watched movie (`cosineDistance`, excluding already-watched), merges candidates (dedupe keeping the highest-similarity source for attribution), then has the agent (`generateObject`, **`gpt-5-mini`**, shared `RecommendationsSchema`) rank + explain. Empty watchlist / no candidates short-circuit with no model call. Exposed as `GET /api/v1/recommendations` (auth) and the `get_recommendations` agent tool. _Verified offline (`reviews.test.ts`, `recommendations.test.ts`); live DB kNN + ranking pending env._
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
