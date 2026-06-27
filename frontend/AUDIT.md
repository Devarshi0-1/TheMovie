# Frontend Audit — TheMovie

**Date:** 2026-06-27
**Scope:** `frontend/` (TanStack Start + React 19 + TanStack Query 5 + @ai-sdk/react 3 + Zod 4; oxlint/oxfmt/Vitest/tsgo v7). ~2,150 LOC, 28 source files.
**Method:** Read-only audit across five dimensions (TanStack Start patterns, data layer, component composition, auth flow, cross-cutting/tests), followed by a lint/TypeScript deep-dive and a styling audit. Graded against the `tanstack-start-best-practices` and `shadcn` skills and current (June 2026) oxlint/tsgo guidance.

**Overall verdict:** Disciplined, above-average frontend. **No HIGH-severity correctness bugs.** Recurring themes: client-only route protection, duplicated query-keys/schemas/cache-logic, unsurfaced mutation errors, a lenient lint floor that can't catch async mistakes, and a styling layer that never adopted the intended Tailwind+shadcn system.

> **Status (PR `fix/frontend-audit-findings`):** all reported findings addressed **except** the Tailwind v4 + shadcn migration (D4 — its own follow-up PR) and two items below. NITs now done in the second pass: TS-4 (SSR/browser API base split), CC-4 (stabler message-part keys), CC-7 (sr-only composer label), XC-5 (streaming-UI test), XC-6 (busy-state + WatchlistOutcome-branch tests).
>
> **Two items remain, with reasons:**
> - **DL-10** (TMDB mapper dedup) can't be fixed frontend-only — the backend's movie endpoints leak raw TMDB snake_case that the frontend maps; the real fix is making those endpoints return `MovieResult` and deleting the frontend mapper. Folded into the **backend PR**.
> - **LT-6** (React Compiler) — attempted, but on Vite 8 + `@vitejs/plugin-react` v6 it needs the rolldown `reactCompilerPreset` via `@rolldown/plugin-babel` (0.1.x). That's a bleeding-edge integration deserving its own change with build + SSR verification, not a NIT bundle. Deferred.
>
> Tooling note: D1/tsgo for `@themovie/schemas` is deferred to the backend PR (still `tsc`); the shared `tsconfig.base.json` (D3) is created here and adopted by the backend there.

---

## Decisions taken (during the audit)

| #   | Decision                                                                     | Rationale                                                                                                                                   |
| --- | ---------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------- |
| D1  | **Adopt tsgo v7 across frontend _and_ backend**                              | Single compiler for the whole monorepo; the shared `@themovie/schemas` package must be checked by the same engine that consumes it.         |
| D2  | **Enable oxlint type-aware linting** (`oxlint-tsgolint`)                     | Closes the floating-promise gap that the manual `void` convention papers over today.                                                        |
| D3  | **Add a shared strict `tsconfig.base.json`** with `noUncheckedIndexedAccess` | Stops per-package strictness drift; one source of truth for compiler options.                                                               |
| D4  | **Full migration to Tailwind v4 + shadcn/ui**                                | Replace the hand-rolled BEM CSS + custom components with the intended design system; gets a11y/variants/focus for free. Phased, leaf-first. |

These are tracked as work items in the action checklist at the bottom; the migration (D4) warrants its own sequenced plan.

---

## Severity legend

🔴 HIGH · 🟡 MEDIUM · 🟢 NIT — Status: ☐ open · ☑ decided/planned

---

## 1. TanStack Start patterns

Architecture note: this is an **SSR React shell over a separate Hono API** (`:3100`). The session cookie lives on the backend origin, so the SSR server cannot read it — which is why auth is resolved client-side and the `createServerFn`/RPC layer is unused. Legitimate, but it shapes the auth findings below.

| Sev | ID   | File:line                                                                           | Finding                                                                                                                                                                                                                                                          | Fix                                                                                                                                                                                                                                                    |
| --- | ---- | ----------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 🟡  | TS-1 | `routes/chat.tsx:15`, `routes/watchlist.tsx:13`, `components/RequireAuth.tsx:11-31` | Route protection is client-side only — `RequireAuth` redirects via `useEffect` after hydration (the `auth-route-protection` anti-pattern; flash of protected content). Mitigated by backend 401 enforcement, so it's a UX/defense-in-depth gap, not a data leak. | Add a pathless `_authenticated` layout with a `beforeLoad` that reads the cached session from `context.queryClient` and `throw redirect({ to: '/signin', search: { redirect: location.href } })`. Keep `RequireAuth` only as the SSR-initial fallback. |
| 🟡  | TS-2 | `router.tsx:22`, `routes/__root.tsx:11-21`                                          | No app-level `defaultNotFoundComponent` / `defaultErrorComponent`; only `movie.$id` defines them. Unknown URLs / unhandled loader errors hit TanStack's bare defaults.                                                                                           | Add `defaultNotFoundComponent` + `defaultErrorComponent` to `createRouter(...)` (or `notFoundComponent` on `__root`).                                                                                                                                  |
| 🟢  | TS-3 | `routes/index.tsx:10-21`                                                            | Loader comment claims the `ensureQueryData → useSuspenseQuery` path, but code uses `prefetchQuery` + `useQuery` (code is correct, comment drifted).                                                                                                              | Update the comment.                                                                                                                                                                                                                                    |
| 🟢  | TS-4 | `lib/api.ts:14-16`                                                                  | Single `VITE_API_URL` serves both SSR and browser fetches; in prod the SSR server may need an internal/origin-local URL.                                                                                                                                         | If SSR/browser reach the backend via different hosts in prod, split into a server-only base; else leave as-is.                                                                                                                                         |

**Done well:** per-request `QueryClient` + `setupRouterSsrQueryIntegration` (correct dehydration), `defaultPreload: 'intent'`, `scrollRestoration`; `movie.$id` pairs `ensureQueryData` (loader) with `useSuspenseQuery` and handles bad ids via `throw notFound()` + dedicated `notFoundComponent`/`errorComponent`; `validateSearch` Zod schemas on `/`, `/signin`, `/signup`; clean hydration (localStorage deferred to `useEffect`).

---

## 2. Data layer & AI streaming

| Sev | ID    | File:line                                                                     | Finding                                                                                                                                                                                                                                       | Fix                                                                                                       |
| --- | ----- | ----------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------- |
| 🟡  | DL-1  | `lib/watchlist.ts:52,64`, `components/ChatWindow.tsx:70-72`                   | Query-key string literals (`['watchlist','status',id]`, `['watchlist']`) hand-written in 3 places; a key change silently desyncs the chat path from the hook path.                                                                            | Export keys from `lib/watchlist.ts` (or `queryOptions`) and reference `.queryKey` everywhere.             |
| 🟡  | DL-2  | `lib/watchlist.ts:22,36,41`, `lib/auth.ts:14-23`                              | API response shapes (`StatusSchema`, `AddResultSchema`, `RemoveResultSchema`, `SessionUserSchema`, `GetSessionResponseSchema`) redefined locally instead of imported from `@themovie/schemas`; will drift from the backend.                   | Move response schemas to the shared package and import them.                                              |
| 🟡  | DL-3  | `components/WatchlistButton.tsx:53-56`, `lib/watchlist.ts:47-68`              | Mutation hooks have only `onSuccess` — no `onError`, no error UI. A failed add/remove silently re-enables the button with a stale badge.                                                                                                      | Add `onError` handling (toast/inline) or surface `isError`.                                               |
| 🟡  | DL-4  | `components/WatchlistConfirm.tsx:44-66`                                       | On partial `Promise.allSettled` failure it returns without calling `onResolve`: succeeded movies are written to the DB but caches are never reconciled **and** the `manage_watchlist` tool stays unresolved (agent never learns the outcome). | Reconcile caches for the succeeded subset regardless, and resolve the tool with a partial-status payload. |
| 🟡  | DL-5  | `lib/chat.ts:127-132`                                                         | `fetchConversationMessages` response is cast `as` and flows straight into `setMessages` — the one unvalidated API boundary.                                                                                                                   | Validate with `z.object({ id, messages: z.array(...) })` (permissive parts ok).                           |
| 🟢  | DL-6  | `components/WatchlistConfirm.tsx:47-52` + `components/ChatWindow.tsx:64-75`   | HITL write path calls raw `addToWatchlist`/`removeFromWatchlist`, re-implementing the cache sync that already lives in the mutation hooks — two write paths, two copies of invalidation logic.                                                | Route the batch through `useAddToWatchlist`/`useRemoveFromWatchlist` (`mutateAsync`).                     |
| 🟢  | DL-7  | `components/ChatWindow.tsx:31-39`, `router.tsx:12-20`, `ChatWindow.tsx:54-56` | No `onError` on `useChat`; no `QueryCache`/`MutationCache` `onError`; conversation-restore failure swallowed unlogged. Errors render locally but aren't observable.                                                                           | Add stream/cache `onError` logging.                                                                       |
| 🟢  | DL-8  | `lib/movies.ts:83-88`                                                         | `movieDetailsQueryOptions` has no `staleTime` despite near-immutable data; inherits global 60s and refetches on revisit.                                                                                                                      | Set a long/`Infinity` `staleTime` (summary at `:99` already does).                                        |
| 🟢  | DL-9  | `lib/movieQueries.test.ts:2`                                                  | Test file misnamed — it imports/tests `./movies`; no `movieQueries` module exists.                                                                                                                                                            | Rename to `movies.test.ts`.                                                                               |
| 🟢  | DL-10 | `lib/tmdb.ts:11-37`                                                           | `TmdbListItemSchema`/`TmdbDetailsSchema` + snake→camel mapping defined locally; duplicates the backend's TMDB proxy contract (defensible, frontend-only boundary).                                                                            | Optional: share the mapper if it drifts.                                                                  |

**Done well:** single typed `apiFetch` boundary + one `ApiError` type, `credentials: 'include'`, tolerant error-body parsing; Zod validation at every other read boundary; correct SSR-query wiring; textbook `useChat` v3 + `DefaultChatTransport` + HITL `addToolResult` / `sendAutomaticallyWhen: lastAssistantMessageIsCompleteWithToolCalls`.

---

## 3. Component composition

| Sev | ID   | File:line                                                                   | Finding                                                                                                                                                                                                                 | Fix                                                                                                        |
| --- | ---- | --------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------- |
| 🟡  | CC-1 | `components/AuthForm.tsx:18-54`                                             | Hand-rolls 5 `useState` slices + manual `safeParse` while `ChatComposer` correctly uses `@tanstack/react-form`. Validation runs only on submit; field errors clear only on the next submit (stale errors while typing). | Rebuild on `useForm({ validators: { onChange: SignInSchema/SignUpSchema } })` with `form.Field` per input. |
| 🟡  | CC-2 | `components/WatchlistConfirm.tsx:44-53` + `components/ChatWindow.tsx:64-75` | Duplicate cache-sync logic + a mutation concern embedded in confirm-UI (same root as DL-6).                                                                                                                             | Drive the batch through the mutation hooks; `handleToolResult` then only calls `addToolResult`.            |
| 🟢  | CC-3 | `components/ReviewSummary.tsx:28,40`                                        | `key={pro}` / `key={con}` use list text as the React key; duplicate LLM strings collide.                                                                                                                                | Key on index (static post-fetch list) or content+index composite.                                          |
| 🟢  | CC-4 | `components/ChatMessage.tsx:30-31`                                          | Text parts key on array index — fine for append-only streaming, fragile if parts reorder.                                                                                                                               | Acceptable; flag only.                                                                                     |
| 🟢  | CC-5 | `components/ChatWindow.tsx:77-80`                                           | `scrollIntoView({ behavior: 'smooth' })` fires on mount/rehydration, yanking the viewport on first paint.                                                                                                               | Use `behavior: 'auto'` for initial population, smooth only for subsequent appends.                         |
| 🟢  | CC-6 | `components/MovieCardLink.tsx:8`                                            | Whole `<article>` wrapped in one `<Link>` → verbose concatenated accessible name.                                                                                                                                       | Add `aria-label={movie.title}` on the Link.                                                                |
| 🟢  | CC-7 | `components/ChatComposer.tsx:40-55`                                         | `<textarea>` has only `aria-label` (no visible `<label>`); inconsistent with the rest.                                                                                                                                  | Acceptable for a chat composer.                                                                            |

**Done well:** clear smart/dumb split; no prop-drilling; sensible loading/error/empty states; strong a11y (real buttons, `aria-pressed`/`aria-invalid`/`aria-describedby`, alt text); the `MovieCard`/`MovieCardLink` split is justified composition, not duplication; hooks always called unconditionally; clean hydration (no `window`/`Date`/`Math.random` in render).

---

## 4. Auth flow (BetterAuth)

| Sev | ID   | File:line                                                                                 | Finding                                                                                                                                                                                                   | Fix                                                                                                                                       |
| --- | ---- | ----------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------- |
| 🟡  | AU-1 | `routes/watchlist.tsx:13-17`, `routes/chat.tsx:15-19`, `components/RequireAuth.tsx:11-31` | (= TS-1) Effect-based client-only protection; `auth-route-protection` HIGH-priority anti-pattern. Mitigated by server-enforced 401s.                                                                      | `beforeLoad` cached-session guard (see TS-1).                                                                                             |
| 🟡  | AU-2 | `lib/api.ts:11-16`, `lib/auth.ts:7`                                                       | Auth depends on `credentials: 'include'` + a same-site cookie; **breaks if frontend/backend deploy to different registrable domains** (`SameSite=Lax` won't send cross-site; forcing `None` widens CSRF). | Deploy under a shared apex (subdomains) or same-origin proxy; verify backend `SameSite`/`Secure`/`Partitioned`. Document the requirement. |
| 🟢  | AU-3 | `components/RequireAuth.tsx:11` (call sites `watchlist.tsx:14`, `chat.tsx:16`)            | Hardcoded `redirect="/watchlist"` string loses the visited URL's search params on return.                                                                                                                 | Derive from `location.href` (free with a `beforeLoad` guard).                                                                             |
| 🟢  | AU-4 | `routes/signin.tsx:30-32`, `routes/signup.tsx:29-31`                                      | Authed user briefly sees the form before the effect bounces them.                                                                                                                                         | Gate with `beforeLoad` using the cached session.                                                                                          |
| 🟢  | AU-5 | `lib/redirect.ts:7-11`                                                                    | `safeRedirect` correctly rejects protocol-relative/backslash targets and feeds router `navigate({ to })`, not `window.location`.                                                                          | No change — good defense-in-depth.                                                                                                        |

**Backend caveat (out of frontend scope):** actual cookie flags (`httpOnly`/`secure`/`sameSite`), CSRF, and `trustedOrigins` live in the backend BetterAuth setup — verify there. AU-2 is the frontend-visible consequence.

**Done well:** no secrets in the client bundle (only public `VITE_API_URL`); session validated server-side by real BetterAuth; no tokens in `localStorage` (only non-sensitive `conversationId`); client validation mirrors server (`password min 8`); submit errors surfaced inline via `role="alert"`.

---

## 5. Cross-cutting: schemas, errors, tests, config

**Schema reuse / boundary validation** — strong: `lib/movies.ts`, `lib/watchlist.ts`, `lib/tmdb.ts` validate every response against shared `@themovie/schemas` shapes; no `as` casting of payloads in the data layer.

| Sev | ID   | File:line                                                   | Finding                                                                                                                                                                                      | Fix                                                                      |
| --- | ---- | ----------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------ |
| 🟡  | XC-1 | `lib/chat.ts:127-132`                                       | (= DL-5) Only unvalidated boundary; untrusted server data → `setMessages`.                                                                                                                   | Zod-validate the restore response.                                       |
| 🟡  | XC-2 | `lib/auth.ts:14-70`                                         | `SessionUserSchema`, `SignInSchema`, `SignUpSchema` defined locally; describe API shapes but live outside `packages/schemas`; password-min `8` duplicated by comment, not a shared constant. | Lift to `packages/schemas/src/auth.ts`; share the password-length bound. |
| 🟢  | XC-3 | `routes/signin.tsx:35`, `routes/signup.tsx:35`              | `signIn(values as SignInValues)` narrows a union with `as`, defeating the type system (safe in practice — AuthForm already `safeParse`d).                                                    | Use a discriminated handler.                                             |
| 🟢  | XC-4 | `components/ChatWindow.tsx:54-56`, `lib/chat.ts:97/108/118` | Documented graceful-degradation catches (history restore, localStorage). The restore `.catch` swallows unconditionally — a real transient error is invisible.                                | Acceptable; consider logging the restore failure.                        |

**Error handling** — excellent: no silent catches; every `catch` rethrows, maps to typed `ApiError`, or degrades with a documented reason. `WatchlistConfirm` surfaces partial-failure counts to the user.

**Test quality** — high, behavior-driven (real interactions, async states, failure paths), happy-path + edge-case split per project rule. `WatchlistConfirm.test.tsx` and `api.test.ts` are standouts (partial-batch failure, network status-0, empty-body→null).

| Sev | ID   | File:line                              | Finding                                                                                                                                                                                    | Fix                                                          |
| --- | ---- | -------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------ |
| 🟢  | XC-5 | `components/ChatWindow.test.tsx:9-16`  | `useChat` fully stubbed → message rendering / streaming status / `sendAutomaticallyWhen` never exercised against the real hook; `ChatMessage` tool-part rendering only covered indirectly. | Add a thin integration test or cover `ChatMessage` directly. |
| 🟢  | XC-6 | `components/WatchlistConfirm.test.tsx` | No test for the "Applying…" busy/disabled state; exported `WatchlistOutcome` render branches untested.                                                                                     | Add busy-state + outcome-branch tests.                       |
| 🟢  | XC-7 | `lib/chat.test.ts:61-91`               | Documented `.catch → []` failure path of `fetchConversationMessages` not asserted.                                                                                                         | Add a rejected-fetch test.                                   |

**Config**

| Sev | ID   | File:line        | Finding                                                                                                                              | Fix                                                           |
| --- | ---- | ---------------- | ------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------- |
| 🟡  | XC-8 | `tsconfig.json`  | `strict` on with a solid flag set, but **`noUncheckedIndexedAccess` off**; code leans on `[0]!`. `exactOptionalPropertyTypes` unset. | Enable `noUncheckedIndexedAccess` (via the shared base — D3). |
| 🟢  | XC-9 | `.oxlintrc.json` | `correctness`-only floor; `pedantic`/`style`/`nursery` unenforced. The 2 disabled rules are correctly justified.                     | See lint section (D2).                                        |

---

## 6. Lint & TypeScript hygiene (deep-dive)

**Escape-hatch hygiene — excellent (corrects an earlier overstatement):** non-test `src` contains exactly **one** `[0]!` (`WatchlistConfirm.tsx:87`), **zero `any`**, **zero `@ts-ignore`/`@ts-expect-error`**, only 4 defensible `as` casts. The only inline lint suppression is in generated `routeTree.gen.ts`. Rules _are_ followed across the app.

### Oxlint

Current `.oxlintrc.json`: plugins `[react, typescript, jsx-a11y, import]`; `correctness: error`, `suspicious: warn`; 3 overrides. Sensible floor, but under-powered:

| Sev  | ID   | Finding                                                                                                                                                                                                                                                                                                  | Fix                                                                                                                                                                                                                                                                           |
| ---- | ---- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 🔴\* | LT-1 | **No type-aware linting → floating promises are not caught.** ~16 manual `void` guards across `ChatComposer`/`ChatWindow`/`RequireAuth`/`routes/*`/`lib/watchlist` are a human/agent convention, not enforced. A forgotten `await` passes CI. *(Severity reflects the *risk class*, not a current bug.)* | Enable type-aware linting (D2): `npm add -D oxlint-tsgolint@latest`; set `options.typeAware: true`; turn on `typescript/no-floating-promises`, `no-misused-promises`, `await-thenable`. Optionally `oxlint --type-aware --type-check` replaces the separate `tsc` step in CI. |
| 🟡   | LT-2 | `react/exhaustive-deps` may not be active (stability churn; not reliably in default `correctness`). Effect-dep bugs (`ChatWindow.tsx:77`, chat localStorage effects) would hide.                                                                                                                         | Enable `react/exhaustive-deps: "error"` explicitly.                                                                                                                                                                                                                           |
| 🟡   | LT-3 | `suspicious` is `warn` → warnings don't fail CI and get scrolled past; the autonomous verify-gate doesn't bite.                                                                                                                                                                                          | Promote `suspicious` to `error`; add `perf: "warn"` (recommended baseline).                                                                                                                                                                                                   |

`*` LT-1 is a HIGH-priority _gap_, tracked under D2.

**Recommended `.oxlintrc.json`:**

```jsonc
{
    "options": { "typeAware": true },
    "categories": { "correctness": "error", "suspicious": "error", "perf": "warn" },
    "rules": {
        "react/exhaustive-deps": "error",
        "typescript/no-floating-promises": "error",
        "typescript/no-misused-promises": "error",
        "typescript/await-thenable": "error",
    },
}
```

### TypeScript

| Sev | ID   | Finding                                                                                                                                                                                                                                                                                                                                                                               | Fix                                                                                                                  |
| --- | ---- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------- |
| 🟡  | LT-4 | **Strictness & compiler inconsistent across the 3 packages, no shared base.** frontend has `noUnusedLocals/Parameters` + `verbatimModuleSyntax`; backend & schemas don't. `noUncheckedIndexedAccess` off everywhere. `packages/schemas` is typechecked by **`tsc ^5.7.0`** while consumers use **tsgo v7** — the shared contract is validated by a different engine than consumes it. | D1 + D3: move schemas onto `@typescript/native-preview` (tsgo); add root `tsconfig.base.json` extended by all three. |
| 🟢  | LT-5 | `strict` is copy-pasted 3× and already diverges.                                                                                                                                                                                                                                                                                                                                      | Centralize in the base config.                                                                                       |

**Recommended `tsconfig.base.json` (root):**

```jsonc
{
    "compilerOptions": {
        "strict": true,
        "noUncheckedIndexedAccess": true,
        "noImplicitOverride": true,
        "verbatimModuleSyntax": true,
        "noUnusedLocals": true,
        "noUnusedParameters": true,
        "moduleResolution": "bundler",
        "isolatedModules": true,
    },
}
```

### React 19

- ✅ Automatic JSX runtime + `react/react-in-jsx-scope: off` correct.
- 🟢 LT-6 — **Not using the React Compiler** (no `babel-plugin-react-compiler` / `react-compiler` lint rule). Optional but the key React 19 lever; would remove manual memoization and flag rules-of-React violations.

**Sources:** [oxlint type-aware](https://oxc.rs/docs/guide/usage/linter/type-aware) · [VoidZero type-aware announcement](https://voidzero.dev/posts/announcing-oxlint-type-aware-linting) · [tsgolint](https://github.com/oxc-project/tsgolint) · [oxlint rules/categories](https://oxc.rs/docs/guide/usage/linter/rules).

---

## 7. Styling

**Headline:** the frontend is **100% hand-written vanilla CSS** — a single **1,078-line / 22 KB `app.css`** (~144 BEM selectors, CSS-custom-property theming, linked via `?url` in `__root.tsx`). **No Tailwind, no shadcn, no Radix, no `lucide`, no `clsx`/`cva`, no CSS modules** anywhere. shadcn was never initialized (no `components.json`).

> Note: `CLAUDE.md` never actually mandates Tailwind/shadcn, so today's code violates no written rule — the conflict is with the installed `shadcn` skill and the intended direction. **Decision D4: full migration to Tailwind v4 + shadcn.** The doc gap should be closed by updating `CLAUDE.md` to make Tailwind+shadcn official.

**Reinvented primitives (each maps to a shadcn component):**

| Hand-rolled today                                               | shadcn target                                                   |
| --------------------------------------------------------------- | --------------------------------------------------------------- |
| `AuthForm` / `ChatComposer` custom field/label/input/error divs | `Field`/`FieldGroup`/`Input` with `data-invalid`+`aria-invalid` |
| `.appheader__btn--primary`, `.wl-btn--active`, `.hitl__approve` | `Button` with `variant`/`size`                                  |
| `.chat__error`, `AuthForm` error, `ToolActivity--error` divs    | `Alert`                                                         |
| `WatchlistButton` active pill, genre tags                       | `Badge`                                                         |
| `.chat__empty`, `.grid-state`                                   | `Empty`                                                         |
| `isPending` UI (none today)                                     | `Skeleton` / `Spinner`                                          |
| silent mutation failures (DL-3)                                 | `sonner` `toast()`                                              |

**Styling-quality findings (the fair bar if vanilla CSS were kept):**

| Sev | ID   | Finding                                                                                                                                                                 | Fix                                                          |
| --- | ---- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------ |
| 🟡  | ST-1 | `ChatMessage.tsx:25`, `ToolActivity.tsx:15`, `WatchlistButton.tsx:61` — conditional classes via ternary string concat (the manual pattern shadcn replaces with `cn()`). | Introduce `cn()` (post-migration, utility classes).          |
| 🟡  | ST-2 | Focus a11y thin — only **3 `:focus` rules** in 1,078 lines, no `:focus-visible` strategy on custom buttons/links.                                                       | shadcn primitives ship this; otherwise add `:focus-visible`. |
| 🟡  | ST-3 | Barely responsive — a **single** `@media (max-width: 640px)` breakpoint.                                                                                                | Tailwind responsive utilities; otherwise add breakpoints.    |
| 🟡  | ST-4 | Dark-only, `color-scheme: dark` hardcoded, no `prefers-color-scheme`.                                                                                                   | Port tokens into a theme system with light support.          |
| 🟡  | ST-5 | One global, unscoped stylesheet (144 selectors) — collision/dead-CSS risk as it grows.                                                                                  | Utility classes + per-component scope.                       |
| 🟢  | ST-6 | Good: `prefers-reduced-motion` handled (2 blocks), custom-property theming, consistent BEM.                                                                             | Preserve tokens during the port.                             |

**Migration shape (D4, phased leaf-first):** init Tailwind v4 + `components.json` + `cn()` (`src/lib/utils.ts`) + `lucide` → port `app.css` tokens into the `@theme` block → replace components leaf-first (`Button`→`WatchlistButton`/`AppHeader`/HITL; `Field`+`Input`→`AuthForm`/`ChatComposer`; `Alert`+`sonner`→errors; `Badge`; `Empty`; `Skeleton`) with each component's tests updated in step.

---

## Consolidated action checklist

**Infra / tooling (decided)**

- [ ] D1 — tsgo v7 across frontend + backend; move `packages/schemas` off `tsc 5.7` onto `@typescript/native-preview`.
- [ ] D2 / LT-1 — oxlint type-aware linting (`oxlint-tsgolint`); enable `no-floating-promises`/`no-misused-promises`/`await-thenable`; remove manual `void` reliance.
- [ ] D3 / LT-4 / XC-8 — root `tsconfig.base.json` (strict + `noUncheckedIndexedAccess`); all 3 packages extend it.
- [ ] LT-2 — enable `react/exhaustive-deps: error`.
- [ ] LT-3 — `suspicious: error` + `perf: warn`.
- [ ] D4 — Tailwind v4 + shadcn migration (own sequenced plan; ST-1…ST-6, primitive table above).
- [ ] Update `CLAUDE.md` to make Tailwind+shadcn (and tsgo-everywhere) official.

**Correctness / robustness**

- [ ] DL-4 / CC-2 — fix WatchlistConfirm partial-failure: reconcile succeeded subset + resolve tool with partial status.
- [ ] DL-3 — surface WatchlistButton mutation errors (`onError` + toast).
- [ ] DL-5 / XC-1 — Zod-validate `fetchConversationMessages`.
- [ ] TS-1 / AU-1 — `_authenticated` layout with `beforeLoad` guard; demote `RequireAuth` to SSR fallback.
- [ ] AU-2 — verify/document same-site cookie deployment topology.

**Consistency / dedup**

- [ ] DL-1 — single-source query keys.
- [ ] DL-2 / XC-2 — move auth/watchlist response schemas + password-min into `@themovie/schemas`.
- [ ] DL-6 / CC-2 — route HITL writes through the mutation hooks.
- [ ] CC-1 — rebuild `AuthForm` on `@tanstack/react-form`.

**Polish (NITs)**

- [ ] TS-2 — app-level not-found/error components.
- [ ] DL-7 — stream/cache `onError` logging.
- [ ] DL-8 — `staleTime` on movie details.
- [ ] DL-9 — rename `movieQueries.test.ts` → `movies.test.ts`.
- [ ] CC-3 — ReviewSummary keys.
- [ ] CC-5 — ChatWindow initial-scroll behavior.
- [ ] CC-6 — `aria-label` on `MovieCardLink`.
- [ ] AU-3 — preserve search params in auth redirect.
- [ ] AU-4 — `beforeLoad` bounce for authed users on `/signin`,`/signup`.
- [ ] XC-3 — discriminated auth handler (drop `as`).
- [ ] XC-5/6/7 — test gaps (useChat integration, busy state, restore failure).
- [ ] TS-3 — fix drifted loader comment.
- [ ] LT-6 — evaluate React Compiler.

---

_Audit produced read-only; no source files were modified. Skill rule-file note: a few rule ids referenced in the skill's quick-reference (`err-redirects`, `err-not-found`, `auth-cookie-security`) have no backing rule file — findings were graded against the closest existing rules._
