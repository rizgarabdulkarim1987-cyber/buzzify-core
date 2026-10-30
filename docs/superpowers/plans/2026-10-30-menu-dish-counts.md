# Dish Counts (orders and views on every dish) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Every dish card shows "N orders · N views" from real data, behind a super-admin grant and an owner switch, with view counting that cleared cookies cannot inflate.

**Architecture:** Orders are read live from paid cashier lines (`PosOrderLine`), views are counted at ingest into a permanent per-dish total guarded by short-lived marks (cookie key plus salted address hash, the wheel's pattern). The numbers reach the menu through `loadMenuView` extras like `mostOrdered`, and render inside the shared `Badges` component. The grant is an entitlement, the owner switch is a `Menu` column read live like `wheelEnabled`.

**Tech Stack:** Next.js, Prisma (`src/generated/prisma`), vitest (`tests/`), studio actions via `defineAction`, messages in en, ar, ckb.

**Spec:** `docs/superpowers/specs/2026-10-30-menu-dish-counts-design.md`

## Global Constraints

- No ratings, no per-dish visibility, no time windows, nobody can edit or reset a number (spec).
- A dish shows nothing until it has at least one paid order; then one line with both numbers (orders, views).
- Orders: sum of `quantity` of `PosOrderLine` with `cancelledAt: null`, `payment: { is: { reversal: null } }`, `paymentId` not null, `productId` in this menu's products; comped lines count; all time.
- Views: one device (signed `bz_guest` cookie key) counts once per dish per day (`dayOf(now, tenant.timeZone)`); one address (`hashAddress`, never the raw IP) at most `VIEW_IP_LIMIT = 3` per dish per day; bots, previews and cashier traffic never count.
- Numbers are never stored in the published snapshot. Cache about 60 seconds.
- Entitlement `menu.dishCounts` starts in `PRO`; shown only when the grant and `Menu.dishCountsEnabled` are both on; removing either just hides, stored data stays.
- Studio texts and guest texts in en, ar, ckb. The cashier gets no change and no motion. Never break a current menu style.

## Review Focus

- A dish with views but no paid order must show nothing (test in Task 6 and Task 8).
- Two tabs sending the same view at once must count once (Task 4).
- The same address with four fresh cookies counts 3, not 4 (Task 4).
- A `PRODUCT_VIEW` for a product of another menu, or with no product, must not count (Task 4).
- A dish deleted from the menu (`productId` null on old lines) and refunded lines must not count (Task 5).
- Large numbers (1,200,000) and Arabic/Kurdish plural forms must not overflow or read wrong in RTL (Task 8).
- A menu with hundreds of dishes must use one grouped query for orders and one for views, not one per dish (Task 5).

---

### Task 1: Schema

**Files:**
- Modify: `prisma/schema.prisma` (model `Menu` near line 218; add two models after `WheelSpin`)
- Modify: `src/server/data/tenant-db.ts:11` (the list of menu-scoped models: add `'ProductViewMark'`, `'ProductViewTotal'`)
- Create: a migration via `npx prisma migrate dev --name dish_counts` (use this worktree's own `BUZZIFY_DB_PORT`)
- Test: `tests/data/tenant-db.test.ts` (extend)

**Interfaces:**
- Produces: `Menu.dishCountsEnabled Boolean @default(false)`; `ProductViewTotal { menuId, productId, views Int }` unique `[menuId, productId]`; `ProductViewMark { id, menuId, productId, day String, guestKey String, ipHash String, createdAt }` unique `[menuId, productId, day, guestKey]`, index `[menuId, productId, day, ipHash]`, index `[createdAt]`. Both models relate to `Menu` with `onDelete: Cascade`; `productId` is a plain string (no relation) so a deleted dish never blocks.

- [ ] **Step 1:** Extend `tests/data/tenant-db.test.ts` so it asserts the two new models are menu-scoped (follow how `WheelSpin` is asserted there). Run it, expect FAIL.
- [ ] **Step 2:** Add the column, the two models (doc comments in the file's style: "kept three days, no personal data") and the list entries. Run `npx prisma migrate dev --name dish_counts` and `npx prisma generate`.
- [ ] **Step 3:** Run `npx vitest run tests/data/tenant-db.test.ts`, expect PASS.
- [ ] **Step 4:** Commit `feat(menu): schema for dish view totals and the owner switch`.

### Task 2: Entitlement and guest gate

**Files:**
- Modify: `src/server/domain/entitlements.ts` (FEATURES, after `menu.wheel`: `{ key: 'menu.dishCounts', area: 'selling', status: 'live', project: 1, startsIn: 'PRO' }`)
- Modify: `src/server/domain/plan-choices.ts` (`GuestFeatures.dishCounts`, `guestFeatures`)
- Modify: `src/server/data/tenant.ts:81` (`extras` gets `dishCounts: boolean`) and `src/server/data/public-menu.ts:72-130` (select `dishCountsEnabled`, set `dishCounts: (menu.dishCountsEnabled ?? false) && features.dishCounts`)
- Modify: `src/studio/messages/{en,ar,ckb}.ts` (`'plans.feature.menu.dishCounts'`, near line 3097 of en)
- Test: `tests/domain/entitlements.test.ts`, `tests/domain/plan-choices.test.ts`, `tests/data/guest-plans.test.ts`

**Interfaces:**
- Produces: `tenant.extras.dishCounts: boolean` (true only when grant and switch are both on).

- [ ] **Step 1:** Tests: PRO plan allows `menu.dishCounts`, BASIC does not, a restaurant extra grants it on BASIC; `tenantInfo(...)` gives `extras.dishCounts` false when the switch is off or the grant missing, true when both on. Run, expect FAIL.
- [ ] **Step 2:** Implement the entries above and the three message files. Run the three test files, expect PASS. Run `npx tsc --noEmit` (the message files are typed together).
- [ ] **Step 3:** Commit `feat(menu): dish counts entitlement and guest gate`.

### Task 3: Pure rules

**Files:**
- Create: `src/server/domain/dish-counts.ts`
- Test: `tests/domain/dish-counts.test.ts`

**Interfaces:**
- Produces:
  - `export const VIEW_IP_LIMIT = 3`
  - `export function isCountableAgent(userAgent: string | null): boolean` (false for empty/missing, bots, crawlers, link previews: match `bot|crawl|spider|slurp|preview|facebookexternalhit|whatsapp|telegram|headless|lighthouse` case-insensitively)
  - `export function viewCounts(input: { deviceSeen: boolean; addressViews: number }): boolean` (true only when `!deviceSeen && addressViews < VIEW_IP_LIMIT`)
  - `export function showsCounts(orders: number): boolean` (`orders > 0`)

- [ ] **Step 1:** Write tests: `isCountableAgent('Mozilla/5.0 (iPhone...)')` true; `'Googlebot/2.1'`, `'WhatsApp/2.23'`, `''`, `null` false; `viewCounts({deviceSeen:false,addressViews:2})` true, `addressViews:3` false, `deviceSeen:true` false; `showsCounts(0)` false, `showsCounts(1)` true. Run, expect FAIL.
- [ ] **Step 2:** Implement. Run, expect PASS.
- [ ] **Step 3:** Commit `feat(menu): dish count rules`.

### Task 4: View ingest with the guard

**Files:**
- Create: `src/server/data/product-views.ts`
- Modify: `src/app/api/[tenant]/events/route.ts` (after `recordEvents`, count the `PRODUCT_VIEW` events; read `readGuestKey`, make `newGuestKey` when missing and send `set-cookie` with the 204; address from `x-forwarded-for` as in `src/app/api/[tenant]/wheel/route.ts`)
- Modify: `src/server/http/rate-limit.ts` (add `pruneProductViewMarks(prisma, before)` beside `pruneWheelSpins`) and `src/app/api/cron/publish/route.ts:25` (call it with 3 days)
- Test: `tests/data/product-views.test.ts`, `tests/api/events.test.ts` (extend if it exists, else create next to the other api tests)

**Interfaces:**
- Consumes: `isCountableAgent`, `viewCounts` (Task 3); `hashAddress`, `newGuestKey`, `readGuestKey` from `src/server/http/guest-cookie.ts`; `dayOf` from `src/server/domain/wheel`.
- Produces: `export async function countProductViews(prisma: PrismaClient, input: { menuId: string; timeZone: string; guestKey: string; ipHash: string; userAgent: string | null; productIds: string[]; now: Date }): Promise<number>` returning how many views were added.

- [ ] **Step 1:** Tests (use the project's fixture helpers; see `tests/data/tenant-db.test.ts` for a seeded menu): a first view adds 1 to `ProductViewTotal`; same guest, same dish, same day adds 0; same guest next day adds 1; four fresh guest keys from one address add 3 in total; a bot user agent adds 0; a product id of another menu adds 0; an unknown id adds 0; two calls for the same guest at once (`Promise.all`) add exactly 1; marks older than 3 days are removed by `pruneProductViewMarks` while totals stay. Route test: a `PRODUCT_VIEW` event posted without a cookie returns 204 with a `set-cookie` for `bz_guest`. Run, expect FAIL.
- [ ] **Step 2:** Implement `countProductViews`: keep only product ids that exist in this menu (`menuDb(prisma, menuId).product.findMany`), then for each: create the mark (a `P2002` means this device already counted: skip, as `spin` does), count marks by `ipHash` for that dish and day, if over `VIEW_IP_LIMIT` delete the mark and skip (the wheel's after-insert recheck), else `productViewTotal.upsert` with `increment: 1`. Wire the route and the prune.
- [ ] **Step 3:** Run both test files, expect PASS. Confirm staff preview and cashier pages never post to this route: `grep -rn "api/.*/events\|track(" src/app/studio src/app/pos src/ui/**/*Preview*` shows none, or add the exclusion and a test.
- [ ] **Step 4:** Commit `feat(menu): count dish views once per device, three per address`.

### Task 5: Reading the numbers

**Files:**
- Create: `src/server/data/dish-counts.ts`
- Test: `tests/data/dish-counts.test.ts`

**Interfaces:**
- Produces:
  - `export type DishCounts = Map<string, { orders: number; views: number }>`
  - `export async function loadDishCounts(prisma: PrismaClient, menuId: string): Promise<DishCounts>` (one `groupBy` on `posOrderLine` as in `src/server/data/most-ordered.ts` without the `since`, plus `paymentId: { not: null }`; one `findMany` on `productViewTotal`; a dish appears when it has any order)
  - `export function cachedDishCounts(prisma: PrismaClient, menuId: string): Promise<Array<[string, { orders: number; views: number }]>>` using `cached(..., ['dish-counts', menuId], { revalidate: 60, tags: [`menu:${menuId}:dish-counts`] })` (arrays, not Map, so it serializes through the cache)

- [ ] **Step 1:** Tests with the POS fixture (`tests/pos/fixture.ts`): a paid line counts its quantity; unpaid, cancelled and refunded (payment with a reversal) lines count 0; a comped line counts; a line of another menu's product counts for no dish here; a line whose product was deleted is ignored; views come from `ProductViewTotal`; a dish with views and no paid order is absent from the result; 300 dishes still run two queries (count them with a Prisma query log or assert on the helper call count). Run, expect FAIL.
- [ ] **Step 2:** Implement. Run, expect PASS.
- [ ] **Step 3:** Commit `feat(menu): read dish orders and views`.

### Task 6: Into the menu view

**Files:**
- Modify: `src/server/data/menu-view.ts` (`MenuProductView.counts?: { orders: number; views: number }`; `buildMenuView` extras gets `dishCounts?: ReadonlyMap<string, {orders:number;views:number}>`; set `counts` only when `showsCounts(orders)`)
- Modify: `src/server/route-context.ts` (when `tenant.extras?.dishCounts`, load `cachedDishCounts` in the existing `Promise.all`)
- Test: `tests/data/menu-view.test.ts`

**Interfaces:**
- Consumes: `showsCounts` (Task 3), `cachedDishCounts` (Task 5), `tenant.extras.dishCounts` (Task 2).
- Produces: `product.counts` on `MenuProductView`, absent when the dish has no paid order or the feature is off.

- [ ] **Step 1:** Tests: with the extras given, a dish with 5 orders and 40 views has `counts: {orders:5, views:40}`; a dish with 0 orders and 12 views has no `counts` property; with the feature off no dish has it. Run, expect FAIL.
- [ ] **Step 2:** Implement (spread the property only when it applies, like `mostOrdered`, so unrelated menus are unchanged). Run, expect PASS.
- [ ] **Step 3:** Commit `feat(menu): dish counts in the menu view`.

### Task 7: Owner switch in the Studio

**Files:**
- Create: `src/server/studio/actions/dish-counts.ts` exporting `setMenuDishCountsEnabled` (copy the shape of `setMenuWheelEnabled` in `src/server/studio/actions/wheel.ts`: name `menus.setDishCountsEnabled`, permission `content.edit`, feature `menu.dishCounts`, audit action `menu.dish_counts_changed`, `expireMenu(slugs, menuId)` and revalidate tag `menu:${menuId}:dish-counts` after commit)
- Modify: `src/app/studio/_actions/` (add the re-export the same way `sales.ts` does), `src/studio/workspace/sales/SalesSettingsForm.tsx` (a `SwitchRow` with `feature="menu.dishCounts"` calling the action; the row shows the plan lock through `UpgradeHint` like the others)
- Modify: `src/studio/messages/{en,ar,ckb}.ts` (row label and hint: the numbers are real and nobody can edit them; shown on every dish once it has an order; `'activity.action.menu.dish_counts_changed'`)
- Test: `tests/studio/dish-counts.test.ts` (follow `tests/studio/sales.test.ts`) and a cross-tenant case in `tests/studio/cross-tenant.test.ts`

**Interfaces:**
- Consumes: `Menu.dishCountsEnabled` (Task 1), feature key (Task 2).
- Produces: `setMenuDishCountsEnabled({ menuId, enabled })`, returns `{ enabled }`.

- [ ] **Step 1:** Tests: an owner with the grant switches it on and off and the row is audited; without the grant the action is refused with the plan error; another restaurant's menu id is `NOT_FOUND`; a viewer without `content.edit` is refused. Run, expect FAIL.
- [ ] **Step 2:** Implement the action, the form row and the messages. Run the test files, expect PASS; `npx tsc --noEmit` clean.
- [ ] **Step 3:** The super admin grant needs no new screen: confirm `menu.dishCounts` appears in the restaurant's extras list in the Studio (it reads `FEATURES`). Commit `feat(studio): owner switch for dish counts`.

### Task 8: The line on every card

**Files:**
- Modify: `src/ui/template/parts.tsx` (`Badges`: also render when `product.counts` exists; add a `DishCounts` span `tpl-counts tabular-nums` after the badges), `src/ui/menu/SalesLabels.tsx` (`hasSalesPills` and `SalesPills` for the classic rows and `ProductDetail`), shared CSS in `src/ui/template/shared/` for `.tpl-counts` (small, muted, no motion, wraps, `dir` follows the page)
- Modify: `src/lib/messages/{en,ar,ckb}.ts` (`'menu.counts.orders'` and `'menu.counts.views'` with the language's plural forms; use the number formatter the menu already uses)
- Test: `tests/ui/dish-counts.test.tsx`

**Interfaces:**
- Consumes: `product.counts` (Task 6).

- [ ] **Step 1:** Tests (render with the project's UI test setup): a product with `counts` shows both numbers in en, ar and ckb; a product without `counts` renders no counts node; 1200000 does not overflow its container class; a source test lists every file in `src/ui/template/bodies/*Body.tsx` and asserts each renders `Badges` or `DishCounts` (the files that deliberately do not are listed in the test with a reason). Run, expect FAIL.
- [ ] **Step 2:** Implement. For each body the audit flags, add `Badges` or `DishCounts` in the spot that fits that layout without changing its structure (spec: the line is one more small element). Run, expect PASS.
- [ ] **Step 3:** Commit `feat(menu): dish orders and views line on every card`.

### Task 9: Verify

- [ ] **Step 1:** `npx vitest run` and `npx tsc --noEmit` and `npx eslint src` (not `.`; see the project's lint note). All clean.
- [ ] **Step 2:** Start the dev server (`preview_start`), seed a menu with a grant and the switch on, place a paid cashier order, open the menu: the dish shows the line; a dish without orders shows nothing; switch off in the Studio: nothing shows. Check a classic menu and at least five template styles, in en, ar (RTL) and ckb, at phone width. Use `break-ui` for the 1,000-row and 1,200,000-number cases.
- [ ] **Step 3:** `graphify update .`. Report what was and was not checked, then use `superpowers:finishing-a-development-branch`.
