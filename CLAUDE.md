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
- **Styling:** **Tailwind CSS v4** (via the `@tailwindcss/vite` plugin) + **shadcn/ui** (radix base, vendored into `src/components/ui/`, managed with the **shadcn CLI** — `bunx --bun shadcn@latest add …`, never hand-write `ui/` files). Use **semantic tokens** (`bg-background`, `text-primary`, `text-muted-foreground`, `border-border`, plus the project's `text-pro`/`text-con`/`bg-accent-soft`) and shadcn primitives (`Button`, `Input`, `Field`, `Badge`, `Alert`, `Empty`, `Skeleton`, …) over hand-rolled CSS; `cn()` from `@/lib/utils` for conditional classes. Theme tokens live in `src/styles/app.css` (light default + dark via `.dark`/`prefers-color-scheme`). The `@/*` import alias maps to `src/*`. Follow the **shadcn** skill's rules (gap not space, semantic colors, `size-*`, `data-icon` in buttons). `src/components/ui/` is vendored — excluded from oxlint. **Before building or changing any UI, read [`frontend/DESIGN_PRINCIPLES.md`](frontend/DESIGN_PRINCIPLES.md)** — the project's UX/accessibility contract (loading→skeletons, error→retry, destructive→undo, live regions/focus/skip-link, CLS-safe images, action-feedback toasts) with canonical examples and a pre-PR checklist.
- **Toolchain:** **Vite+** with **oxlint** (lint), **oxfmt** (format), and **Vitest** (test). These are cutting-edge — pin versions; expect occasional editor-integration gaps with oxfmt/tsgo.
- **Type checking:** **typescript-go (tsgo) v7** — the native TypeScript compiler.

### AI layer (Vercel AI SDK + OpenAI, single vendor)
- **Toolkit:** **Vercel AI SDK** — `ai` + `@ai-sdk/openai` on the backend, `@ai-sdk/react` on the frontend. One toolkit for model calls, tool calling, structured output, embeddings, and streaming. (No LangChain/LangGraph.)
- **Reasoning/agent LLM:** **OpenAI `gpt-5-nano`** via `openai('gpt-5-nano')`, driven by **`streamText`** with tools and multi-step loops (`stopWhen: stepCountIs(...)`). The chat agent is hosted in our Hono backend (the model calls *our* tools) — we orchestrate the loop ourselves. (The project runs `gpt-5-nano` across the board as a deliberate cost choice — see "Right-size the model" below; model IDs are swappable — pin what your account has, and step up a tier if quality demands it.)
- **Embeddings:** **OpenAI `text-embedding-3-small`** (1536-dim) via the AI SDK's `embed` / `embedMany` (`openai.textEmbeddingModel('text-embedding-3-small')`).
- **Streaming:** the backend returns `streamText(...).toUIMessageStreamResponse()` — a standard `Response` Hono returns directly; the frontend consumes it with **`useChat`** (`@ai-sdk/react`).
- **Structured output:** `generateObject({ schema })` with a shared Zod schema (used by the intent gate).

> **One vendor / one toolkit by design.** This project runs entirely on OpenAI through the Vercel AI SDK — reasoning *and* embeddings. Do **not** introduce a second LLM/embeddings provider (Anthropic, Voyage, etc.) or a second agent framework (LangChain/LangGraph) without sign-off.

### Cross-cutting
- **Validation:** **Zod**, everywhere. Define each schema **once in `packages/schemas/`** and reuse it for: API request/response validation (Hono), LLM structured-output validation (AI SDK `generateObject({ schema })`), agent tool schemas (`tool({ inputSchema })`), and frontend form validation (TanStack Form's Zod adapter). One schema → end-to-end type safety.

### The zero-dependency ethos (and its exceptions)

The **backend** deliberately avoids npm packages when Bun ships a native equivalent. Sanctioned exceptions: the AI layer (**Vercel AI SDK** — `ai`, `@ai-sdk/openai`, `@ai-sdk/react` — **OpenAI** for reasoning + embeddings, **pgvector**), **Zod**, and the already-chosen libraries (Hono, Drizzle, BetterAuth). The **frontend** is the TanStack/Vite+ ecosystem named above, **plus the styling stack** — **Tailwind CSS v4**, **shadcn/ui** and its supporting libraries (`radix-ui`, `lucide-react`, `class-variance-authority`, `clsx`, `tailwind-merge`, `tw-animate-css`). New `ui/` primitives come from the shadcn CLI, which pulls these as needed. Before adding **any** dependency outside these: check whether Bun, the framework, or an existing dep already covers it; if you genuinely need one, surface it for sign-off first.

## How to work on this codebase

1. **Plan before non-trivial changes.** For anything beyond a small/local fix (new endpoints, schema/migrations, the agent, the ingestion pipeline, new UI flows), record a short plan (in the branch's PR description) and proceed — operating autonomously, so don't wait for sign-off. Pause only for decisions genuinely the user's call (irreversible infra, spend, product direction). Small, obvious changes — proceed directly and note what you did.
2. **Drive the roadmap autonomously.** When asked to "continue" or "work on the roadmap," pick the next unchecked item in `backend/ROADMAP.md` (respecting phase order — Phase 0 fixes come first), implement it end-to-end, check it off, and only stop to surface real blockers or decisions that are genuinely the user's call. Keep `ROADMAP.md` checkboxes in sync with reality.
3. **Every change ships three things.** For any feature *or* fix:
   - **General/feature tests** — the happy path (`bun test` on the backend, **Vitest** on the frontend).
   - **Edge-case tests** — boundaries, invalid input, empty/failure states, auth/permission gaps.
   - **A UX overview** — a few sentences in the PR describing the change from the **end-user's perspective**: what they can now do, what behavior changed, and any edge behavior they'd notice.
   Run the relevant suite before declaring work done; never break existing tests. Report failures with the actual output — don't claim green when it isn't. Bug fixes ship a regression test.
4. **Be cost-aware with AI calls.** These rules are load-bearing for this project's economics:
   - **Cache embeddings** — never re-embed unchanged text (key by a content hash). Re-embedding the catalog is the biggest avoidable cost.
   - **Right-size the model** — the project currently runs **`gpt-5-nano`** across the board (the reasoning agent *and* the bounded tasks: intent gate, review summarization, recommendations) as a deliberate cost choice. If a task's quality suffers, step *that* call up a tier (`gpt-5-mini`, then `gpt-5`) rather than raising the floor everywhere.
   - **Exploit prompt caching** — keep the agent's stable system prompt + tool definitions at the *start* of the prompt so OpenAI's automatic prompt caching applies; keep volatile content (per-request query, timestamps) at the end.
   - **Cache AI outputs** in Redis where reusable (e.g. per-movie review summaries) with sensible TTLs.
   - **Log token usage** (`usage` from each AI SDK call — prompt/completion/cached) per request so cost is observable.

## Working cadence & context hygiene

Treat the **repo as the source of truth, not the context window.** Every durable fact lives in files (this doc, `backend/ROADMAP.md`, tests, commits), so work proceeds in milestone-sized units and context can be reset between them with zero loss.

**One loop per ROADMAP milestone:**
1. **Fresh context** — read `CLAUDE.md` + `backend/ROADMAP.md` (start at the `▸ Current focus` pointer), then only the files the item touches.
2. **Plan** — record a short plan in the PR description and proceed (no sign-off wait).
3. **Build** — on a `feat/` / `fix/` branch; read narrowly; delegate broad searches to subagents.
4. **Test + verify** — the three test artifacts, `bun test`, confirm behavior.
5. **Checkpoint** — tick the `ROADMAP.md` boxes, commit, open a PR.
6. **Self-merge + reset** — once the verify gate passes, self-merge the PR (`gh pr merge --squash --delete-branch`), then clear context and start the next milestone clean.

**Operating mode: autonomous.** There is no human reviewer — *the verify step is the quality gate.* Before self-merging: `bun test` green, the change exercised and observed working, and a self-review of the diff (spawn a reviewer subagent for risky or large changes). Always branch → PR → self-merge (never commit straight to `main`) so every milestone keeps an audit trail and a clean rollback point.

A merged PR is a save point. Once work is committed, prefer **`/clear` at the milestone boundary** over `/compact`; use `/compact` only mid-milestone if context fills before a natural checkpoint.

**Keep context lean:**
- **Delegate fan-out reads to subagents** (Explore / general-purpose) — they return conclusions, not file dumps.
- **Never read these whole** — `backend/tmdb.d.ts` (~960 KB), `backend/tmdb-bundled.yaml` (~3.9 MB), `backend/bun.lock`. `grep` / targeted-read only.
- **Externalize the plan** with a todo list rather than holding it in prose.
- **Run long-lived processes** (dev server, ingestion jobs) in the background so their output doesn't flood context.
- **Trust this file — don't re-derive** settled decisions (OpenAI-only, Zod everywhere, three-artifact tests).

## Working pitfalls (learned the hard way)

These are real traps that have cost time on this repo. Read them before they bite again.

- **Check the environment before claiming you can't test something.** The local stack is real: `docker ps` shows `themovie-pg` (:5433) + `my-movie-redis` (:6379); `backend/.env` has the keys; `GET /health` reports DB+Redis. Never assert "no live DB / can't verify" without looking — and you *can* exercise the running app end-to-end (health, the movie API, auth, the chat stream).
- **A failing test? Suspect the test and its data before the production code.** `chat_message.id` (and other message ids) are **GLOBAL primary keys** — mint unique ids per test (`crypto.randomUUID()`), never hardcode or reuse them across conversations, and clean up rows between runs. Most "the code is broken" moments here turned out to be the test, not the code (e.g. `conversation.save()` was blamed repeatedly and was always correct).
- **CI runs offline — no DB, no Redis, no secrets.** The default `bun test` MUST pass with zero env. Don't add import-time `throw if !ENV` guards that break test *collection*; gate live-DB tests behind `RUN_DB_INTEGRATION=1` and give CI a placeholder `DATABASE_URL` (see `.github/workflows/ci.yml`). Local-green ≠ CI-green — **check the PR's CI before merging, and never merge over a red/UNSTABLE check.**
- **Keep diffs focused: format only the files you touched.** The repo has pre-existing oxfmt/prettier drift and CI does **not** run `format:check`, so a full-tree `oxfmt src` / `prettier --write` reformats unrelated files and bloats the PR (and produces CRLF/LF churn on Windows). Revert that drift before committing.
- **Re-verify "deferred because impossible" notes against installed versions** before repeating them. Blockers evaporate on upgrade (e.g. `@vitejs/plugin-react` v6 *does* export `reactCompilerPreset`; `tsgo` v7 *removed* `baseUrl`). Confirm library APIs against installed types/docs, not memory.
- **Test runners differ:** backend = `bun test`; **frontend = `bun run test`** (Vitest — `bun test` silently runs the wrong runner). New `@/` path aliases must be mirrored in `vite.config`, `vitest.config`, **and** `tsconfig`.
- **Ports must agree:** the backend listens on **`:3100`** (`backend/.env` `PORT`), `BETTER_AUTH_URL` must match that same port, and the frontend's `VITE_API_URL` points at it; the dev server is `:5173` (backend `FRONTEND_URL` + CORS). If the app can't reach the API, check these first.

## The chat agent: query-handling pipeline

Every user query flows through three stages, built with the **Vercel AI SDK** as plain TypeScript control flow + tool calling. Per-user conversation history is persisted in Postgres for multi-turn memory (loaded on each request, appended via `streamText`'s `onFinish`).

1. **Intent gate (guardrail, runs first).** A cheap single **`gpt-5-nano`** `generateObject` call with a Zod schema decides whether the query is relevant to movie discovery/watchlists and tags its intent (search / details / watchlist / recommendation / chitchat / off-topic / injection). **Block** off-topic, abusive, or prompt-injection requests *before* entering the multi-step `gpt-5-nano` agent loop — this is both a safety boundary and a cost control.
2. **Tiered retrieval (agent-driven, cheapest-sufficient-first).** Relevant queries enter a `streamText` agent loop (`model: openai('gpt-5-nano')`, `stopWhen: stepCountIs(...)`) with retrieval exposed as `tool()`s. The system prompt instructs the agent to prefer the cheapest tier that answers the query:
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

`backend/.claude/skills/` ships project skills: **bun-development**, **hono-routing**, and **vercel-react-best-practices**. Use them for the matching area. Also use the **`tanstack-start-best-practices`** and **`frontend-design`** skills for frontend work, and follow the project's **[`frontend/DESIGN_PRINCIPLES.md`](frontend/DESIGN_PRINCIPLES.md)** (UX/accessibility contract). For the AI layer, consult the official **Vercel AI SDK** and **OpenAI** docs for current APIs, model IDs, tool calling, structured outputs, and streaming rather than relying on memory.
