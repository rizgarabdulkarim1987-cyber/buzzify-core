# Guest feedback box and language popup Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans (native). Steps use checkbox (`- [ ]`) syntax.

**Goal:** Every menu style shows a floating language popup button and a floating feedback (complaint / suggestion) button, on by default, working without a table or a till; restaurants read the messages in the Studio.

**Architecture:** The pair lives once in the guest layout (`GuestChrome`), so all 35 template styles and the classic `MenuApp` get it with no per-style change. Messages reuse `PosComplaint` (`tableId`/`tableNumber` already optional) with a new `SUGGESTION` category; a new menu-level gate replaces the till gate for guests. Studio gets a read view.

**Tech Stack:** Next.js (see AGENTS.md), Prisma, zod, vitest, Tailwind.

**Spec:** `docs/superpowers/specs/2026-10-26-guest-feedback-and-language-popup-design.md`

## Global Constraints

- Three guest languages `en`, `ar`, `ckb`; words kept identical in shape (`complaint/words.ts`).
- RTL aware (logical properties `start/end`); targets at least 44px (`min-h-11`); honor `prefers-reduced-motion`; no motion in the cashier.
- Guest input stays text only: honeypot `website`, consent for contact, `cleanGuestText`, limits in `COMPLAINT_LIMITS`.
- Controls never cover `CartBar`, the product sheet or a style's navigation.
- New migration file under `prisma/migrations/`; CRLF trap: check `git diff --stat` for whole-file churn before committing.

## Review Focus

- No table number (plain menu URL): the message is stored with `tableId` and `tableNumber` null.
- Menu with no till subscription: still accepted, and readable in the Studio.
- Menu with feedback switched off: button hidden and the API answers 404.
- Same `clientKey` twice: one message. Honeypot filled: accepted, not stored.
- Single-language menu: the language button is not shown.

---

### Task 1: Server accepts suggestions and table-less messages

**Files:**
- Modify: `prisma/schema.prisma` (enum `PosComplaintCategory` add `SUGGESTION`); create `prisma/migrations/20261026300000_complaint_suggestion/migration.sql`
- Modify: `src/server/domain/pos/complaint-rules.ts` (`COMPLAINT_CATEGORIES` add `'SUGGESTION'`)
- Modify: `src/server/http/schemas.ts:90` (`complaintSchema.table` optional)
- Modify: `src/server/pos/complaints-guest.ts`, `src/app/api/[tenant]/complaint/route.ts`
- Test: `tests/pos/complaints.test.ts` (extend)

**Interfaces:**
- Produces: `feedbackGate(prisma, tenant, tableNumber: number | null): Promise<FeedbackGate>` where `FeedbackGate = { open: true; restaurantId: string; tableId: string | null } | { open: false }`. Open when the menu's `engineConfig.feedback.enabled !== false` (default on); `tableId` set only when the till gate is open for that table.
- `GuestComplaint.table` becomes `number | null`; `submitComplaint` uses `feedbackGate`. Limits: with a table, unchanged; without, only `perRestaurantPerHour` (per-IP limit is already in the route).
- Keep `complaintGate` exported for the till.

- [ ] **Step 1: Failing tests** in `tests/pos/complaints.test.ts`: `submits a suggestion without a table`, `stores null table on a menu with no till`, `refuses when engineConfig.feedback.enabled is false` (ComplaintGateClosed), `same clientKey twice stores once`.
- [ ] **Step 2: Run** `npx vitest run tests/pos/complaints.test.ts` — expect the new tests FAIL.
- [ ] **Step 3: Implement** enum + migration, rules, schema, `feedbackGate`, `submitComplaint` (table null skips table lock and per-table limits; order link only with a table).
- [ ] **Step 4: Run** the same command — expect PASS; then `npx tsc --noEmit` clean.
- [ ] **Step 5: Commit** `feat(feedback): suggestions and table-less messages`.

### Task 2: The Menu knows whether feedback is on

**Files:**
- Modify: `src/ui/AppProviders.tsx` (`TenantClientInfo.feedback: boolean`), `src/app/[tenant]/[locale]/layout.tsx` (pass it from `engineConfig`)
- Create: a small reader `feedbackSettings(engineConfig): { enabled: boolean }` next to `salesSettings` in `src/server/domain/config.ts`, used by both `feedbackGate` and the layout
- Test: `tests/domain/config.test.ts` (or the file that tests `salesSettings`)

- [ ] **Step 1: Failing test** `feedbackSettings({})` is enabled; `{feedback:{enabled:false}}` is disabled; junk values are enabled.
- [ ] **Step 2: Run, expect FAIL. Step 3: Implement. Step 4: Run, expect PASS.**
- [ ] **Step 5: Commit** `feat(feedback): menu-level switch, default on`.

### Task 3: Floating language popup and feedback popup in every style

**Files:**
- Create: `src/ui/guest/GuestChrome.tsx` (the fixed pair), `src/ui/guest/LanguagePopup.tsx`, `src/ui/guest/FeedbackPopup.tsx`
- Modify: `src/ui/AppProviders.tsx`/layout to render `GuestChrome` inside the provider; `src/ui/menu/Header.tsx` and `chrome.tsx` `TemplateHeader` drop the inline `LanguageSwitch`; delete `src/ui/LanguageSwitch.tsx` once unused
- Modify: `src/app/[tenant]/[locale]/t/[table]/complaint/words.ts` (add `suggestion` kind, popup labels, `language` label in all three languages), `t/[table]/page.tsx` (drop the footer link, now redundant)
- Test: `tests/ui/guest-chrome.test.tsx`

**Interfaces:**
- `FeedbackPopup` posts to `/api/${slug}/complaint` with `table: useApp().table ?? undefined`, `category: 'SUGGESTION'` or the chosen complaint category.
- `LanguagePopup` lists `tenant.locales`, links as the old switch did (`/${slug}/${code}/${rest}`); hidden when one locale.
- Popups: dialog semantics, focus moves in and returns, Escape and backdrop close, hidden behind the product sheet and cart.

- [ ] **Step 1: Failing tests**: language button hidden with one locale; opening lists locales with `aria-current`; feedback button hidden when `tenant.feedback` is false; empty body shows the `empty` message; success shows `thanks`.
- [ ] **Step 2: Run** `npx vitest run tests/ui/guest-chrome.test.tsx` — FAIL. **Step 3: Implement.** **Step 4: Run** — PASS.
- [ ] **Step 5: Verify in the browser** (classic menu and at least a book, a magazine and a board template; LTR and RTL; mobile width; with `CartBar` visible): no overlap, popups usable.
- [ ] **Step 6: Commit** `feat(menu): floating language and feedback popups in every style`.

### Task 4: Studio reads the messages and flips the switch

**Files:**
- Create: `src/server/studio/queries/feedback.ts` (list for a restaurant; permission `'view'` on the restaurant target), page `src/app/studio/(studio)/(app)/feedback/page.tsx`, nav entry in `src/studio/nav.ts`, studio messages in `src/studio/messages/*`
- Modify: the menu settings screen to expose the `feedback.enabled` switch (find where `salesSettings`/`engineConfig` is edited)
- Test: `tests/studio/feedback.test.ts`

- [ ] **Step 1: Failing tests**: a member sees only their restaurant's messages; contact details shown only to owners/managers; newest first.
- [ ] **Step 2–4: Run FAIL, implement, run PASS.**
- [ ] **Step 5: Verify in the browser** the list and the switch. **Step 6: Commit** `feat(studio): feedback inbox and switch`.

### Task 5: Whole-feature check

- [ ] `npx tsc --noEmit`, `npx vitest run`, `npx eslint src` (not `.`); `graphify update .`
- [ ] Browser pass over classic + three templates; then `superpowers:verification-before-completion`.
