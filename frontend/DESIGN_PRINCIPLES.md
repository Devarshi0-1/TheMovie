# Frontend Design Principles

> The UX/accessibility contract for TheMovie's frontend. Read this **before building or changing any UI**. It layers on top of `CLAUDE.md` (project rules) and the **shadcn skill** (`.agents/skills/shadcn/`) — where this file is silent, those win; where it is more specific about UX behavior, this file wins.
>
> These rules were established in **ROADMAP Phase 9** (PRs #52–#57) after auditing the app against recognized standards. They are not aspirational — the codebase already follows them, and new code must too.

## How to use this file

When you add or modify a screen or component, it must handle **every applicable state** below. Treat the "Canonical examples" as copy-from sources. The **New UI checklist** at the bottom is the gate before you open a PR.

## Reference standards (audit against these, don't reinvent)

- **shadcn/ui** — our component library and the first stop. Rules live in `.agents/skills/shadcn/` (styling, composition, forms, icons). Add components via the CLI only (`bunx --bun shadcn@latest add …`), never hand-write `src/components/ui/`.
- **[Checklist Design](https://www.checklist.design/)** — per-component UX checklists (loaders, empty/error states, forms).
- **[Refactoring UI](https://www.refactoringui.com/)** (Wathan/Schoger) — practical visual-polish heuristics.
- **[Laws of UX](https://lawsofux.com/)** — Doherty Threshold (skeletons feel faster), Jakob's Law (work like other sites), recognition over recall.
- **[NN/g 10 Usability Heuristics](https://www.nngroup.com/articles/ten-usability-heuristics/)** — the foundational checklist (visibility of status, user control/undo, error recovery, error prevention, recognition over recall).
- **[The A11Y Project checklist](https://www.a11yproject.com/checklist/)** — landmarks, focus management, live regions, icon-button names, forms.
- **[web.dev / Core Web Vitals](https://web.dev/articles/optimize-cls)** — avoid layout shift (CLS): reserve space for async content and size all media.

## Core principle

**Every async or interactive surface must communicate its state.** A blank screen, a frozen button, a silent failure, or a layout that jumps when data arrives are all defects — not just rough edges. Map each surface to the four states (loading / empty / error / ready) plus feedback on every action.

---

## The rules

### 1. Loading → Skeletons, never plain text
- Use the shadcn **`Skeleton`** (no custom `animate-pulse` divs). **Never** ship `"Loading…"` text for content areas.
- The skeleton must **mirror the final layout** so there is zero layout shift when data arrives (web.dev CLS; Doherty Threshold makes the wait feel faster).
- Reuse the shared skeletons: **`PosterGridSkeleton`** for any poster grid (`withAction` adds a per-card button row), **`ReviewSummarySkeleton`** for the summary card. Build new shaped skeletons the same way when a new layout appears.
- Mark the loading container `aria-busy="true"` with an `aria-label` (e.g. `"Loading your watchlist"`).
- _Canonical:_ `src/components/PosterGridSkeleton.tsx`, `src/components/ReviewSummary.tsx` (`ReviewSummarySkeleton`), `src/components/MovieGrid.tsx`.

### 2. Empty → the `Empty` component
- Use shadcn **`Empty`** (`EmptyHeader`/`EmptyTitle`/`EmptyDescription`/`EmptyContent`) with a **meaningful message and, where possible, an action** (a link to browse, a suggestion). Never render a bare blank area.
- _Canonical:_ `src/routes/watchlist.tsx` (empty list → "Browse what's trending"), `src/components/ChatWindow.tsx` (empty chat → suggestion chips), `src/components/MovieGrid.tsx`.

### 3. Error → `Alert` + a recovery path
- Surface failures with shadcn **`Alert variant="destructive"`** and a **plain-language message** that says what failed and what to do (NN/g #9). No silent catches, no raw error dumps.
- If the failed thing is retryable, put a **Retry `Button`** in the Alert's **`AlertAction`** slot, wired to TanStack Query `refetch` (or `regenerate` for the chat stream).
- _Canonical:_ `src/components/MovieGrid.tsx` (`onRetry`), `src/routes/watchlist.tsx`, `src/components/ChatWindow.tsx`.

### 4. Destructive actions → reversible (undo), not silent
- Prefer an **undo affordance** over a confirm dialog for reversible mutations (lower friction; the established pattern here). Use the shadcn `sonner` action toast:
  ```tsx
  toast(`Removed “${title}” from your watchlist`, {
      duration: 6000,
      action: { label: 'Undo', onClick: () => add.mutate(...) },
  })
  ```
- Reserve an `AlertDialog` confirm for **irreversible / high-stakes** actions only (would require adding the component via the shadcn CLI).
- _Canonical:_ `src/components/WatchlistButton.tsx`, `src/routes/watchlist.tsx` (`removeWithUndo`).

### 5. Action feedback → toasts at the call site
- Confirm every user-initiated mutation with a **`sonner` toast** (`toast.success` / `toast.error`, or a neutral `toast` with an action). The `<Toaster richColors closeButton />` is mounted once in `__root.tsx`.
- **Fire toasts at the call site, not inside shared mutation hooks** (`useAddToWatchlist`/`useRemoveFromWatchlist`). The chat HITL flow (`WatchlistConfirm`) reuses those hooks for batch changes and shows its **own inline outcome** — putting toasts in the hook would spam one per movie. Keep the chat flow toast-free.
- _Canonical:_ `src/components/WatchlistButton.tsx`, `src/components/AppHeader.tsx`, `src/routes/signin.tsx` / `signup.tsx`.

### 6. Accessibility (non-negotiable)
- **Landmarks & headings:** one `<main>` per route (routes own theirs), `<nav>`/`<header>`, a single `<h1>`, logical heading order. `<html lang>` is set in `__root.tsx`.
- **Focus management:** the routed content is wrapped in a focusable `#main-content` region (`__root.tsx`); focus moves there on client-side navigation (never on first paint). A **"Skip to content"** link targets it. Don't remove these.
- **Live regions:** announce async content politely. The chat transcript is `role="log"` / `aria-live="polite"`. Use `role="status"` sparingly — oxlint's `prefer-tag-over-role` pushes `<output>` for it, so prefer `aria-busy` + `aria-label` on loaders and `role="log"`/`aria-live` for streams.
- **Icon-only controls** need an accessible name (`aria-label` or `sr-only` text). Decorative icons go inside a labelled `Badge`/`Spinner` or get `aria-hidden`.
- **Forms:** label every input; show validation with `data-invalid` on the `Field` + `aria-invalid` + `aria-describedby` on the control (shadcn `Field`/`FieldError`). Never signal state by color alone.
- _Canonical:_ `src/routes/__root.tsx` (skip link + focus), `src/components/ChatWindow.tsx` (live region), `src/components/AuthForm.tsx` (forms), `src/components/SearchBar.tsx` (icon button).

### 7. Images → sized, lazy, with a fallback
- Every `<img>` gets **`alt`**, **`loading="lazy"`** for below-the-fold, and **intrinsic `width`/`height`** (or an `aspect-[…]` container) so the browser reserves the ratio — no CLS. Poster `w342` is **342×513** (2:3).
- Always provide a **fallback** for missing media (the 🎬 placeholder, `aria-hidden`).
- _Canonical:_ `src/components/MovieCard.tsx`, `src/routes/movie.$id.tsx`.

### 8. Responsive & type scale
- **Mobile-first.** Use the `auto-fill` poster grid (`POSTER_GRID_CLASS`) so cards reflow without manual breakpoints.
- Scale prominent headings up at `sm:`/`lg:` (e.g. hero `text-4xl sm:text-5xl lg:text-6xl`). Don't let large screens keep mobile type.

### 9. Recognition over recall
- Surface shortcuts and options instead of hiding them in code. The chat composer shows "Press Enter to send, Shift+Enter for a new line" tied to the textarea via `aria-describedby` (NN/g #6/#7, Jakob's Law).
- _Canonical:_ `src/components/ChatComposer.tsx`.

### 10. Visual craft (Refactoring UI)
Polish comes from **constrained, intentional scales**, not ad-hoc values. Our shadcn tokens (`src/styles/app.css`) already encode most of this — stay inside them rather than inventing sizes, colors, or shadows.

- **Hierarchy by weight & color, then size.** Establish emphasis with `font-medium`/`font-semibold` + `text-foreground` vs `text-muted-foreground` *before* reaching for a bigger size. Secondary/meta text → `text-sm text-muted-foreground`. Labels are a last resort — let visual hierarchy do the talking. _(See `MovieCard`, the `movie.$id` meta row.)_
- **Constrained type scale.** Use Tailwind's steps (`text-xs` … `text-6xl`) — don't invent sizes. The font is **Geist** (`--font-sans` / `--font-heading`). Only prominent headings scale across breakpoints (rule 8); body stays `text-base` / `text-sm`. Let line-height ride the Tailwind defaults (tighter for large headings, e.g. `leading-tight`/`leading-[1.05]`; relaxed for prose, `leading-relaxed`).
- **Line length (measure).** Cap prose at ~45–75 characters: `max-w-[60ch]` (overview), `max-w-[56ch]` (hero subcopy), `max-w-[18ch]` (hero headline). Page content is bounded by `max-w-[1100px]`. Never let paragraphs run the full width.
- **Spacing scale & breathing room.** Space with the Tailwind scale via `gap-*` / `p-*` (never `space-x/y-*`). Start generous, then tighten. Convey grouping with proximity — smaller gaps within a group, larger between groups — not borders.
- **Color: semantic shades, never hue alone.** Use the token palette (`bg-card`, `text-muted-foreground`, `text-primary`, `text-pro`/`text-con`, `bg-accent-soft`); the brand is the cinematic amber `--primary`. **Never put low-contrast grey text on a colored surface** — on `bg-primary` use `text-primary-foreground`, on `bg-accent-soft` use full-contrast text. Always pair a status color with an icon/label/shape (the review pros/cons have "Loved"/"Critiqued" headings, not just green/orange). Don't hardcode hex or raw Tailwind colors (`bg-blue-500`) — extend tokens in `app.css` if a new shade is truly needed.
- **Depth & radius.** Elevation comes from the shadcn shadow scale + `border-border` with a consistent top light source — don't hand-roll shadows or `dark:` color overrides. Use the radius tokens consistently (`rounded-md`/`rounded-xl`/`rounded-2xl`, all derived from `--radius`); cards are `rounded-xl`/`rounded-2xl`.
- **Real content & intended image size.** Design against real TMDB data — long titles, missing posters (→ 🎬 fallback), empty review sets — not lorem ipsum. Serve images at their intended size (poster `w342`, backdrop `original`) with intrinsic dimensions (rule 7); never upscale a small image.

---

## shadcn alignment (summary — full rules in the shadcn skill)

- **Use components before custom markup:** `Alert` for callouts, `Empty` for empty states, `Skeleton` for loaders, `Badge` for status chips, `Separator` for dividers, `sonner` for toasts.
- **`className` is for layout only** (`max-w-*`, `mx-auto`, grid/flex, `gap-*`) — never to override a component's colors or typography. Use **semantic tokens** (`bg-background`, `text-muted-foreground`, `text-pro`/`text-con`, `bg-accent-soft`) and **built-in variants** (`variant="outline"`, `size="sm"`).
- **No `space-x/y-*`** (use `flex` + `gap-*`), **`size-*`** when width=height, **`truncate`** shorthand, **no manual `dark:`** overrides, **no manual `z-index`** on overlay components. Use **`cn()`** for conditional classes.
- **Icons in buttons** use `data-icon`, no sizing classes. **Forms** use `FieldGroup`/`Field`.
- `src/components/ui/` is **vendored** (excluded from oxlint) — change it only via the CLI, and if the CLI pulls an out-of-stack dep (e.g. `next-themes`), adapt the file to the project's approach and remove the dep.

## Toolchain reminders (so a change actually ships)

- **Tests:** `bun run test` (Vitest — **not** `bun test`). Every change ships feature + edge tests and a UX overview in the PR (per `CLAUDE.md`).
- **Lint/format:** `bun run lint` (oxlint) + **format only the files you touched** (`bunx oxfmt <files>`) — a full-tree format bloats the diff with pre-existing drift.
- **Types:** `bun run typecheck` (`tsgo`). New `@/` aliases must be mirrored in `vite.config`, `vitest.config`, and `tsconfig`.
- Toasts render in a portal not mounted in unit tests — **mock `sonner`** and assert the `toast` call (see `WatchlistButton.test.tsx`). Route-level behavior (skip link, focus, route-only handlers) isn't in the unit harness; verify it via build + the running app.

## New UI checklist (the gate before a PR)

For any new screen or data-driven/interactive component, confirm:

- [ ] **Loading** state uses a layout-mirroring `Skeleton` (no plain text).
- [ ] **Empty** state uses `Empty` with a message and, ideally, an action.
- [ ] **Error** state uses `Alert` with a plain-language message and a Retry where retryable.
- [ ] **Every mutation** gives feedback (toast at the call site); **destructive** ones are reversible (undo) or confirmed.
- [ ] **Pending** UI: buttons disable + reflect state while in flight.
- [ ] **A11y:** landmarks, one `h1`, labelled inputs with `aria-invalid`/`aria-describedby`, named icon buttons, live region for async updates.
- [ ] **Images:** `alt`, `loading="lazy"`, intrinsic dimensions/aspect ratio, fallback.
- [ ] **Responsive:** mobile-first; headings scale on larger breakpoints.
- [ ] Built on shadcn primitives + semantic tokens; `className` for layout only.
- [ ] **Visual craft:** constrained type/spacing scale, prose capped at a readable measure (`max-w-[…ch]`), hierarchy via weight/color, status conveyed by more than hue (rule 10).
- [ ] Feature + edge tests added; `bun run test`, `lint`, `typecheck` green; touched files formatted.
