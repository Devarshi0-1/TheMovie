# TheMovie — Project Instructions

> These project rules layer **on top of** the global workspace rules in `/home/dev/CLAUDE.md` (git workflow, code quality, security, testing). Where this file is silent, the global rules apply. Where it is more specific, this file wins.

## What this project is

TheMovie is an **AI-native movie discovery platform**. The headline feature is a **conversational chat agent** that answers natural-language queries (e.g. *"a movie where the hero later becomes the villain"*) using **RAG**: it embeds the query, runs vector similarity search over embedded movie data in **pgvector**, and reasons over the results with an LLM. It also manages watchlists conversationally, summarizes reviews, and builds personalized recommendations.

The codebase is a workspace with three packages: **`backend/`** (Bun + Hono API), **`frontend/`** (TanStack Start app), and **`packages/schemas/`** (shared Zod schemas). The authoritative plan is **`backend/ROADMAP.md`** — read it before starting work.

## Tech stack (use these — don't introduce alternatives without asking)

### Backend
- **Runtime/server:** Bun + Hono. Prefer **Bun native APIs** over npm packages wherever one exists.
- **DB:** PostgreSQL via **Bun.SQL** (`drizzle-orm/bun-sql`). Never add `pg`/`postgres.js`.
- **Vector store:** **pgvector** (embeddings stored on the `movies` table; cosine kNN via HNSW index).
- **Cache:** **Bun Redis** (`import { redis } from "bun"`). Never add `ioredis`/`redis`.
- **Auth:** BetterAuth (Drizzle adapter). Hashing via **Bun.password** (Argon2), never `bcrypt`.
- **Testing:** **Bun Test** (`bun test`). Never add `jest`/`vitest` to the backend.

### Frontend
- **Framework:** **TanStack Start** + **React 19** (SSR, server functions). TanStack **Router ships inside Start** — don't install it separately; use its file-based, type-safe routing.
- **Data fetching:** **TanStack Query** (server-state caching/mutations).
- **Toolchain:** **Vite+** with **oxlint** (lint), **oxfmt** (format), and **Vitest** (test). These are cutting-edge — pin versions; expect occasional editor-integration gaps with oxfmt/tsgo.
- **Type checking:** **typescript-go (tsgo) v7** — the native TypeScript compiler.

### AI layer (Vercel AI SDK + OpenAI, single vendor)
- **Toolkit:** **Vercel AI SDK** — `ai` + `@ai-sdk/openai` on the backend, `@ai-sdk/react` on the frontend. One toolkit for model calls, tool calling, structured output, embeddings, and streaming. (No LangChain/LangGraph.)
- **Reasoning/agent LLM:** **OpenAI `gpt-5`** via `openai('gpt-5')`, driven by **`streamText`** with tools and multi-step loops (`stopWhen: stepCountIs(...)`). The chat agent is hosted in our Hono backend (the model calls *our* tools) — we orchestrate the loop ourselves. (Model IDs are swappable — pin what your account has.)
- **Embeddings:** **OpenAI `text-embedding-3-small`** (1536-dim) via the AI SDK's `embed` / `embedMany` (`openai.textEmbeddingModel('text-embedding-3-small')`).
- **Streaming:** the backend returns `streamText(...).toUIMessageStreamResponse()` — a standard `Response` Hono returns directly; the frontend consumes it with **`useChat`** (`@ai-sdk/react`).
- **Structured output:** `generateObject({ schema })` with a shared Zod schema (used by the intent gate).

> **One vendor / one toolkit by design.** This project runs entirely on OpenAI through the Vercel AI SDK — reasoning *and* embeddings. Do **not** introduce a second LLM/embeddings provider (Anthropic, Voyage, etc.) or a second agent framework (LangChain/LangGraph) without sign-off.

### Cross-cutting
- **Validation:** **Zod**, everywhere. Define each schema **once in `packages/schemas/`** and reuse it for: API request/response validation (Hono), LLM structured-output validation (AI SDK `generateObject({ schema })`), agent tool schemas (`tool({ inputSchema })`), and frontend form validation (TanStack Form's Zod adapter). One schema → end-to-end type safety.

### The zero-dependency ethos (and its exceptions)

The **backend** deliberately avoids npm packages when Bun ships a native equivalent. Sanctioned exceptions: the AI layer (**Vercel AI SDK** — `ai`, `@ai-sdk/openai`, `@ai-sdk/react` — **OpenAI** for reasoning + embeddings, **pgvector**), **Zod**, and the already-chosen libraries (Hono, Drizzle, BetterAuth). The **frontend** is the TanStack/Vite+ ecosystem named above. Before adding **any** dependency outside these: check whether Bun, the framework, or an existing dep already covers it; if you genuinely need one, surface it for sign-off first.

## How to work on this codebase

1. **Plan before non-trivial changes.** For anything beyond a small/local fix (new endpoints, schema/migrations, the agent, the ingestion pipeline, new UI flows), propose a short plan and get sign-off before implementing. Small, obvious changes — proceed directly and note what you did.
2. **Drive the roadmap autonomously.** When asked to "continue" or "work on the roadmap," pick the next unchecked item in `backend/ROADMAP.md` (respecting phase order — Phase 0 fixes come first), implement it end-to-end, check it off, and only stop to surface real blockers or decisions that are genuinely the user's call. Keep `ROADMAP.md` checkboxes in sync with reality.
3. **Every change ships three things.** For any feature *or* fix:
   - **General/feature tests** — the happy path (`bun test` on the backend, **Vitest** on the frontend).
   - **Edge-case tests** — boundaries, invalid input, empty/failure states, auth/permission gaps.
   - **A UX overview** — a few sentences in the PR describing the change from the **end-user's perspective**: what they can now do, what behavior changed, and any edge behavior they'd notice.
   Run the relevant suite before declaring work done; never break existing tests. Report failures with the actual output — don't claim green when it isn't. Bug fixes ship a regression test.
4. **Be cost-aware with AI calls.** These rules are load-bearing for this project's economics:
   - **Cache embeddings** — never re-embed unchanged text (key by a content hash). Re-embedding the catalog is the biggest avoidable cost.
   - **Right-size the model** — use `gpt-5` for the reasoning agent; use a cheaper model (**`gpt-5-mini`**) for bounded tasks (the intent gate, review summarization, query classification).
   - **Exploit prompt caching** — keep the agent's stable system prompt + tool definitions at the *start* of the prompt so OpenAI's automatic prompt caching applies; keep volatile content (per-request query, timestamps) at the end.
   - **Cache AI outputs** in Redis where reusable (e.g. per-movie review summaries) with sensible TTLs.
   - **Log token usage** (`usage` from each AI SDK call — prompt/completion/cached) per request so cost is observable.

## The chat agent: query-handling pipeline

Every user query flows through three stages, built with the **Vercel AI SDK** as plain TypeScript control flow + tool calling. Per-user conversation history is persisted in Postgres for multi-turn memory (loaded on each request, appended via `streamText`'s `onFinish`).

1. **Intent gate (guardrail, runs first).** A cheap **`gpt-5-mini`** `generateObject` call with a Zod schema decides whether the query is relevant to movie discovery/watchlists and tags its intent (search / details / watchlist / recommendation / chitchat / off-topic / injection). **Block** off-topic, abusive, or prompt-injection requests *before* entering the expensive `gpt-5` loop — this is both a safety boundary and a cost control.
2. **Tiered retrieval (agent-driven, cheapest-sufficient-first).** Relevant queries enter a `streamText` agent loop (`model: openai('gpt-5')`, `stopWhen: stepCountIs(...)`) with retrieval exposed as `tool()`s. The system prompt instructs the agent to prefer the cheapest tier that answers the query:
   - **SQL search** (`search_movies_sql`) — structured/exact intent: a title, a genre, a year, "sci-fi from 2010". Most precise, cheapest.
   - **Semantic/embedding search** (`semantic_search_movies`) — conceptual/thematic intent keywords can't capture: "hero later becomes the villain", "slow-burn dread like Hereditary". OpenAI-embedded query → pgvector cosine kNN (via Drizzle).
   - **TMDB API** (`fetch_from_tmdb`) — last resort, on a local-catalog miss, a brand-new release, or an obscure title. On a hit, **write back** (upsert + embed) so the catalog self-heals and the next query is served locally.
3. **Synthesize.** The agent reasons over the retrieved set and returns ranked suggestions with short explanations, streamed to the client via `toUIMessageStreamResponse()` → `useChat`.

Log which retrieval path(s) ran per request for observability and cost tracking. Never fan out to all three tiers by default — escalate only when the cheaper tier is insufficient. Chat-driven mutations (e.g. watchlist edits) pause for confirmation via the AI SDK's **human-in-the-loop tool pattern** (a tool whose execution is gated on client confirmation through `useChat` + `addToolResult`) before committing.

## Conventions

- **Code style:** Backend uses Prettier (`backend/.prettierrc` — 4-space indent, single quotes, no semicolons). Frontend uses **oxfmt** + **oxlint**. Match whichever package you're in.
- **Structure (backend):** routes in `src/routes/`, service/lib logic in `src/lib/`, the agent (tools + loop) in `src/agent/`, DB in `src/db/`, jobs in `src/jobs/`. Keep TMDB/OpenAI calls in their own service modules — don't scatter `fetch` calls through routes.
- **Structure (frontend):** file-based routes (TanStack Router conventions), TanStack Query hooks colocated with the features that use them, the chat UI on `useChat`, shared UI in a `components/` directory. Keep related files together (component + test + styles).
- **Validation:** validate at every boundary with Zod — API requests/responses, LLM outputs, and frontend forms — importing schemas from `packages/schemas/` rather than redefining them per package.
- **Errors:** handle explicitly — no silent catches.
- **Secrets:** all keys come from env (`OPENAI_API_KEY`, `TMDB_READ_ACCESS_API_KEY`, `DATABASE_URL`, `REDIS_URL`, …). Never hardcode or log them. The `.env` file is gitignored — keep it that way.
- **Migrations:** schema changes go through `drizzle-kit generate` and are committed. Don't hand-edit applied migrations.

## Skills available

`backend/.claude/skills/` ships project skills: **bun-development**, **hono-routing**, and **vercel-react-best-practices**. Use them for the matching area. Also use the **`tanstack-start-best-practices`** and **`frontend-design`** skills for frontend work. For the AI layer, consult the official **Vercel AI SDK** and **OpenAI** docs for current APIs, model IDs, tool calling, structured outputs, and streaming rather than relying on memory.
