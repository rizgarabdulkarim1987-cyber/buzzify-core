# Menu Wheel of Fortune Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** An optional wheel in every menu style: slices are real dish photos, the server picks the winning dish, the guest sees it enlarged and can add it to the order; the restaurant sets it up and switches it on.

**Architecture:** New tables `MenuWheel` and `WheelSlice`, read per request. A public POST route `/api/{tenant}/wheel` picks the winner on the server and limits spins per guest per day with a signed cookie plus a per-IP-per-day count. The header gets a wheel entry beside `GuestTools` when `tenant.extras.wheel` is on; the wheel opens as a popup in the menu's client tree so the existing product sheet can open on the result.

**Tech Stack:** as in `2026-10-29-menu-intro.md`. **Depends on the intro plan's Tasks 1 and 2** (feature key `menu.wheel`, `Menu.wheelEnabled`, `TenantInfo.extras`) and shares the header entry pattern built in the About plan's Task 3 (`GuestTools`); build those first.

**Spec:** `docs/superpowers/specs/2026-10-29-menu-wheel-of-fortune-design.md`.

## Global Constraints

- Same test, audit, cross-tenant, message-parity, tenant-registry and commit rules as the intro plan.
- The winner is chosen only on the server (`crypto.randomInt` weighted draw); the browser never sends a slice or receives the other slices' weights; the animation lands where the server's answer says.
- 4 to 12 slices; each slice is a product of this menu with at least one `kind: 'image'` media; a hidden, deleted or unavailable product is skipped at spin time (a wheel with fewer than 4 usable slices answers "not available" and the entry hides).
- Spins per guest per day: default 1 (1 to 10), counted per (menu, signed guest cookie) and per (menu, IP, day) with the IP limit three times the guest limit so a shared Wi-Fi is not blocked after one guest. Day boundaries in the menu's `timezone`.
- No money moves; an optional slice label is information only. No cashier discount in this plan.
- `prefers-reduced-motion`: no spinning; a "Reveal" button shows the result at once.
- Guest words in en, ar, ckb; right-to-left layout for ar and ckb (the pointer stays at the top).
- Studio location (ruling, recorded): a Studio menu tab for OWNER and DESIGNER (`content.edit`), because till MANAGERs exist only for restaurants with the cashier; a till page for managers is a follow-up that reuses the same actions with a till target.

## Review Focus

- A guest who clears cookies and spins again: the IP-per-day count still stops the abuse; a different guest on the same Wi-Fi is not blocked by one spin.
- Two simultaneous spin requests from one guest at the limit: only one winner is returned (the counter increments inside a transaction or with a unique key).
- Weights: all zero, one huge, negative, non-integer: refused on save; a slice with weight 0 never wins.
- A winning product that was made unavailable one second before: the server redraws among usable slices; never returns an unorderable dish.
- Phone with reduced motion or low memory: the Reveal path works without the canvas; a 12-slice wheel with long Arabic or Kurdish dish names stays legible.
- The wheel entry on a menu whose active window has not opened or has ended: hidden.
- A forged cookie: ignored and replaced; never grants extra spins.

---

### Task 1: Data model and draw rules

**Files:**
- Modify: `prisma/schema.prisma`, `src/server/data/tenant-db.ts`, `tests/helpers/db.ts`
- Create: `prisma/migrations/20261029120000_menu_wheel/migration.sql`, `src/server/domain/wheel.ts`
- Test: `tests/domain/wheel.test.ts`, `tests/data/tenant-registry.test.ts`

**Interfaces:**
- Produces: `MenuWheel { menuId @unique, spinsPerDay Int @default(1), startsAt DateTime?, endsAt DateTime?, title Json }`; `WheelSlice { id, wheelId, menuId, productId, label Json, weight Int @default(1), sortOrder Int }` (menu-scoped, `@@unique([wheelId, productId])`); `WheelSpin { id, menuId, guestKey String, ipHash String, day String ('YYYY-MM-DD'), createdAt }` with `@@index([menuId, day, guestKey])` and `@@index([menuId, day, ipHash])`; in `wheel.ts`: `drawSlice(slices: {id: string; weight: number}[], random: (n: number) => number): string`, `validateWheel({slices, spinsPerDay})`, `wheelOpen(wheel, now)`, `dayOf(now, timeZone)`, `spinAllowed({guestSpins, ipSpins, spinsPerDay})`.

- [ ] **Step 1: Write failing tests** `tests/domain/wheel.test.ts`: `drawSlice picks by weight with a seeded random and never a zero-weight slice`; `validateWheel needs 4 to 12 slices, integer weights from 1 to 100, spinsPerDay 1 to 10`; `wheelOpen follows the window`; `dayOf uses the time zone`; `spinAllowed allows the guest limit and three times that per IP`.
- [ ] **Step 2: Run** `npx vitest run tests/domain/wheel.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement** the schema, migration, registry and `resetTestData` entries, `wheel.ts`; `npm run db:generate`. `WheelSpin` rows are pruned after 3 days by a function added next to `prunePublicRateLimits` and called wherever that is called.
- [ ] **Step 4: Run** the domain test and the registry test. Expected: PASS.
- [ ] **Step 5: Commit** `feat(menu): wheel tables and draw rules`.

### Task 2: Studio actions and queries

**Files:**
- Create: `src/server/studio/actions/wheel.ts`, `src/server/studio/queries/wheel.ts`, `src/server/studio/services/wheel.ts`, `src/app/studio/_actions/wheel.ts`
- Modify: `src/server/domain/audit-actions.ts`, `tests/studio/cross-tenant.test.ts`, catalogs
- Test: `tests/studio/wheel.test.ts`

**Interfaces:**
- Produces (`content.edit`, menu target): `menus.setWheelEnabled({menuId, enabled})`, `menus.saveWheel({menuId, spinsPerDay, startsAt, endsAt, title, slices: {productId, label, weight}[]})` (replaces the slice set in one transaction), query `menus.wheel({menuId})` returning slices with each product's name and first photo, and the list of products that can be slices (menu products with an image). Audit `menu.wheel_changed`, entities `MenuWheel`, `WheelSlice`. `expireMenu` after commit.

- [ ] **Step 1: Failing tests:** `saves 6 slices and turns it on`; `refuses 3 or 13 slices, a duplicate product, a product of another menu, a product with no photo`; `refuses weight 0 or 101`; `turning it on without a saved wheel is refused`; `needs the plan feature`.
- [ ] **Step 2: Run.** Expected: FAIL.
- [ ] **Step 3: Implement**, add the cross-tenant entries (naming B's menu and B's product) and the audit labels.
- [ ] **Step 4: Run** `tests/studio/wheel.test.ts tests/studio/cross-tenant.test.ts tests/studio/activity.test.ts tests/studio/messages.test.ts`. Expected: PASS.
- [ ] **Step 5: Commit** `feat(studio): wheel actions`.

### Task 3: Public spin route

**Files:**
- Create: `src/app/api/[tenant]/wheel/route.ts` (GET state, POST spin), `src/server/data/wheel.ts` (`loadWheelState`, `spin`), `src/server/http/guest-cookie.ts`
- Modify: `src/server/http/schemas.ts`
- Test: `tests/api/wheel.test.ts`

**Interfaces:**
- Produces: `GET` returns `{ available: boolean; slices: { productId; name; photo: {url; width; height}; label }[]; spinsLeft: number }` (no weights); `POST {}` with `handleTenantRequest(..., { route: 'wheel', limit: 20, schema: z.strictObject({}) })` returns `{ winnerProductId, label, spinsLeft }` or `429`/`409` problems `SPINS_USED`, `NOT_AVAILABLE`. `guest-cookie.ts`: `signedGuestKey(request, secret): { key: string; setCookie?: string }` using HMAC with a server secret from the existing environment configuration (builder reads how POS device cookies get theirs, `src/server/pos/device-cookie.ts`); cookie `bz_guest`, `HttpOnly; SameSite=Lax; Max-Age` one year, `Path=/`.

- [ ] **Step 1: Write failing tests** with the route handlers called directly (style of `tests/api/public-routes.test.ts`): `a first spin returns a winner among usable slices and a second the same day is 409 SPINS_USED`; `a forged cookie is replaced and gets no extra spin`; `the same IP without cookies is stopped after three times the guest limit`; `an unavailable winner is redrawn among the rest`; `fewer than 4 usable slices answers NOT_AVAILABLE`; `GET never returns weights`; `a closed window answers NOT_AVAILABLE`; `concurrent spins at the limit return one winner` (two `Promise.all` posts).
- [ ] **Step 2: Run** `npx vitest run tests/api/wheel.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement** the loader and spin inside one transaction (count with `WheelSpin` rows, insert on success, unique-safe), the cookie helper and the route; responses carry `cache-control: no-store`.
- [ ] **Step 4: Run** the test and `tests/api/rate-limit.test.ts`. Expected: PASS.
- [ ] **Step 5: Commit** `feat(menu): wheel spin route`.

### Task 4: The wheel UI and the header entry

**Files:**
- Create: `src/ui/wheel/WheelPopup.tsx`, `src/ui/wheel/WheelDisc.tsx`, `src/ui/wheel/useWheel.ts`
- Modify: `src/ui/guest/GuestTools.tsx` (a wheel button beside About), `src/ui/menu/MenuApp.tsx` and `src/ui/template/TemplateMenu.tsx` (mount `WheelPopup` next to the product sheet so `openProduct(id)` is available), `src/lib/messages/{en,ar,ckb}.ts` (`wheel.title`, `wheel.spin`, `wheel.reveal`, `wheel.result`, `wheel.order`, `wheel.usedToday`, `wheel.notAvailable`, `wheel.again`)
- Test: `tests/ui/wheel.test.ts`

**Interfaces:**
- Consumes: the route of Task 3, `useProductSheet().openProduct`, `Popup`.
- Produces: `WheelPopup({ open, onClose, openProduct })`: loads state, draws the disc (SVG with the slices' photos as `<pattern>` images, pointer at the top, mirrored labels for RTL), spins with CSS rotation to the server's winner then shows the dish enlarged with price and an "Add to order" button that calls `openProduct(winnerProductId)`; "used today" state when `spinsLeft` is 0; reduced motion shows "Reveal".

- [ ] **Step 1: Failing tests (static markup and a pure helper):** `angleFor(sliceIndex, count)` lands the pointer in the middle of the slice; `renders count slices with their photos`; `renders the Reveal button and no spin animation class when reduced motion is requested`; `renders the used-today message when spinsLeft is 0`.
- [ ] **Step 2: Run.** Expected: FAIL.
- [ ] **Step 3: Implement** the popup and wire it into both menus; verify in the browser pane at 375 px in en and ar with 4, 8 and 12 slices and long names; confirm a result opens the product sheet.
- [ ] **Step 4: Run** `tests/ui/wheel.test.ts tests/lib/messages.test.ts`, typecheck, lint.
- [ ] **Step 5: Commit** `feat(menu): wheel of fortune popup`.

### Task 5: Studio "Wheel" tab

**Files:**
- Create: `src/app/studio/(studio)/(app)/menus/[id]/wheel/page.tsx`, `src/studio/workspace/wheel/WheelForm.tsx`, `src/studio/workspace/wheel/SlicePicker.tsx`
- Modify: `src/studio/workspace/tabs.ts` (`'wheel'`, `workspace.tab.wheel`, `needs: ['content.edit']`), catalogs
- Test: `tests/studio/workspace-tabs.test.ts`, `tests/studio/messages.test.ts`

**Interfaces:**
- Produces: the form (on/off, spins per day, dates, title per language, the slice picker showing each dish's photo with weight and label fields, a live preview with `WheelDisc`) and the picker's rules shown inline (4 to 12, photo required).

- [ ] **Step 1: Failing tests:** the tab registers and is labelled in three catalogs.
- [ ] **Step 2: Run.** Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** tests, typecheck, lint; browser pane: set up six dishes, switch on, spin in the menu, hit the daily limit.
- [ ] **Step 5: Commit** `feat(studio): wheel tab`.

### Task 6: Whole-feature checks

- [ ] Full suite into the scratchpad file, tail read (only the known ai-import failure allowed); `graphify update .`.
