# TheMovie — Project Overview

> A single reference for **what we've built**, the **tech stack**, and **how the project maps onto the
> GenAI learning curriculum** (Phases 1–6 + Memory Patterns).
>
> Companion docs: [`README.md`](../README.md) (quick start), [`CLAUDE.md`](../CLAUDE.md) (project rules
> + agent pipeline), [`backend/ROADMAP.md`](../backend/ROADMAP.md) (the build plan — Phases 0–7, **complete**),
> [`backend/VERIFICATION.md`](../backend/VERIFICATION.md) (live end-to-end runbook).

---

## 1. What TheMovie is

TheMovie is an **AI-native movie discovery platform**. Its headline feature is a **conversational chat
agent** that answers natural-language queries — *"a movie where the hero later becomes the villain"* — using
**retrieval-augmented generation (RAG)**: it embeds the query, runs **vector similarity search** over
embedded movie data in **pgvector**, reasons over the results with an LLM, and streams back ranked
suggestions with short explanations. The same agent manages watchlists conversationally, summarizes
reviews spoiler-free, and builds personalized recommendations.

The codebase is a Bun workspace with three packages: **`backend/`** (Bun + Hono API — the agent, RAG,
ingestion, auth), **`frontend/`** (TanStack Start + React 19 app), and **`packages/schemas/`** (shared
Zod schemas used end-to-end). The build plan in `backend/ROADMAP.md` is **100% complete (Phases 0–7)** and
**live-verified** against real Postgres+pgvector / Redis / OpenAI / TMDB.

---

## 2. Features built

### Conversational chat agent (the headline)
- **Natural-language discovery** — ask by *describing* a film, not naming it.
- **Three-stage pipeline** — an **intent gate** (cheap guardrail) → **tiered retrieval** (cheapest tool
  that answers wins) → **synthesis** streamed back token-by-token.
- **Live streaming** with a per-step **tool / retrieval activity trail** (which tool ran, running / done /
  error), plus **stop / regenerate**.
- **Multi-turn memory** — conversation history persisted in Postgres and reloaded each turn.
- **Human-in-the-loop (HITL) watchlist edits** — the agent *proposes* a watchlist change; the user
  approves or denies in the UI before anything is committed.
- **Intent guardrail** — off-topic, abusive, and prompt-injection queries are blocked *before* the
  expensive agent loop (a safety boundary and a cost control).

### Discovery & browse
- **Trending grid** on the home screen (server-rendered / SSR-prefetched, no flicker).
- **Keyword search** (`?q=`) against TMDB.
- **Movie detail pages** — backdrop, poster, runtime, rating, genres, tagline, overview.

### Semantic search
- **Embedding-based thematic retrieval** over the local catalog — finds films by *concept/vibe*
  ("slow-burn dread", "hero becomes the villain") that keywords can't capture.

### AI review summaries
- **Spoiler-free** audience-review summaries: a one-line *vibe* plus *pros* / *cons*, cached in Redis.

### Personalized recommendations
- Seeds from the user's watchlist → **pgvector kNN** per watched film → merge candidates → an LLM
  **ranks and explains** ("because you watched …"). Short-circuits (no model call) on an empty watchlist.

### Watchlist
- **Conversational** (via the HITL tool) **and** classic **UI CRUD** (add / remove / list).
- **O(1) membership checks** via a Redis Set, with Postgres as the source of truth.

### Reviews
- Users write reviews (rating + text); a **recent-reviews list** is cached and re-hydrated on cold miss.

### Authentication
- **BetterAuth** email/password with session-aware routing (protected `/chat` and `/watchlist`,
  post-auth redirect back to where you were).

### Self-healing catalog
- On a local miss, `fetch_from_tmdb` pulls live data and **writes it back** (upsert + embed) so the next
  query is served locally — the catalog grows and heals itself.

### Production hardening
- **Rate limiting** (Redis fixed-window, **fails open** if Redis is down), **secure headers**, strict CORS.
- **Token / cost observability** — one parseable `📊 usage` line per AI call (in / out / total / cached).
- **Embedding cost control** — content-hash cache; unchanged text is never re-embedded.
- **Docker image** + **GitHub Actions CI** (typecheck + lint + tests, backend & frontend).

---

## 3. Tech stack

| Layer | Technology |
|---|---|
| **Runtime / server** | **Bun** + **Hono** (native `Bun.serve()`) |
| **Database** | **PostgreSQL** via **Bun.SQL** (`drizzle-orm/bun-sql`) — no `pg`/`postgres.js` |
| **Vector store** | **pgvector** — 1536-dim embeddings on the `movies` table, **HNSW** cosine index |
| **ORM** | **Drizzle** (bun-sql driver; includes the `vector` column type) |
| **Cache** | **Bun Redis** (`import { redis } from "bun"`) — no `ioredis`/`redis` |
| **Auth** | **BetterAuth** (Drizzle adapter), hashing via **Bun.password** (Argon2) |
| **AI toolkit** | **Vercel AI SDK** — `ai` + `@ai-sdk/openai` (backend), `@ai-sdk/react` (frontend) |
| **Reasoning / agent LLM** | **OpenAI `gpt-5-nano`** via `streamText` + tools, multi-step loop (`stopWhen: stepCountIs(...)`) |
| **Embeddings** | **OpenAI `text-embedding-3-small`** (1536-dim) via the AI SDK's `embed` / `embedMany` |
| **Structured output** | `generateObject({ schema })` with shared Zod schemas (intent gate, summaries, recs) |
| **Frontend** | **TanStack Start** + **React 19** (SSR, file-based routing) + **TanStack Query** |
| **Frontend tooling** | **Vite+**, **oxlint** (lint), **oxfmt** (format), **Vitest** (test), **tsgo v7** (typecheck) |
| **Validation** | **Zod**, everywhere — defined once in `packages/schemas/`, reused end-to-end |
| **Backend testing** | **Bun Test** (`bun test`) |
| **Deploy / CI** | **Docker** (`oven/bun:1-alpine`) + **GitHub Actions** |

> **One vendor / one toolkit by design.** Reasoning *and* embeddings run on **OpenAI** through the
> **Vercel AI SDK**. No second LLM/embeddings provider and no second agent framework (LangChain/LangGraph)
> — a deliberate architectural choice, not an omission.

---

## 4. Architecture at a glance

### Query pipeline (per chat request)

```
user query
   │
   ▼
[1] Intent gate  ──► off-topic / abusive / injection?  ──► refuse (stream as text, no agent loop)
   │  generateObject(gpt-5-nano, IntentResultSchema)
   ▼ relevant + safe
[2] Agent loop  (streamText, gpt-5-nano, stopWhen: stepCountIs(10))
   │  picks the cheapest sufficient retrieval tool, escalates only if needed:
   │     search_movies_sql      — structured/exact (title, genre, year)        ← cheapest
   │     semantic_search_movies — embed query → pgvector cosine kNN (HNSW)
   │     fetch_from_tmdb        — live TMDB, writes back (upsert + embed)        ← last resort
   │  (+ get_movie_details, get_trending, summarize_reviews,
   │     get_user_watchlist, get_recommendations, manage_watchlist[HITL])
   ▼
[3] Synthesize  ──► ranked suggestions + short explanations, streamed via toUIMessageStreamResponse()
   │  retrieval path(s) + token usage logged for cost/observability
   ▼
useChat (frontend) renders text + tool-activity trail + HITL confirmation
```

### Ingestion pipeline (catalog build)

```
TMDB pages ──► enrich (details + keywords) ──► compose text ──► chunkText / cap
          ──► content-hash (skip unchanged) ──► embed (cached) ──► upsert on tmdb_id
```

### Data stores
- **PostgreSQL + pgvector** — movies (with embeddings), users/sessions, watchlist, reviews, conversations.
- **Redis** — embedding cache (content-hash key, 30-day TTL), review summaries, recent-reviews list,
  watchlist membership Set, rate-limit counters, trending cache.

---

## 5. GenAI curriculum coverage

What this project **demonstrates hands-on**, phase by phase. (Topics it intentionally leaves for later are
collected in [§6 Next steps](#6-next-steps--extending-the-project).)

### Phase 1 — How LLMs Work
| Topic | How / where |
|---|---|
| Embeddings (words → numbers) | The foundation of the whole app — `text-embedding-3-small` powers semantic search (`backend/src/lib/embeddings.ts`). |
| Tokens & tokenization | Made observable — every AI call logs `in/out/total/cached` tokens (`backend/src/lib/usage.ts`). |
| Next-token prediction | Live streamed generation via the AI SDK's `streamText` (`backend/src/agent/agent.ts`). |
| Pre-training vs fine-tuning | Built on **pretrained** foundation models with **no fine-tuning** — a deliberate cost/simplicity choice. |

### Phase 2 — Embeddings & Vector Databases
| Topic | How / where |
|---|---|
| What an embedding really is | 1536-dim query/movie vectors drive all conceptual matching. |
| Similarity search | **Cosine** similarity (`1 - distance`) over movie vectors. |
| Nearest-neighbor (ANN / **HNSW**) | HNSW index with `vector_cosine_ops` (`backend/drizzle/0002_add_embedding.sql`). |
| Vector database (**pgvector**) | Embeddings co-located on the `movies` table — pgvector is one of this phase's named tools (`backend/src/db/schema.ts`, `backend/src/agent/retrieval.ts`). |

### Phase 3 — RAG (Retrieval-Augmented Generation)
| Topic | How / where |
|---|---|
| Why RAG exists (grounding) | The agent answers from retrieved catalog data, not model memory. |
| Core RAG pipeline | embed query → retrieve → augment prompt → generate (`backend/src/agent/agent.ts`). |
| Chunking & context management | `chunkText` splits on paragraph → sentence → word; embedding text is capped (`backend/src/jobs/ingest.ts`). |
| Indexing | HNSW (vectors) + GIN (genres) indexes for fast retrieval. |
| Retrievers | Three retrieval tools exposed to the agent (`backend/src/agent/retrieval.ts`). |
| Semantic search | `semantic_search_movies` — query embedding → pgvector kNN. |
| Multi-stage retrieval | Tiered escalation: SQL → semantic → TMDB, cheapest-sufficient-first. |
| Augmenting the prompt with context | Retrieved movies are fed back into the loop as tool results. |
| Cost-vs-latency tradeoffs | The cheapest tier that answers wins; the agent never fans out to all three by default. |

### Phase 4 — Frameworks & Orchestration
| Topic | How / where |
|---|---|
| What orchestration does | Hand-rolled on the **Vercel AI SDK** (in place of LangChain/LlamaIndex) — we own the loop. |
| Document loaders | TMDB ingestion job loads + enriches source documents (`backend/src/jobs/ingest.ts`). |
| Text splitters | `chunkText` (same file). |
| Vector stores in a pipeline | pgvector wired into both ingestion (write) and retrieval (read). |
| Retrieval chains | The `streamText` tool loop *is* the chain — tool call → result → next step. |
| Prompt templates | Stable system prompts kept first (for OpenAI prompt caching). |
| State & memory in a workflow | Per-user conversation history persisted in Postgres and reloaded each turn. |

### Phase 5 — AI Agents
| Topic | How / where |
|---|---|
| What makes an "agent" | A multi-step `streamText` loop that *chooses tools*, not a single LLM call (`backend/src/agent/agent.ts`). |
| Tool use / function calling | Nine Zod-typed tools (`tool({ inputSchema })`). |
| Planning / task decomposition (light) | Intent gate classifies first; the loop runs up to `stepCountIs(10)` steps, escalating tiers. |
| Human-in-the-loop | `manage_watchlist` has **no server `execute`** — the model proposes, the client confirms (`backend/src/agent/userTools.ts`). |
| Memory / persistence | Conversation store in Postgres (ownership-checked). |
| Agentic RAG | Retrieval is *agent-driven* — the model decides which tier to call and when. |

### Phase 6 — Cloud & Production
| Topic | How / where |
|---|---|
| Guardrails | The intent gate blocks off-topic / injection before the loop (`backend/src/agent/intent.ts`). |
| Caching strategies (cost & perf) | Redis embedding cache (content-hash) + review-summary cache + trending cache. |
| Monitoring & observability | One parseable `📊 usage` line per AI call — tokens, cached, retrieval path (`backend/src/lib/usage.ts`). |
| Scaling for concurrent queries | Redis fixed-window rate limiting, **fail-open** if Redis is down (`backend/src/middleware/rateLimit.ts`). |

### Memory Patterns (cross-cutting)
| Topic | How / where |
|---|---|
| Short-term memory | Per-user conversation history (Postgres), reloaded each turn. |
| Working memory | The agent loop's in-request context (messages + tool results). |
| Context retrieval policies | Tiered, cheapest-first retrieval governs *what* context is pulled. |
| Caching strategies (result caching) | Content-hash embedding cache + cached review summaries / recent reviews. |
| Retrieval monitoring & observability | Retrieval path(s) + usage logged per request. |
| Long-term memory *(partial)* | Watchlist + reviews persist as durable user signal that feeds recommendations. |

---

## 6. Next steps — extending the project

The curriculum topics not yet covered, reframed as concrete experiments in **this** codebase. None are
required for the product as shipped; they're the natural learning extensions.

- **Phase 1 — LLM internals (study, not build):** attention / self-attention, the transformer block,
  scaling laws, RLHF. Theory behind the models we consume — read, don't implement.
- **Phase 3 — advanced RAG:** add **BM25 keyword search** and **hybrid (dense + sparse)** retrieval fused
  with **Reciprocal Rank Fusion (RRF)**; add a **reranking** stage over the kNN candidates; try
  **HyDE / query expansion**; build a **RAG-eval harness** (context relevance / groundedness / answer
  relevance); explore **sentence-window / auto-merging** and **async RAG**.
- **Phase 4 — orchestration contrast:** prototype the same loop as a **LangGraph** stateful graph and add
  **LangSmith** tracing, to compare against the hand-rolled AI SDK loop.
- **Phase 5 — richer agency:** agent **reflection**, **multi-agent collaboration**, a formal
  **agent-evaluation** suite, and exposing tools over **MCP**.
- **Phase 6 — managed cloud:** stand the RAG stack up on a **managed platform** (Bedrock / Vertex
  Knowledge Bases & Guardrails), move to **serverless / event-driven** deploy, and run scheduled
  **evaluation jobs**.
- **Memory:** add a durable **long-term / episodic memory** store and **semantic (result) caching** keyed
  by query similarity.

---

## 7. Project status

- **Build plan complete** — `backend/ROADMAP.md` Phases 0–7 all shipped.
- **Tests green** — **165** backend (Bun Test) + **108** frontend (Vitest) + **42** schema tests.
- **Live-verified** — the full backend was exercised end-to-end against real
  Postgres+pgvector / Redis / OpenAI / TMDB per [`backend/VERIFICATION.md`](../backend/VERIFICATION.md);
  that run surfaced and fixed six bugs that only appear against real services.
- **What's left is polish, not roadmap** — cross-session chat resume, an end-to-end browser test of the
  approve-in-UI HITL flow, and product-driven additions.
