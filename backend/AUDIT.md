# Backend Audit — TheMovie

**Date:** 2026-06-27
**Scope:** `backend/` (Bun + Hono API; Drizzle + Bun.SQL + pgvector; Bun Redis; BetterAuth; Vercel AI SDK `ai` v6 + `@ai-sdk/openai` v3, `gpt-5-nano` + `text-embedding-3-small`; Bun Test). ~3,800 LOC across `agent/` (685), `db/` (271), `jobs/` (662), `lib/` (1,473), `middleware/` (90), `routes/` (524); 25 test files.
**Method:** Read-only audit, six parallel review passes (stack/tooling, Hono routing/composition/validation, DB & pgvector, AI agent layer & cost-awareness, auth/security & jobs, error handling & tests), graded against `CLAUDE.md`, the `hono-routing` / `bun-development` skills, current Vercel AI SDK + OpenAI docs, and BetterAuth guidance.

**Overall verdict:** A genuinely well-built backend. Thin handlers delegate to service modules; schemas come from `@themovie/schemas`; the pgvector layer is textbook; embedding/summary caching is content-hash/TTL disciplined; the job scheduler is crash-safe single-flight; tests use an offline DI-fake pattern that asserts real behavior. The **runtime data layer is stack-compliant** (Bun.SQL, Bun Redis, global fetch, no bcrypt). Real exposure is concentrated in **tooling**, a few **hot-path DB indexes**, **HTTP/stream error consistency**, **deployment-shaped auth/security gaps**, and **two high-value test holes**.

> Companion artifact: `frontend/AUDIT.md`. Shared decisions D1–D3 (below) span both packages.

---

## Decisions in play (from the frontend audit, extended to backend)

| # | Decision | Backend impact |
|---|----------|----------------|
| D1 | tsgo v7 across the monorepo | Backend still on `tsc 5.7` → migrate (BST-4). |
| D2 | oxlint type-aware linting | Backend has **no linter at all** → adopt oxlint here too (BST-6). |
| D3 | Shared strict `tsconfig.base.json` | Backend tsconfig is near-empty → extend the base (BST-5). |

---

## Severity legend
🔴 HIGH · 🟡 MEDIUM · 🟢 NIT — Status: ☐ open

---

## 1. Stack / zero-dependency compliance & tooling

| Sev | ID | File:line | Finding | Fix |
|-----|----|-----------|---------|-----|
| 🔴 | BST-1 | `package.json:23,28` | `pg ^8.16.3` + `@types/pg` are present — explicitly forbidden ("Never add `pg`/`postgres.js`"). **Unused**: `db/index.ts:1` imports `drizzle-orm/bun-sql`, `drizzle(process.env.DATABASE_URL!)`; zero `from 'pg'`/`Pool` hits; the only `'pg'` is a Drizzle dialect label (`lib/auth.ts:8`). | Delete both deps. |
| 🟡 | BST-2 | `package.json:20`, `db/index.ts:2` | `dotenv ^17` + `import 'dotenv/config'` — Bun auto-loads `.env` natively; redundant. | Remove dep + import. |
| 🟡 | BST-3 | `lib/auth.ts:11-15` | Password hashing falls back to BetterAuth **scrypt**, not the mandated `Bun.password` (Argon2). "Never bcrypt" holds (none present); scrypt is fine, but deviates from the stated standard. (Also tracked as BSEC-1.) | Wire `emailAndPassword.password = { hash: pw => Bun.password.hash(pw), verify: ({password,hash}) => Bun.password.verify(password,hash) }`. |
| 🟡 | BST-4 | `package.json:13,31` | `typecheck` is `tsc --noEmit` on `typescript ^5.7.0` — not tsgo. Frontend already on `@typescript/native-preview` + `tsgo` (D1). | Swap backend to `@typescript/native-preview` + `tsgo --noEmit`. |
| 🟡 | BST-5 | `tsconfig.json` | Only `strict` + jsx (12 lines). Missing the frontend's `noUnusedLocals`, `noUnusedParameters`, `verbatimModuleSyntax`, `isolatedModules`, `noFallthroughCasesInSwitch`, `forceConsistentCasingInFileNames`; neither package sets `noUncheckedIndexedAccess`. | Extend the shared `tsconfig.base.json` (D3). |
| 🟡 | BST-6 | (whole package) | **No linter** — no `.oxlintrc`/`.eslintrc`/`eslint.config.*`, no `lint` script. `.prettierrc` exists but **`prettier` is in no `package.json`** → orphaned, unenforceable config. Backend (the security-sensitive package) has zero static analysis beyond `tsc`. | Adopt `oxlint` (+ type-aware, D2) and `oxfmt`/`prettier` with `lint`/`format` scripts, for parity with frontend. |
| 🟢 | BST-7 | `package.json:29` | `concurrently` dev-dep powers `dev`; a backgrounded bun/shell approach could replace it. Minor dev-only convenience. | Optional. |

**Compliant (verified):** Bun.SQL (`db/index.ts`), Bun Redis (`lib/redis.ts:1` `import { RedisClient } from 'bun'`, no ioredis/redis), global `fetch` (`lib/tmdb.ts:4`), no bcrypt anywhere.

---

## 2. Hono routing, composition & validation

| Sev | ID | File:line | Finding | Fix |
|-----|----|-----------|---------|-----|
| 🟡 | BRT-1 | `app.ts` (whole) | No `app.onError` — unhandled throws in watchlist/reviews/recommendations/chat/`/api/me` yield Hono's default plain-text 500, inconsistent with `movies.ts`'s `{error}` JSON, and **bypass app logging**. (Also BERR-1.) | Add `app.onError((err,c)=>{ console.error(err); return c.json({error:'Internal Server Error'},500) })`; routes can then drop repetitive try/catch. |
| 🟡 | BRT-2 | `chat.ts:251,269`, `reviews.ts:10`, `recommendations.ts:9`, `app.ts:51` | `getSession` + 401 copy-pasted 4×+, while `watchlist.ts:9-14` already models the clean `use('*')` middleware that 401s once and stashes `userId` in typed `Variables`. | Extract a `requireAuth` middleware; handlers read `c.get('userId')`. |
| 🟡 | BRT-3 | `movies.ts:52,72`, `watchlist.ts:36,47`, `reviews.ts:25` | Positive-integer movie-id validation hand-rolled in 5 handlers; no shared helper despite "define once." | Add `MovieIdParamSchema` (`z.coerce.number().int().positive()`) to `@themovie/schemas`; validate `param` once. |
| 🟢 | BRT-4 | `app.ts` | No `app.notFound` — unknown paths return plain-text 404, not the JSON `{error}` shape. | Add `app.notFound((c)=>c.json({error:'Not Found'},404))`. |
| 🟢 | BRT-5 | `reviews.ts:6` | Declares `Hono<{ Variables: { userId } }>` but never `c.set/get('userId')` — inlines `getSession` instead. | Adopt the middleware pattern or drop the unused generic. |
| 🟢 | BRT-6 | `movies.ts:52` vs `:72` | Two id-validation idioms (regex `/^\d+$/` vs `Number()`+`isInteger`) in one file. | Converge on the shared schema (BRT-3). |
| 🟢 | BRT-7 | `chat.ts:272` | `GET /:conversationId` passes the raw param to `store.load` with no shape check (safe — ownership-scoped, `[]` on miss). | Add a `param` validator for consistency. |

**Done well:** routes are thin (zero inline `fetch`/`openai`/`streamText`/`generateObject` in any route); no inline Zod (all from `@themovie/schemas`); middleware order sound (`secureHeaders → cors(allowlist) → rateLimit → routes`); static routes before dynamic (no param shadowing); `jobs.ts` uses DI (`createJobsRoute(trigger)`). The manual `safeParse`-on-imported-schema choice (vs `@hono/zod-validator`) is a consistent zero-dep decision, not a defect.

---

## 3. DB & pgvector

| Sev | ID | File:line | Finding | Fix |
|-----|----|-----------|---------|-----|
| 🔴 | BDB-1 | `db/schema.ts:59`, `drizzle/0000:17-26` | `session.token` has **no index** (not even `unique`); BetterAuth validates by `token` on every authed request → sequential scan that degrades linearly. | Add `unique('session_token_unique').on(t.token)`; generate a migration. |
| 🟡 | BDB-2 | `db/schema.ts` (session/account), `drizzle/0000` | FK columns `session.user_id`, `account.user_id` unindexed (Postgres doesn't auto-index FKs); hit during session/account resolution + cascade deletes. | Add indexes on both; consider composite `account(provider_id, account_id)`. |
| 🟡 | BDB-3 | `jobs/refresh-summaries.ts:70-85` | `listCandidates` (`review_summary_at IS NULL OR < cutoff`) has no `LIMIT` and no index on `review_summary_at` → full scan loading all due rows into memory per run. | Add a btree index on `review_summary_at`; batch/paginate. |
| 🟡 | BDB-4 | `lib/conversation.ts:47-91` | `save()` does 4 sequential writes (insert conversation → re-read owner → insert messages → bump `updatedAt`) outside a transaction → partial-failure / TOCTOU on the ownership re-check. | Wrap in `db.transaction(...)`. |
| 🟡 | BDB-5 | `db/schema.ts` (all tables) | Every `timestamp()` is `timestamp without time zone`; `Date`s can drift if DB/server TZ isn't UTC. | Prefer `timestamp({ withTimezone: true })`. |
| 🟢 | BDB-6 | `jobs/ingest.ts:105` | `movies.metadata` stores the full raw TMDB blob (large jsonb); GIN index already (correctly) dropped in `0006`; excluded from projections → storage cost only. | Optional: trim to needed fields. |
| 🟢 | BDB-7 | `agent/retrieval.ts:140` | `ilike('%'+title+'%')` lets user `%`/`_` act as wildcards (parameterized, not injection — search-semantics quirk). | Escape LIKE metacharacters if exact substring intended. |
| 🟢 | BDB-8 | misc | `releaseDate` is `text` w/ year-prefix LIKE (acceptable); `1 - distance` "[0,1]" comment is really [-1,1] (harmless); `movies.id` random-UUID PK vestigial (queries key on indexed `tmdb_id`). | Optional cleanups. |

**Done well:** both `embedding` and `reviewSummaryEmbedding` are `vector(1536)` with HNSW + `vector_cosine_ops`; kNN shape (`cosineDistance` + `orderBy` + `limit`) uses the index; Phase 8 blended search = RRF fusion of two index-accelerated kNNs; **no SQL injection** (every `sql\`\`` parameter-binds); explicit column projections (no `select *`); no N+1 (recs bounded to 5 seeds); ingestion upsert is a single `INSERT … ON CONFLICT DO UPDATE`; migrations generated via drizzle-kit + Bun-native migrator, no hand-edits; `drizzle-orm/bun-sql` with internal pool.

---

## 4. AI / agent layer & cost-awareness

| Sev | ID | File:line | Finding | Fix |
|-----|----|-----------|---------|-----|
| 🟡 | BAG-1 | `routes/chat.ts:199`, `agent/intent.ts:87` | Intent gate classifies only the latest user message **context-free**; a context-dependent follow-up ("tell me more about the second one", "add that one") can be misclassified `off_topic`/`relevant=false` and hard-blocked before the agent, breaking multi-turn flow. | Pass a short window of prior turns into the gate, or relax blocking when an owned conversation with history exists. |
| 🟡 | BAG-2 | `agent/agent.ts:118` | `runAgent`'s `streamText(...).toUIMessageStreamResponse()` has no `onError`; an in-loop tool failure (DB/OpenAI down) reaches the client as the SDK's masked "An error occurred.", unlogged. (Also BERR-2.) | Pass `onError` to log + emit a friendly message; optionally wrap tool `execute`s to return a structured error the model can escalate on. |
| 🟢 | BAG-3 | `agent/intent.ts:15`, `lib/summary.ts:37`, `lib/recommendations.ts:37` | Comments claim OpenAI prompt caching applies, but these prompts are ~250–400 tokens (< the 1024-token cache floor) → `cached` ~always 0. Ordering is correct/harmless; comments overstate. | Tone down the comments. |
| 🟢 | BAG-4 | `agent/tools.ts`, `agent/agent.ts:36` | Cheapest-tier-first escalation is enforced only by prompt/tool-description, no hard server-side guard against fanning out to all three tiers. Matches the "agent-driven" design — a soft guarantee. | Acceptable; note it. |
| 🟢 | BAG-5 | `agent/agent.ts:125` | Per-request usage logged only via `onFinish`; a mid-stream client disconnect may skip it → unlogged usage (observability, not a cost leak). | Optional: also log on abort. |

**Pipeline done well:** intent gate genuinely runs first and hard-blocks off-topic/unsafe/injection (default-deny on uncertainty) before the `streamText` + `stepCountIs(10)` loop; HITL `manage_watchlist` correctly omits `execute` and has robust forged-continuation defenses (`isGenuineContinuation` checks server-trusted history); which-tier-ran logging is correct.

**Cost-awareness — exemplary (verified):** content-hash embedding cache (SHA-256, model-namespaced key, 30d TTL, in-batch dedup, only misses hit OpenAI); Redis summary cache backed by durable PG (7d TTL; 6h placeholder TTL so newly-reviewed movies re-summarize; delta-gated by review count + hash); uniform `gpt-5-nano`; every AI call routes through `logUsage`, reading the **correct v6** cached-token field (`usage.inputTokenDetails?.cacheReadTokens`, confirmed against installed types); no-candidate ranker skip, empty-query gate short-circuit, single query-embed reused across both kNN scans.

---

## 5. Auth (server) & security

| Sev | ID | File:line | Finding | Fix |
|-----|----|-----------|---------|-----|
| 🟡 | BSEC-1 | `lib/auth.ts:11-15` | Hashing uses BetterAuth **scrypt**, not mandated `Bun.password`/Argon2 (= BST-3). | Override `password.hash`/`verify` with `Bun.password`. |
| 🟡 | BSEC-2 | `lib/auth.ts:6-23` | No `advanced.defaultCookieAttributes`/`useSecureCookies`. Defaults (`httpOnly`, `sameSite:Lax`, `secure:auto`) work for same-site dev **only if `FRONTEND_URL` is set to the real frontend origin** (CORS allow-lists `FRONTEND_URL` + hardcoded `localhost:3000`, never `:5173`). On a multi-domain prod deploy, `SameSite=Lax` → session cookie not sent on XHR, auth breaks. **(Closes frontend AU-2.)** | Set `advanced.defaultCookieAttributes = { sameSite:'none', secure:true }` for cross-site prod, gated on env; document the topology requirement. |
| 🟡 | BSEC-3 | `middleware/rateLimit.ts:50-53` | Rate-limit identity = first `X-Forwarded-For` entry; without a proxy that *overwrites* XFF, an attacker rotates the header for unlimited buckets, defeating the `/api/auth/*` brute-force limiter. | Derive IP from a trusted proxy hop count or Bun's connection IP; don't trust raw XFF. |
| 🟡 | BSEC-4 | `middleware/rateLimit.ts:73-78` | On Redis error the limiter **fails open** — auth brute-force protection disappears during a Redis outage. | Fail-closed (or small in-process fallback) for the auth bucket. |
| 🟢 | BSEC-5 | `lib/auth.ts:14` | `requireEmailVerification:false` — users sign in unverified. | Enable if email verification is desired. |
| 🟢 | BSEC-6 | `lib/auth.ts`, `app.ts:26-38` | Hardcoded `http://localhost:3000` ships in `trustedOrigins` + CORS allow-list. | Move to env. |
| 🟢 | BSEC-7 | `routes/jobs.ts` | Returns 404 (not configured) vs 401 (bad secret) — leaks whether triggers are enabled. | Return a uniform status. |
| 🟢 | BSEC-8 | `db/index.ts:4` | No assertion that `BETTER_AUTH_SECRET`/`DATABASE_URL` are set → opaque driver error when unset (unlike `tmdb.ts:39`/`embeddings.ts:150`). | Add explicit env assertions. |

**Done well (verified):** external job trigger uses constant-time `crypto.timingSafeEqual` (length-guarded), disabled unless `JOB_TRIGGER_SECRET` set, **is** rate-limited, replay-safe (idempotent + Redis-lock-gated); auth enforcement returns 401 everywhere, chat conversations `userId`-scoped with ownership check; CORS never reflects an arbitrary origin, `credentials:true` paired with non-`*` origin; **no secret logging** anywhere (grep clean); prompt injection blocked at the gate.

---

## 6. Background jobs

| Sev | ID | File:line | Finding | Fix |
|-----|----|-----------|---------|-----|
| 🟢 | BJOB-1 | `jobs/refresh-summaries.ts:70-85,146` | First-deploy cost spike: all movies have `reviewSummaryAt=null` so the delta short-circuit can't fire → whole catalog fetched from TMDB and re-summarized in one run (bounded by concurrency 4). | Be aware; optionally seed/stagger the first run. |
| 🟢 | BJOB-2 | `jobs/scheduler.ts:23` | `ENDPOINT_LOCK_TTL_SECONDS=1800` never released after a run → external triggers more frequent than 30 min return `skipped`. By design. | Tie external cron to ≥30 min or shorten TTL. |

**Done well (verified):** single-flight via Redis `SET NX EX` shared by timer + HTTP trigger (no double-run across timer/trigger/multi-instance); self-rescheduling `setTimeout` (not `setInterval`) recomputes next delay → slow runs can't pile up; 32-bit overflow clamped/chained; `unref()`; `runLockedRefresh` never throws (timer calls via `void`) → can't crash the process; per-movie (`refresh-summaries.ts:158`) and per-item (`ingest.ts:229`) failures caught/counted/isolated; ingest idempotent by source hash, page-resumable.

---

## 7. Error handling

**Strong and deliberate.** The two literal `catch {}` (`db/schema.ts:37`, `lib/redis.ts:64`) are documented fallbacks, not swallows; every other catch logs + degrades intentionally. Resilience is real: TMDB retry + exponential backoff on network/5xx/429 (`lib/tmdb.ts:31-86`); self-healing Redis with bounded connect timeout; `withTimeout` on health probes + limiter; best-effort write-backs (`retrieval.ts:287`, `summary.ts:161`, `embeddings.ts:232`); no process-killing paths.

| Sev | ID | File:line | Finding | Fix |
|-----|----|-----------|---------|-----|
| 🟡 | BERR-1 | `app.ts` | No centralized `app.onError` → non-`movies` route failures return inconsistent plain-text 500 and bypass logging. (= BRT-1.) | Central `onError`. |
| 🟡 | BERR-2 | `agent/agent.ts:118` | No stream `onError` on `toUIMessageStreamResponse` → masked, unlogged in-loop failures. (= BAG-2.) | Add `onError`. |
| 🟢 | BERR-3 | `routes/chat.ts:184,228` | `onFinish → store.save` has no try/catch → a DB blip could silently drop the saved turn. | Wrap + log. |
| 🟢 | BERR-4 | `db/index.ts:4` | `process.env.DATABASE_URL!` → opaque error when unset. (= BSEC-8.) | Explicit assertion. |

---

## 8. Tests

**High quality, not over-mocked.** Uniform DI-fake seam injects OpenAI/TMDB/DB/Redis as recording fakes — no global module mocks, no network/spend in `bun test`. Tests assert real behavior: route status codes (`jobs.test.ts`: 200/401/404/500, secret via header or Bearer), retrieval tier selection + RRF ordering + regressions (`retrieval.test.ts`), cache hit/miss/dedup/read-through/resilience (`embeddings.test.ts`, `summary.test.ts`), single-flight + overflow + failure-isolation (`scheduler.test.ts`, `refresh-summaries.test.ts`), security paths (forged HITL continuation, cross-user conversation id, intent-gate block/injection/abuse/empty).

| Sev | ID | Area | Finding | Fix |
|-----|----|------|---------|-----|
| 🔴 | BTEST-1 | `agent/agent.ts:105` | **`runAgent` (the live `streamText` loop) is untested** — `agent.test.ts` covers only pure helpers (`latestUserText`, `summarizeToolPaths`, `prepareAgentStep`). Tool wiring, multi-step escalation, `prepareStep` final-step synthesis, `onFinish` usage/retrieval logging — the headline feature — have zero coverage. | Add an integration test with a fake model + fake tools asserting tier escalation, final synthesis, and usage logging. |
| 🔴 | BTEST-2 | `lib/conversation.ts` | **The real `ConversationStore` is untested** (no `conversation.test.ts`); its cross-user ownership guard (`save` throws on foreign write, `:59`), HITL `parts` heal via scoped `onConflictDoUpdate`, and load ordering are security/correctness-critical but only exercised via the fake. | Add `conversation.test.ts` against a test DB (or transactional fixture). |
| 🟡 | BTEST-3 | agent/retrieval | Tool-failure behavior in the loop untested (retrieval tested for success only); combined with missing stream `onError` (BERR-2), user-facing tier-failure result is unspecified. | Add "DB/embed throws" cases once `onError` lands. |
| 🟡 | BTEST-4 | routes | Chat/watchlist/reviews/recommendations Hono-boundary wiring untested (auth-401 guard, Zod-400 body validation, service-error→500) — only inner units covered. | Add route integration tests. |
| 🟢 | BTEST-5 | `routes/movies.test.ts` | Covers only the 400 validation paths, not 200/500. | Add success + error-mapping cases. |
| 🟢 | BTEST-6 | embeddings/ingest | Dimension guards (`embeddings.ts:222`, `ingest.ts:196`) never fire (fakes always return 1536-dim). | Add a wrong-dim fake case. |

---

## Consolidated action checklist

**Tooling (decided — D1/D2/D3 extend here)**
- [ ] BST-1 — delete `pg` + `@types/pg`.
- [ ] BST-2 — delete `dotenv` + its import.
- [ ] BST-4 — backend onto `@typescript/native-preview` + `tsgo`.
- [ ] BST-5 — backend tsconfig extends shared `tsconfig.base.json`.
- [ ] BST-6 — adopt oxlint (type-aware) + a formatter with `lint`/`format` scripts.

**Correctness / security**
- [ ] BDB-1 — index/unique `session.token`.
- [ ] BDB-4 — wrap `conversation.save()` in a transaction.
- [ ] BSEC-2 — cross-site cookie attributes (closes frontend AU-2); document deploy topology.
- [ ] BSEC-3 — stop trusting raw `X-Forwarded-For` for rate-limit identity.
- [ ] BSEC-4 — fail-closed auth rate-limit bucket on Redis error.
- [ ] BST-3 / BSEC-1 — `Bun.password`/Argon2 hashing.
- [ ] BERR-1 / BRT-1 — central `app.onError` (JSON 500 + logging).
- [ ] BERR-2 / BAG-2 — stream `onError` on `runAgent`.
- [ ] BAG-1 — give the intent gate prior-turn context.

**Performance / robustness**
- [ ] BDB-2 — index `session.user_id`, `account.user_id`.
- [ ] BDB-3 — index `review_summary_at` + paginate the refresh scan.
- [ ] BDB-5 — `timestamptz` columns.
- [ ] BERR-3 — try/catch around `onFinish → store.save`.

**Consistency / dedup**
- [ ] BRT-2 — shared `requireAuth` middleware.
- [ ] BRT-3 / BRT-6 — shared `MovieIdParamSchema`.
- [ ] BRT-4 — `app.notFound` JSON handler.
- [ ] BRT-5 — fix/remove dead `Variables` in `reviews.ts`.
- [ ] BRT-7 — validate `chat.ts` conversationId param.

**Tests**
- [ ] BTEST-1 — integration-test `runAgent`.
- [ ] BTEST-2 — test the real `ConversationStore` + cross-user guard.
- [ ] BTEST-3 — tool-failure paths.
- [ ] BTEST-4 — route-boundary integration tests.
- [ ] BTEST-5/6 — movies success/500 + dimension-guard cases.

**Polish (NITs)**
- [ ] BAG-3 — tone down prompt-caching comments.
- [ ] BAG-5 — log usage on client disconnect.
- [ ] BSEC-5/6/7/8 — email verification, env-ify `localhost:3000`, uniform jobs status, env assertions.
- [ ] BDB-6/7/8 — metadata trim, LIKE-escaping, misc cleanups.
- [ ] BJOB-1/2 — first-run spike awareness, external-trigger cadence.
- [ ] BST-7 — optional `concurrently` removal.

---

*Audit produced read-only; no source files were modified. Repo-root `.agents/skills/hono/SKILL.md` referenced in tasking does not exist — graded against `backend/.agents/skills/hono-routing/SKILL.md` + `CLAUDE.md`.*
