# Single Core, phases 1 and 2: the POS foundation and one catalog. Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** This application (Buzzify Core) gets a `/pos` area with its own roles, settings and staff, gated by the restaurant's live `cashier` subscription, and the cashier's products are the Menu's own tables (no second catalog), edited from `/pos/catalog`.

**Architecture:** Cashier code lives in `src/server/pos/*` (services), `src/server/domain/pos/*` (pure rules), `src/app/pos/*` (pages) and new `Pos*` tables, all keyed by `restaurantId`. Cashier roles are **separate from the Studio's `MemberRole`** so the Studio's permission code, invitations and enforcement tests do not change (a deliberate refinement of spec section 4, which proposed extending `MemberRole`). A restaurant's catalog is the `Menu` named by `PosSettings.catalogMenuId`; a cashier-only restaurant gets an unpublished (`DRAFT`) menu for it. The till reads the menu's draft rows. Guests keep reading the live revision, exactly as today.

**Tech Stack:** Next.js 16.4.1, React 19.3.1, Prisma 7.10 on PostgreSQL, Better Auth 1.7.10, Zod 4, Vitest 5, Playwright 1.64; messages in en/ar/ckb.

**Spec:** `docs/superpowers/specs/2026-10-24-single-core-backend.md` (sections 3, 4, 7 phases 1 and 2). Menu facts: `docs/superpowers/specs/2026-10-24-cashier-link-menu-side.md`. Cashier reference code (read-only): `C:\Users\pc\Documents\GitHub\buzzify-restaurant` (`src/server/auth/permissions.ts`, `src/server/services/{staff,settings,pin,catalog,kitchen-sections}.ts`).

## Global Constraints

- Work in a worktree off `origin/main` with its own database port (`BUZZIFY_DB_PORT`, never 54329 or 54349). Migrations are written and applied only to that database; no `migrate dev`/reset on a shared database; no push, no deploy, no production.
- Money: integer minor units, IQD without decimals. A restaurant's catalog menu must have `currency = 'IQD'`.
- A menu-only restaurant behaves exactly as today: no new query on public pages, no new Studio item for it, no change to `effectivePermissions` results for any existing role (a golden test pins this).
- Every new model with a required `restaurantId` is registered in `RESTAURANT_SCOPED_MODELS` (`src/server/data/tenant-db.ts`); `tests/data/tenant-registry.test.ts` stays green.
- Every cashier write goes through the Studio action framework (`defineAction`, audit in the same transaction); `tests/studio/enforcement.test.ts` stays green.
- ar, ckb and en for every string, RTL for ar and ckb; the en/ar/ckb key parity test covers the new `pos.*` messages.
- Commit with the trailer `Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>`; stage explicit paths only.
- Decision assumed, confirm with the owner before phase 3: **the till reads the draft rows** (a price edit shows at the till at once; guests see it after publish). The Studio already shows "unpublished changes" (`draftHash` vs `liveHash`).

## Review Focus

- A user who is a Studio DESIGNER of restaurant A and POS CASHIER of restaurant B: each area shows only its own role's powers; neither leaks into the other (Tasks 3, 4).
- A cashier whose restaurant's `cashier` subscription is EXPIRED or whose restaurant is SUSPENDED: `/pos` answers a clear "plan inactive" page and no service writes (Task 4).
- A restaurant with several menus, or with none, or whose only menu is in USD: the catalog menu choice is explicit and refused when not IQD (Task 6).
- A product name of 120 Arabic characters, a 1,000-product menu, an empty menu: the till catalog and setup page render and stay fast (Tasks 7, 8).
- A manager removing the last OWNER, or deactivating themselves: refused with a reason (Task 5).

---

# Phase 1: the POS foundation

### Task 1: Cashier roles and permissions (pure)

**Files:**
- Create: `src/server/domain/pos/permissions.ts`
- Test: `tests/pos/permissions.test.ts`

**Interfaces:**
- Produces: `POS_ROLES = ['OWNER','MANAGER','CASHIER','KITCHEN'] as const`, `type PosRole`; `POS_PERMISSIONS` (the cashier's 16 keys, copied verbatim from the cashier repo's `permissions.ts`: `catalog.manage, staff.manage, settings.manage, order.handle, order.discount, order.cancel, payment.take, payment.refund, shift.use, report.view, kitchen.view, inventory.view, inventory.manage, purchase.manage, complaint.view, complaint.manage`); `canPos(role: PosRole, permission: PosPermission): boolean`; `posPermissionsOf(role): ReadonlySet<PosPermission>`; `posLanding(role): 'tables' | 'kitchen'`.

- [ ] **Step 1: Write the failing test.** `OWNER and MANAGER hold every permission`; `CASHIER holds exactly order.handle, order.discount, order.cancel, payment.take, shift.use, inventory.view`; `KITCHEN holds exactly kitchen.view`; `landing is kitchen for KITCHEN and tables otherwise`; `the key list has no duplicates and the 16 keys above`.
- [ ] **Step 2: Run** `BUZZIFY_DB_PORT=<port> npx vitest run tests/pos/permissions.test.ts`. Expected: FAIL, module missing.
- [ ] **Step 3: Implement** `src/server/domain/pos/permissions.ts` as a port of the cashier matrix (no Prisma import, so it is pure).
- [ ] **Step 4: Run** the test. Expected: PASS.
- [ ] **Step 5: Commit** `feat(pos): cashier roles and permissions`.

### Task 2: Schema for settings and staff (migration written, applied to the private DB only)

**Files:**
- Modify: `prisma/schema.prisma`, `src/server/data/tenant-db.ts` (add `'PosSettings'`, `'PosStaff'` to `RESTAURANT_SCOPED_MODELS`), `tests/helpers/db.ts` (`resetTestData` needs no change: restaurant deletion cascades)
- Create: `prisma/migrations/<timestamp>_pos_foundation/migration.sql` (via `prisma migrate dev --create-only` on the private DB, then `migrate deploy` there)
- Test: `tests/pos/schema.test.ts`

**Interfaces:**
- Produces models:
  - `enum PosRole { OWNER MANAGER CASHIER KITCHEN }`, `enum PosPaymentMethod { CASH ZAINCASH FIB QICARD }`.
  - `PosSettings` (`restaurantId @unique`; `serviceRatePercent Int @default(0)`, `taxRatePercent Int @default(0)`, `enabledPaymentMethods PosPaymentMethod[] @default([CASH])`, `kitchenPrintEnabled`, `kitchenScreenEnabled`, `qrOrderingEnabled`, `takeawayEnabled`, `deliveryEnabled`, `complaintsEnabled` all `Boolean @default(false)`, `tableRingMinutes Int @default(60)`, `catalogMenuId String?`, `version Int @default(1)`, timestamps). `catalogMenuId` is a plain id with a relation to `Menu` (`onDelete: SetNull`).
  - `PosStaff` (`id`, `restaurantId`, `userId`, `role PosRole`, `deactivatedAt?`, `kitchenSectionId String?` (a plain id until phase 2 adds the section table), `pinHash?`, `pinSetAt?`, `pinFailedCount Int @default(0)`, `pinLockedUntil?`, `createdAt`; `@@unique([restaurantId, userId])`, `@@index([restaurantId])`, `@@index([userId])`), relations to `Restaurant` and `User` (cascade).

- [ ] **Step 1: Write the failing test** (`tests/pos/schema.test.ts`, real test DB): `PosSettings is unique per restaurant`; `defaults are IQD-era values: rates 0, only CASH enabled, ring 60, every switch off`; `PosStaff is unique per restaurant and user and cascades with the restaurant and with the user`; `an unknown PosRole is refused by the database`.
- [ ] **Step 2: Run** it. Expected: FAIL (tables missing).
- [ ] **Step 3: Edit the schema, create and apply the migration to the private DB.** Add back-relations on `Restaurant` and `User` (run `prisma format`; it adds missing back-relations; use short field names so the format does not realign existing models). Register both models in `RESTAURANT_SCOPED_MODELS`.
- [ ] **Step 4: Run** `tests/pos/schema.test.ts tests/data/tenant-registry.test.ts`. Expected: PASS.
- [ ] **Step 5: Commit** `feat(pos): settings and staff tables`.

### Task 3: POS actor and gate

**Files:**
- Create: `src/server/pos/actor.ts`, `src/server/pos/gate.ts`
- Test: `tests/pos/actor.test.ts`

**Interfaces:**
- Consumes: `loadActor`/`getActor` (`src/server/studio/auth/actor.ts`), `isLive` (`src/server/domain/billing/subscriptions.ts`), `PosRole`.
- Produces:
  - `type PosActor = { userId: string; name: string; restaurantId: string; role: PosRole; viaMembership: boolean; locale: Locale }`.
  - `resolvePosActor(prisma, userId, restaurantId?): Promise<PosActor | null>`: the active `PosStaff` row for that restaurant (or for the user's first restaurant by `createdAt` when no id is given); a Studio `Membership` of role OWNER with no staff row counts as POS role OWNER (`viaMembership: true`); a deactivated staff row, a deactivated user and a Studio DESIGNER-only membership resolve to `null`. Super Admins do not resolve (they use the Studio).
  - `posGate(prisma, restaurantId, now?): Promise<{ open: true } | { open: false; reason: 'restaurantInactive' | 'cashierPlanInactive' }>`: restaurant `ACTIVE` and a live `cashier` Subscription (`isLive(status)`; a restaurant with no `cashier` Subscription row is closed: unlike the menu, the cashier has no legacy rows).
  - `getPosActor()`: cached per request like `getActor`, reads the `pos-restaurant` cookie only to choose among several restaurants and re-checks it against the user's rows.

- [ ] **Step 1: Write the failing tests:** `an OWNER member with no staff row resolves as OWNER`; `a staff row resolves with its role`; `DESIGNER-only membership resolves to null`; `deactivated staff and deactivated user resolve to null`; `a user of two restaurants resolves the one named, and refuses a restaurant they do not belong to`; `gate: ACTIVE restaurant with a TRIAL/ACTIVE/GRACE cashier subscription is open, EXPIRED/CANCELLED/none is closed with cashierPlanInactive, SUSPENDED restaurant is closed with restaurantInactive`; **golden:** `effectivePermissions for DESIGNER, OWNER and Super Admin equals the values recorded before this plan` (snapshot of `ROLE_DEFAULTS`-derived sets).
- [ ] **Step 2: Run.** Expected: FAIL.
- [ ] **Step 3: Implement** both files; the lookup uses the base client with explicit `where: { restaurantId }` (the actor is resolved before a scoped client exists).
- [ ] **Step 4: Run.** Expected: PASS.
- [ ] **Step 5: Commit** `feat(pos): the POS actor and the subscription gate`.

### Task 4: `/pos` route group, host routing and sign-in handoff

**Files:**
- Modify: `src/server/http/hosts.ts` (`/pos` served on the Studio host, 404 on the public host: add it to `STUDIO_ONLY` and `STUDIO_SERVES`), `tests/http/hosts.test.ts`, `src/studio/nav.ts` (no change for menu-only users; a "Cashier" item shows only for a user with a POS actor, next to the existing items), the Studio sign-in redirect allow-list so `?next=/pos...` is accepted
- Create: `src/app/pos/layout.tsx` (shell: restaurant name, role, language switch en/ar/ckb with `dir`), `src/app/pos/page.tsx` (landing: for role `KITCHEN` redirect to `/pos/kitchen` placeholder; others show the restaurant, role, and links to `/pos/settings`, `/pos/staff`, `/pos/catalog`; an inactive gate shows the reason page), `src/app/pos/inactive/page.tsx`, messages `pos.*` in the existing en/ar/ckb message files
- Test: `tests/http/hosts.test.ts` (new cases), `tests/pos/pages.test.ts`

**Interfaces:**
- Consumes: `getPosActor`, `posGate`, `posLanding`.
- Produces: `POS_SIGN_IN = '/studio/sign-in?next=/pos'` (one sign-in for the whole app; no second login page).

- [ ] **Step 1: Write the failing tests:** hosts: `the public host answers 404 for /pos and /pos/x; the Studio host serves them; an unconfigured development host serves them`; pages: `no session redirects to the sign-in with next=/pos`; `a user with no POS actor gets a 404-style page, not a redirect loop`; `a closed gate renders the inactive page in the user's locale`; `a menu-only restaurant's owner sees no Cashier item in the Studio nav`.
- [ ] **Step 2: Run.** Expected: FAIL.
- [ ] **Step 3: Implement.** Layout and pages are server components; every string through the message system.
- [ ] **Step 4: Run** hosts, pages, `tests/studio/messages.test.ts`, `tests/studio/enforcement.test.ts`. Expected: PASS.
- [ ] **Step 5: Commit** `feat(pos): the /pos area, its host rule and the shared sign-in`.

### Task 5: Staff and settings services and pages

**Files:**
- Create: `src/server/pos/settings.ts`, `src/server/pos/staff.ts`, `src/server/studio/actions/pos.ts` (the `defineAction` wrappers), pages `src/app/pos/settings/page.tsx`, `src/app/pos/staff/page.tsx`
- Modify: the Studio action framework's access rule so an action can name a POS permission (see Interfaces); `src/server/domain/audit-actions.ts` (add `pos.settings.update`, `pos.staff.create`, `pos.staff.role`, `pos.staff.deactivate`, `pos.staff.reactivate`)
- Test: `tests/pos/settings.test.ts`, `tests/pos/staff.test.ts`, `tests/pos/enforcement.test.ts`

**Interfaces:**
- Consumes: `PosActor`, `canPos`, the framework's `ActionContext` (`ctx.transaction`, `ctx.audit`).
- Produces:
  - Framework: `defineAction({ pos: 'settings.manage' | 'staff.manage' | ..., ... })` as an alternative to a Studio `permission`; `access.ts` resolves a `PosActor` and checks `canPos`; the restaurant is the actor's, never taken from the input.
  - `getPosSettings(ctx): Promise<PosSettingsView>`; `updatePosSettings(ctx, input: { serviceRatePercent: number; taxRatePercent: number; enabledPaymentMethods: PosPaymentMethod[]; tableRingMinutes: number; ... switches; version: number })` (0..100 whole percents; CASH always stays enabled; `version` for optimistic concurrency).
  - `listPosStaff(ctx)`, `createPosStaff(ctx, { name, email, role, password })` (creates the `user` + credential account through Better Auth the way the Studio's account creation does, or attaches an existing user by email; role limits as the cashier repo: only OWNER may create OWNER/MANAGER), `changePosStaffRole(ctx, staffId, role)`, `setPosStaffActive(ctx, staffId, active)`. Errors reuse the cashier's meanings: `LastOwner`, `CannotChangeSelf`, `EmailTaken` (when it belongs to a user already staff here), `WeakPassword`.

- [ ] **Step 1: Write the failing tests:** settings: `rates outside 0..100 or non-integer are refused`; `CASH cannot be switched off`; `a stale version is refused`; `a CASHIER cannot update (403)`; `an update writes one audit row in the same transaction`; staff: `create then list`; `a MANAGER cannot create an OWNER`; `the last active OWNER cannot be demoted or deactivated`; `nobody changes their own role or active flag`; `a user already in another restaurant keeps both memberships`; `two restaurants never see each other's staff (cross-tenant)`; enforcement: `every POS action is defined through defineAction with a pos or Studio permission (a repository scan like tests/studio/enforcement.test.ts)`.
- [ ] **Step 2: Run.** Expected: FAIL.
- [ ] **Step 3: Implement** services over the scoped client for the actor's restaurant; port the cashier's `staff.ts` rules, rewritten against `PosStaff`.
- [ ] **Step 4: Run** the three test files plus `tests/studio/framework.test.ts` and `tests/studio/enforcement.test.ts`. Expected: PASS.
- [ ] **Step 5: Commit** `feat(pos): settings and staff, behind the action framework`.

---

# Phase 2: one catalog

### Task 6: The restaurant's catalog menu

**Files:**
- Create: `src/server/pos/catalog-menu.ts`
- Modify: `src/server/studio/actions/pos.ts`, `src/app/pos/settings/page.tsx` (a "Product list" section)
- Test: `tests/pos/catalog-menu.test.ts`

**Interfaces:**
- Consumes: the Studio's menu-creation service (`src/server/studio/services/menus.ts`, `newMenuInput`).
- Produces: `ensureCatalogMenu(ctx): Promise<{ menuId: string; created: boolean }>`; `chooseCatalogMenu(ctx, menuId): Promise<{ menuId: string }>`; `catalogMenuOf(prisma, restaurantId): Promise<{ id: string; currency: string } | null>`.
  Rules: with `catalogMenuId` set and the menu existing, return it. With none set and exactly one menu, choose it; with several menus the owner must choose (`ensureCatalogMenu` throws `CatalogMenuChoiceRequired`); with no menu, create one: name from the restaurant, status `DRAFT`, `currency 'IQD'`, locales `['ar','ckb','en']`, default locale `ar`, timezone `Asia/Baghdad`, numerals `ARAB`; its slug is generated like every menu's and, never being published, resolves to nothing publicly. A chosen menu whose currency is not `IQD` is refused (`CatalogMenuCurrency`). Both actions need `catalog.manage`.

- [ ] **Step 1: Write the failing tests:** `none: creates a DRAFT IQD menu once and is idempotent`; `one existing menu is adopted without creating another`; `two menus require a choice`; `a USD menu is refused`; `a created catalog menu has no live revision and its slug 404s on the public route`; `a menu of another restaurant cannot be chosen`; `writes audit rows`.
- [ ] **Step 2: Run.** Expected: FAIL.
- [ ] **Step 3: Implement.** `ensureCatalogMenu` is called lazily by the setup page and by phase 3's till, never from a public path.
- [ ] **Step 4: Run.** Expected: PASS.
- [ ] **Step 5: Commit** `feat(pos): each restaurant's catalog is one menu`.

### Task 7: Cashier-only side tables and the till catalog (read)

**Files:**
- Modify: `prisma/schema.prisma`, `src/server/data/tenant-db.ts` (register the new models), migration `<timestamp>_pos_catalog`
- Create: `src/server/pos/till-catalog.ts`
- Test: `tests/pos/till-catalog.test.ts`

**Interfaces:**
- Produces models: `PosKitchenSection` (`id`, `restaurantId`, `name String`, `sortOrder Int`, `@@index([restaurantId])`); `PosCategorySetting` (`categoryId @unique` → `Category` cascade, `restaurantId`, `sectionId String?`); `PosProductSetting` (`productId @unique` → `Product` cascade, `restaurantId`, `sectionId String?`, `soldOutOverride Boolean @default(false)`). All three are restaurant-scoped; `PosStaff.kitchenSectionId` becomes a relation to `PosKitchenSection` (`SetNull`) in this migration.
- Produces: `loadTillCatalog(prisma, restaurantId): Promise<TillCatalog>` where `TillCatalog = { menuId; currency: 'IQD'; locales: Locale[]; defaultLocale: Locale; categories: { id; sortOrder; names: Names; sectionId: string | null }[]; products: { id; categoryId; sortOrder; names: Names; price: number; available: boolean; sectionId: string | null; variants: { id; names; priceDelta; isDefault }[]; groups: { id; names; minSelect; maxSelect; options: { id; names; priceDelta; available: boolean }[] }[] }[] }`. It reads the **draft rows** of the catalog menu through the menu-scoped client; `available = product.isAvailable && !soldOutOverride`; archived (`isHidden`) products are included with `hiddenFromGuests: true` (the till sells what guests are not shown); no cost fields, no stock counters.

- [ ] **Step 1: Write the failing tests:** `categories and products come from the menu's draft rows in sort order`; `a price edited in the draft shows at once without a publish`; `variants, groups and options map with ids and deltas`; `soldOutOverride or isAvailable=false make a product unavailable`; `another restaurant's menu never appears`; `120-character Arabic names round-trip`; `a 1,000-product menu loads in under 500 ms on the test DB` (measure with a generous bound, run once); `an empty menu returns empty arrays`; `no key named cost, costDelta, stockCount appears in the JSON`.
- [ ] **Step 2: Run.** Expected: FAIL.
- [ ] **Step 3: Implement** with one query per table (no per-product queries).
- [ ] **Step 4: Run** the test and `tests/data/tenant-registry.test.ts`. Expected: PASS.
- [ ] **Step 5: Commit** `feat(pos): the till reads the menu's own products`.

### Task 8: Catalog setup in `/pos/catalog` (write, through the Studio services)

**Files:**
- Create: `src/server/pos/catalog-edit.ts`, `src/app/pos/catalog/page.tsx` and its client components, kitchen-section service `src/server/pos/kitchen-sections.ts`
- Modify: `src/server/studio/actions/pos.ts` (actions), the framework access rule from Task 5 (a POS actor with `catalog.manage` may run the Studio's content services for **its own catalog menu only**)
- Test: `tests/pos/catalog-edit.test.ts`, `tests/pos/kitchen-sections.test.ts`

**Interfaces:**
- Consumes: `createCategory`, `updateCategory`, `deleteCategory`, `createProduct`, `saveProduct`, `deleteProduct` (`src/server/studio/services/content.ts`, which already audit, version and scope by menu); `setProductAvailability` (`availability.ts`); `ensureCatalogMenu`.
- Produces: POS actions `posCreateCategory`, `posSaveProduct`, `posDeleteProduct`, `posSetAvailability` (each runs the matching Studio service with `ctx.menuId` = the catalog menu, after checking `catalog.manage`), `setCategorySection`/`setProductSection` (writes the side tables), `createKitchenSection`, `renameKitchenSection`, `deleteKitchenSection` (a section in use by a category or product is cleared, not blocked, as in the cashier).

- [ ] **Step 1: Write the failing tests:** `a MANAGER creates a category and a product with options in the catalog menu and the till catalog shows them`; `a CASHIER (no catalog.manage) is refused`; `a POS actor cannot touch a product of another menu or restaurant (cross-tenant)`; `a stale product version is refused with the Studio's conflict error`; `deleting a product keeps nothing dangling: its setting row cascades`; `edits write the Studio's audit actions plus the POS actor's id`; `toggling availability is live for guests without a publish when the menu is published (expireLive called)`; `a section deleted in use clears the assignments`; **isolation:** `a menu-only restaurant's Studio actions and permission sets are unchanged` (re-run of the Task 3 golden test).
- [ ] **Step 2: Run.** Expected: FAIL.
- [ ] **Step 3: Implement.** The page is a thin client over the actions: category list, product form (names in the menu's locales, price in IQD with the project's money input, availability switch, section select, variants and option groups), kitchen sections list; money formatting through `src/server/domain/money.ts` and the money input.
- [ ] **Step 4: Run** the new tests plus `tests/studio/content.test.ts`, `tests/studio/enforcement.test.ts`, `tests/studio/cross-tenant.test.ts`. Expected: PASS.
- [ ] **Step 5: Commit** `feat(pos): set up the product list, using the menu's own editing services`.

### Task 9: Import the cashier's old product list (CSV) onto the menu tables

**Files:**
- Create: `src/server/pos/menu-csv.ts` (port of the cashier's `lib/menu-csv.ts`: header rules, 2,000-row cap, Arabic/Sorani/English detection), reuse `src/server/sheets/read.ts` where it already reads CSV
- Modify: `src/app/pos/catalog/page.tsx` (an Import button), `src/server/studio/actions/pos.ts`
- Test: `tests/pos/menu-csv.test.ts`, `tests/pos/import.test.ts`

**Interfaces:**
- Consumes: the Studio's import service (`src/server/studio/services/imports.ts`, `import-sheet.ts` preview and apply) so the preview, `draftHash` guard and audit are the existing ones.
- Produces: `parsePosCsv(text: string): { rows: ImportRow[]; errors: ImportError[] }`; `previewPosImport(ctx, file)`, `applyPosImport(ctx, jobId)` that call the Studio importer against the catalog menu with `hideMissing: false`.

- [ ] **Step 1: Write the failing tests:** the cashier's CSV fixtures (copy from `buzzify-restaurant/tests/unit`) parse to the same rows; `2,001 rows are refused and nothing is written`; `a duplicate category in the file is reused`; `a price with Arabic digits parses to the right integer`; `apply twice is refused (the job is APPLIED)`; `applying to a draft that changed since the preview is refused`; `a CASHIER cannot import`.
- [ ] **Step 2: Run.** Expected: FAIL.
- [ ] **Step 3: Implement** by adapting rows to the Studio importer's `ImportPreview` shape; no new importer.
- [ ] **Step 4: Run** the new tests and `tests/studio/imports.test.ts`. Expected: PASS.
- [ ] **Step 5: Commit** `feat(pos): import a product list from CSV onto the menu's tables`.

### Task 10: Verification of the two phases

- [ ] **Step 1:** `npx tsc --noEmit`, `npm run lint` (on `src` and `tests`), `BUZZIFY_DB_PORT=<port> npm test`. Expected: all green; fix before continuing.
- [ ] **Step 2:** a menu-only regression check: load the seeded `atelier` public pages, quote route and Studio overview with the new code and assert no `Pos*` query runs (query log count test in `tests/pos/isolation.test.ts`).
- [ ] **Step 3:** browser check on the private dev server (own port, own DB): sign in as a POS MANAGER, open `/pos`, `/pos/settings`, `/pos/staff`, `/pos/catalog`; create a category and a product; switch the language to ar and ckb and confirm RTL; confirm a CASHIER cannot open settings; confirm a closed subscription shows the inactive page. Screenshots saved in the notes folder.
- [ ] **Step 4:** `graphify update .`; commit any doc touch-ups; report hashes.

## Not in these phases

Tables, orders, payments, shifts, kitchen screen, printing (phase 3); QR orders (phase 4); takeaway, delivery, offline, roles beyond the four, inventory, complaints (phase 5); the cut-over and production (phases 6 and 7). The unfinished link code on `feat/cashier-link` is not merged.
