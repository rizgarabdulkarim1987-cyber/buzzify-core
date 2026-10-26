# Staff appearance, logos and announcements Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Every signed-in person (owner, manager, cashier, kitchen) picks their own font, colours and button shape; the Buzzify logo replaces the typed name; the restaurant can show its own logo; Super Admins write announcements that every cashier, kitchen and Studio user sees.

**Architecture:** A person's choices are one validated JSON value on `User`, turned into CSS variable overrides on `<html>` by the Studio and till root layouts, so every existing component re-themes through the tokens in `src/studio/studio.css` without being forked. Announcements are a table in the same database (this app is Core: `docs/superpowers/specs/2026-10-24-single-core-backend.md`), written from a Super Admin Studio page and read by the till and Studio layouts; no cross-server transport.

**Tech Stack:** Next 16, React 19, Prisma 7, Zod, Vitest, Tailwind 4 (`src/studio/studio.css`), `defineAction`/`defineQuery` (`src/server/studio/framework`).

**Spec:** `docs/superpowers/specs/2026-10-26-staff-appearance-logo-announcements-design.md`

## Global Constraints

- Appearance is per person, on the account; no role can change another person's; no restaurant-wide staff theme.
- A choice with text/background or button-text/button contrast below WCAG AA (4.5:1 text, 3:1 button outline) is refused with a one-line reason (the swatch is disabled), never silently corrected.
- Status colours (`--s-danger`, `--s-success`, `--s-info`, `--s-accent`) are never user-editable.
- Fonts offered must render Arabic and Sorani; Arabic and Kurdish text is never split per character.
- No motion at all in the cashier (`cashier-no-motion`): applying an appearance is instant, no transitions added.
- The cashier keeps working offline: last appearance and last announcements are cached on the device.
- Buzzify logo footer on all Studio, cashier, kitchen and sign-in screens, small, costing no space on the order screen; restaurant logo in the header when set, else the Buzzify logo.
- Not in scope: guest menu, emails, receipts, announcement targeting, restaurant-written announcements.
- Announcements: one body per locale (en, ar, ckb), missing locale falls back to the first filled one; Super Admin only (`platform.settings`).
- Follow the CLAUDE.md skill chain per task (TDD, impeccable/21st for UI, verification); new UI strings go in all three message files and must keep `tests/studio/messages.test.ts` green.

## Review Focus

- Text colour equal to background colour (or white on white): the picker refuses it, the saved value can never be unreadable even if the API is called directly.
- A saved appearance naming a font removed later, or garbage JSON in the column: the layout falls back to defaults instead of crashing.
- Two staff on one till (PIN quick switch): after switching, the second person sees their own look, not the first's.
- Offline till with a cached announcement list: still shows it; an expired cached announcement is dropped by its end time.
- Announcement with Arabic-only body shown to an English user: falls back to the Arabic body, never an empty banner.
- Restaurant logo asset deleted or still processing: header falls back to the Buzzify logo.
- Background chosen very dark: footer picks the white logo variant, very light picks the black one.

---

### Task 1: Appearance rules (pure)

**Files:**
- Create: `src/lib/appearance.ts`
- Test: `tests/studio/appearance.test.ts`

**Interfaces:**
- Produces: `type Appearance = { font: FontKey; bg: string; text: string; button: string; buttonText: string; shape: 'round' | 'square' }`; `FONT_KEYS` and `FONTS: Record<FontKey, { label: string; stack: string }>`; `DEFAULT_APPEARANCE`; `contrast(a: string, b: string): number` (WCAG ratio of two `#rrggbb`); `checkAppearance(a: unknown): { ok: true; value: Appearance } | { ok: false; field: 'bg'|'text'|'button'|'buttonText'|'font'|'shape'; reason: string }`; `parseStoredAppearance(raw: unknown): Appearance` (never throws, falls back to defaults field by field); `appearanceVars(a: Appearance): Record<string, string>` (CSS variables to set on `<html>`); `isDark(bg: string): boolean`.

- [ ] **Step 1: Write failing tests** named `contrast black on white is 21`, `refuses text equal to background`, `refuses button text under 4.5 on button`, `accepts the default`, `parseStoredAppearance repairs garbage`, `parseStoredAppearance drops an unknown font`, `appearanceVars sets --s-btn-radius 9999px for round and 4px for square`, `isDark true for #111111`. Assert exact values from Global Constraints.
- [ ] **Step 2: Run** `npx vitest run tests/studio/appearance.test.ts` → FAIL (module missing).
- [ ] **Step 3: Implement** the signatures above. `appearanceVars` maps `bg`→`--s-bg` (and derives `--s-surface`, `--s-raised`, `--s-line`, `--s-hover`, `--s-pressed` by mixing toward the text colour), `text`→`--s-text` (and `--s-muted` as a mix kept ≥4.5:1 against `bg`), `button`→`--s-ink`/`--s-ink-hover`, `buttonText`→`--s-on-ink`, font→`--s-font`, shape→`--s-btn-radius`. Initial font list: the two Studio faces plus 3–4 fontsource faces with Arabic coverage (decide with `tests/studio/fonts.test.ts` as the coverage check).
- [ ] **Step 4: Run** the test → PASS. **Step 5: Commit** `feat(appearance): rules, contrast guard and CSS variables`.

### Task 2: Store and actions

**Files:**
- Modify: `prisma/schema.prisma` (model `User`: `appearance Json?`); create the migration with `npx prisma migrate dev --name user_appearance`
- Modify: `src/server/studio/actions/account.ts` (add `setAppearance`, `resetAppearance`), `src/server/studio/auth/actor.ts` (the Actor carries `appearance: Appearance`, parsed with `parseStoredAppearance`)
- Test: `tests/studio/appearance-actions.test.ts`

**Interfaces:**
- Consumes: `checkAppearance`, `parseStoredAppearance`, `DEFAULT_APPEARANCE` (Task 1).
- Produces: actions `account.setAppearance` (input: the six fields; `permission: null`, `target: () => SELF`, audit `account.appearance_changed` with before/after) and `account.resetAppearance`; `Actor.appearance`.

- [ ] **Step 1: Failing tests:** `saves own appearance and the actor reads it back`, `refuses unreadable text colour with the field and reason`, `cannot change another user's appearance` (input has no user id), `reset returns defaults`, `a cashier and a kitchen user can both save` (use `tests/pos/fixture.ts` for roles).
- [ ] **Step 2: Run** `npx vitest run tests/studio/appearance-actions.test.ts` → FAIL.
- [ ] **Step 3: Implement** as the signatures say, following `setStudioLanguage` in the same file; the refusal throws `StudioError` with the field name so the form can show it.
- [ ] **Step 4: Run** → PASS; also run `npx vitest run tests/studio/actor.test.ts tests/pos/actor.test.ts`. **Step 5: Commit** `feat(appearance): per-person store and actions`.

### Task 3: Apply it everywhere

**Files:**
- Modify: `src/app/pos/layout.tsx`, `src/app/studio/(studio)/layout.tsx` (set `style={appearanceVars(actor.appearance)}` on `<html>` for a signed-in person; none when signed out), `src/studio/studio.css` (`--s-btn-radius` default `6px`; the shared `Button` (`src/studio/ui/Button.tsx`) and the till's button classes use `rounded-(--s-btn-radius)`)
- Test: `tests/studio/appearance-apply.test.tsx`

**Interfaces:**
- Consumes: `Actor.appearance`, `appearanceVars`.

- [ ] **Step 1: Failing test:** rendering the layout with an actor whose shape is `round` puts `--s-btn-radius:9999px` on `<html>`; with a stored garbage value it renders defaults.
- [ ] **Step 2: Run** `npx vitest run tests/studio/appearance-apply.test.tsx` → FAIL. **Step 3: Implement** as above; load any new font through `src/studio/fonts.ts` the way the existing two are loaded and expose it in `studioFontVariables`.
- [ ] **Step 4: Run** → PASS; run `npx vitest run tests/studio` to catch regressions. **Step 5: Commit** `feat(appearance): apply the person's look in the Studio and the till`.

### Task 4: The picker

**Files:**
- Create: `src/app/studio/(studio)/(app)/account/AppearanceForm.tsx`
- Modify: `src/app/studio/(studio)/(app)/account/page.tsx`, `src/studio/messages/{en,ar,ckb}.ts` (labels, refusal reasons), `src/app/pos/(till)/layout.tsx` (header "Appearance" link to `/studio/account#appearance`)
- Test: `tests/studio/appearance-form.test.tsx`

**Interfaces:**
- Consumes: `account.setAppearance`, `resetAppearance`, `FONTS`, `contrast`.

- [ ] **Step 1: Failing tests:** `a swatch that fails contrast is disabled and names the reason`, `choosing round then saving calls setAppearance with shape round`, `reset restores defaults`. **Step 2: Run** → FAIL.
- [ ] **Step 3: Implement** with the project's `ui` kit (`Field`, `Select`, `Button`); a live preview panel uses `appearanceVars` on a wrapper element; colours are picked from swatches plus a hex field; choose with `impeccable` + `21st-ui-build`. No motion.
- [ ] **Step 4: Run** → PASS; verify in the Browser preview as owner and as cashier at mobile and desktop width. **Step 5: Commit** `feat(appearance): the picker on the account page`.

### Task 5: Offline cache of the look

**Files:**
- Modify: `src/app/pos/_ui/sync/SyncProvider.tsx` (store the last appearance vars by user id in `localStorage`; the offline page applies them)
- Test: `tests/pos/appearance-offline.test.ts`

- [ ] **Step 1: Failing test:** `restoreAppearance(userId)` returns the vars last stored for that user and defaults for another user. **Step 2: Run** → FAIL. **Step 3: Implement** `storeAppearance(userId, vars)` / `restoreAppearance(userId): Record<string,string>` in `src/app/pos/_ui/sync/appearance-cache.ts`, wrapped in try/catch; call from the provider and the offline page. **Step 4: Run** → PASS. **Step 5: Commit** `feat(appearance): keep the look while the till is offline`.

### Task 6: Logos

**Files:**
- Create: `public/brand/buzzify-dark.png`, `public/brand/buzzify-light.png` (from the two images the user sent: white wordmark on black circle; black wordmark with blue dot on white; trim the margins, make transparent-background PNG/SVG variants), `src/studio/shell/BrandLogo.tsx`, `src/studio/shell/BrandFooter.tsx`
- Modify: `src/studio/shell/Wordmark.tsx` (render the logo), `src/studio/shell/Sidebar.tsx`, `src/app/pos/(till)/layout.tsx` (restaurant logo in the header from `Restaurant.logoAssetId` via the media URL helper, else `BrandLogo`; `BrandFooter` below `<main>`), sign-in layout
- Test: `tests/studio/brand-logo.test.tsx`

**Interfaces:**
- Produces: `BrandLogo({ background: string; className?: string })` chooses the dark or light file with `isDark(background)`; `BrandFooter()` small centred mark, `print:hidden`.

- [ ] **Step 1: Failing tests:** `uses the white logo on a dark background and the black logo on a light one`, `falls back to the Buzzify logo when the restaurant logo asset is missing`, `footer is hidden when printing`. **Step 2: Run** → FAIL. **Step 3: Implement** as above; the order screen must not lose vertical space (footer outside the order screen's own scroll area; check at tablet size). **Step 4: Run** → PASS and look at all four roles' screens in the Browser preview. **Step 5: Commit** `feat(brand): Buzzify logo footer and restaurant logo header`.

### Task 7: Announcements, Super Admin side

**Files:**
- Modify: `prisma/schema.prisma` (`model Announcement { id String @id @default(cuid()); titles Json; bodies Json; startsAt DateTime @default(now()); endsAt DateTime?; archivedAt DateTime?; createdById String?; createdAt DateTime @default(now()) }`), migration `announcements`; `src/studio/nav.ts` (key `announcements`, in `SUPER_ADMIN_AREAS`), `src/studio/messages/{en,ar,ckb}.ts`
- Create: `src/server/studio/actions/announcements.ts` (`announcements.create`, `.update`, `.archive`; permission `platform.settings`, audited), `src/server/studio/queries/announcements.ts` (`announcements.list` for Super Admin; `announcements.active` returns, for the viewer's locale, `{ id; title; body; endsAt }[]` of announcements where `startsAt <= now < endsAt` and not archived; `permission: null`), `src/app/studio/(studio)/(app)/announcements/page.tsx` and `AnnouncementForm.tsx`
- Test: `tests/studio/announcements.test.ts`

**Interfaces:**
- Produces: `pickLocalised(map: Partial<Record<Locale,string>>, locale: Locale): string` in `src/lib/announcements.ts` (locale, else first filled, else empty).

- [ ] **Step 1: Failing tests:** `only a super admin can create`, `an owner gets 403 on create`, `active hides future, expired and archived`, `pickLocalised falls back to the first filled locale`, `an Arabic-only announcement reaches an English user as Arabic text`. **Step 2: Run** `npx vitest run tests/studio/announcements.test.ts` → FAIL. **Step 3: Implement** as above. **Step 4: Run** → PASS; `npx vitest run tests/studio/nav.test.ts tests/studio/messages.test.ts`. **Step 5: Commit** `feat(announcements): write them in the Studio`.

### Task 8: Announcements in the till and Studio

**Files:**
- Create: `src/app/pos/_ui/AnnouncementBar.tsx` (client), `src/app/pos/announcements/route.ts` (GET, returns `announcements.active` for the signed-in person; used for the 60-second refresh)
- Modify: `src/app/pos/(till)/layout.tsx`, `src/app/studio/(studio)/(app)/layout.tsx` (render the bar under the header; first load comes from the server, refresh by polling every 60 seconds while online), `src/studio/messages/{en,ar,ckb}.ts`
- Test: `tests/pos/announcements-bar.test.tsx`

**Interfaces:**
- Consumes: `announcements.active`; Produces: `AnnouncementBar({ initial: Active[]; userId: string })` with dismissal stored in `localStorage` keyed by `userId` and announcement id, and the last list cached the same way (my call: dismissal is per person per device; revisit if it must follow the person).

- [ ] **Step 1: Failing tests:** `shows the active announcements`, `dismissing hides it for that user but not for another user on the same till`, `offline shows the cached list and drops one past its endsAt`. **Step 2: Run** → FAIL. **Step 3: Implement**; no animation; the bar is one line with a "read all" disclosure and does not push the order screen's content below the fold (check at tablet size). **Step 4: Run** → PASS; verify in the Browser preview: create an announcement as Super Admin, see it at the cashier and kitchen within a minute. **Step 5: Commit** `feat(announcements): show them to cashier, kitchen and Studio`.

### Task 9: Whole-feature check

- [ ] **Step 1:** `npm run lint` (src, not `.`), `npm run typecheck`, `npx vitest run`; all green.
- [ ] **Step 2:** `graphify update .`.
- [ ] **Step 3:** Run `superpowers:verification-before-completion`, then `code-review`; fix findings. No push or PR without the user's go-ahead (no `gh`: PRs go through the browser compare URL).
