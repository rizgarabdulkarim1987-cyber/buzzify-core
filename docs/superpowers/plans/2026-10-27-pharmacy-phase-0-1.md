# Buzzify Pharmacy, phases 0 and 1: the safe foundation and the product catalog. Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A Super Admin creates a pharmacy (business with branches, owner, plan, limits); its staff sign in at `/pharmacy`, pick a business and branch, and manage the product catalog (units, barcodes, prices with history, Excel/CSV import with preview, export), with customer, branch and permission isolation proven by tests, and with Menu and the restaurant cashier untouched.

**Architecture:** Pharmacy is a third product inside this app, built the way the cashier was: `Restaurant` stays the tenant row and gains `sector`; pharmacy tables are `Ph*`, keyed by `restaurantId` and (for operational rows) `branchId`; pure rules in `src/server/domain/pharmacy/*`, services in `src/server/pharmacy/*`, pages in `src/app/pharmacy/*`; every write goes through a new `ph` target of the Studio action framework (permission, subscription gate, branch scope and audit in one transaction). All migrations are additive.

**Tech Stack:** Next.js 16.4.1, React 19.3.1, TypeScript 5.9 strict, Prisma 7.10 on PostgreSQL, Better Auth, Zod 4, Vitest 5, Playwright 1.64, exceljs and papaparse (already installed).

**Spec:** `docs/superpowers/specs/2026-10-27-pharmacy-design.md` (sections 4, 5, 7 of phases 0 and 1 in section 12, and the owner decisions in section 15). Patterns to copy, read-only: `src/server/pos/actor.ts`, `src/server/pos/entry.ts`, `src/server/domain/pos/permissions.ts`, `src/server/studio/framework/{access,action,query}.ts`, `src/server/data/tenant-db.ts`, `tests/data/tenant-registry.test.ts`, `tests/studio/enforcement.test.ts`, `tests/pos/fixture.ts`.

## Preparation (before Task 1, not a task)

- [ ] Work in a git worktree off `origin/main` (`superpowers:using-git-worktrees`), branch `pharmacy-phase-0-1`. Run `npm ci`, give the worktree its own `BUZZIFY_DB_PORT` (never 54329 or 54349), and restore `next-env.d.ts` if missing. `tsx` scripts fall back to the shared database: pass the port explicitly.
- [ ] Baseline: `npm run typecheck`, `npx eslint src tests`, `npm test` all green before any change. Record the test count.

## Global Constraints

- No push, no deploy, no production, no `migrate deploy` outside the private worktree database. Every migration is additive only (new tables, columns with defaults, new rows); nothing existing is dropped, renamed or updated. Task 1's guard test enforces it for every later migration of this plan.
- Money: `BigInt` minor units with a `currency` of `IQD` or `USD` beside it; no Float, no Decimal; no implicit conversion between currencies (owner decision 2). IQD has 0 digits, USD 2 (`minorUnitDigits`).
- Quantities are whole numbers in the product's base unit.
- A menu-only or cashier-only restaurant (`sector = FOOD`) behaves exactly as today: no new query on public pages, no new Studio item, no change to `effectivePermissions` for any existing role, no change to `/pos` (a golden test pins this, Task 8).
- Every new model with a required `restaurantId` is registered in `src/server/data/tenant-db.ts`; every model with a required `branchId` is also in the new branch-scoped list (Task 2); `tests/data/tenant-registry.test.ts` stays green.
- Every pharmacy write is an action on the `ph` target (`tests/studio/enforcement.test.ts` extended in Task 7 stays green). A Super Admin has no pharmacy actor and no pharmacy data access without a live support grant (Task 11).
- No patient, prescription or customer field ever appears in `AuditLog.changes` (Task 5).
- en, ar and ckb for every string, RTL for ar and ckb; the key-parity test covers the new `pharmacy.*` messages. ar and ckb text is machine-drafted until a native speaker reviews it.
- No motion in the pharmacy screens beyond what `prefers-reduced-motion` already allows; states never rely on colour alone (icon plus text).
- Lint `src` and `tests` (`npx eslint src tests`), not `.`. After a script rewrites files, check `git diff --stat` for whole-file CRLF churn before committing.
- Commit with the trailer `Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>`; stage explicit paths only.

## Review Focus

1. **A person who is staff of pharmacy A, Studio DESIGNER of restaurant B and staff of cashier C:** each area shows only its own powers; none leaks into another (Tasks 6, 8, 12).
2. **A support grant that expires between two requests, or was issued for pharmacy A and used on pharmacy B:** refused at once, never "still valid for this request" (Task 11).
3. **An Excel file whose barcode column holds numbers** (leading zeros lost, `1.23457E+12`), Arabic-Indic digits in prices, thousands separators, a UTF-8 BOM CSV, repeated rows, and 5,000 rows: warned or refused with the row number, never silently altered (Tasks 17, 22, 23).
4. **A product name of 120 mixed Arabic and Latin characters, an empty catalog and a 50,000-product catalog:** the list, search and editor render, stay readable and meet the search budget (Tasks 21, 24).
5. **A USD price on a business that only enabled IQD, the last OWNER being removed, and a deactivated user with an open session:** refused with a reason, never half applied (Tasks 9, 15, 19, 20).

---

# Phase 0: the safe foundation

### Task 1: Foundation schema and the additive-migration guard

**Files:**
- Modify: `prisma/schema.prisma`
- Create: `prisma/migrations/<timestamp>_pharmacy_foundation/migration.sql` (generated, then reviewed)
- Create: `tests/pharmacy/migration-additive.test.ts`
- Test: `tests/data/tenant-registry.test.ts` (existing, must stay green)

**Interfaces:**
- Produces (Prisma): enum `BusinessSector { FOOD PHARMACY }`; `Restaurant.sector BusinessSector @default(FOOD)`; `@@unique([restaurantId, id])` on `Branch`; enum `PhRole { OWNER BRANCH_MANAGER PHARMACIST_IN_CHARGE PHARMACIST CASHIER STOCK ACCOUNTANT }`; models `PhSettings` (`restaurantId @unique`, `enabledCurrencies Currency[] @default([IQD])`, `defaultCurrency Currency @default(IQD)`, `rxRetentionDays Int?`, `version`), `PhStaff` (`restaurantId`, `userId`, `role PhRole`, `deactivatedAt?`, `@@unique([restaurantId, userId])`), `PhStaffBranch` (`restaurantId`, `staffId`, `branchId`, composite FK to `Branch(restaurantId, id)`), `AppPlan` (`applicationId`, `code`, `name Json`, `features Json`, `limits Json`, `active`, `sortOrder`, `version`, `@@unique([applicationId, code])`), `SupportAccessGrant` (`restaurantId`, `granteeUserId`, `scopes String[]`, `reason`, `approvedByUserId?`, `consentRef?`, `startsAt`, `expiresAt`, `revokedAt?`, `createdAt`). Inserted row: `Application(id 'pharmacy', status DISABLED, sortOrder 3)`.
- Consumes: nothing.

- [ ] **Step 1: Write the failing guard test** `tests/pharmacy/migration-additive.test.ts`: it reads every migration folder created after `20261026300000_complaint_suggestion` and asserts no statement matches `DROP`, `DELETE FROM`, `TRUNCATE`, `RENAME`, `ALTER ... DROP`, or `UPDATE` of a pre-existing table. Test names: `a pharmacy migration never drops or renames`, `a pharmacy migration only inserts the pharmacy application row`.
- [ ] **Step 2: Run** `npx vitest run tests/pharmacy/migration-additive.test.ts`. Expected: PASS vacuously (no new migration yet), proving the guard runs; then add a deliberate bad sample string in the test's own inline fixture and confirm the matcher flags it (the matcher is itself tested on samples, as `enforcement.test.ts` does).
- [ ] **Step 3: Edit the schema** as in Interfaces; `PhStaff` and `PhStaffBranch` carry required `restaurantId`. Run `npm run db:migrate -- --name pharmacy_foundation` against the private database, open the generated SQL and add the `Application` insert by hand.
- [ ] **Step 4: Register the new models** in `tenant-db.ts`: `PhSettings`, `PhStaff`, `PhStaffBranch`, `SupportAccessGrant` in `RESTAURANT_SCOPED_MODELS`; `AppPlan` in `GLOBAL_MODELS`. Update `tenant-registry.test.ts` expectations only if its structure requires listing; the test must otherwise pass unchanged.
- [ ] **Step 5: Run** `npx vitest run tests/pharmacy tests/data` then `npm run typecheck`. Expected: PASS, PASS.
- [ ] **Step 6: Commit** `feat(pharmacy): sector, staff, plans and support-grant tables (additive)`.

### Task 2: Branch scope in the tenant client

**Files:**
- Modify: `src/server/data/tenant-db.ts` (extend `Scope`, `tenantScope`, `scopedClient`; add `PHARMACY_BRANCH_SCOPED_MODELS`)
- Modify: `tests/data/tenant-registry.test.ts`
- Test: `tests/data/tenant-branch-scope.test.ts` (create)

**Interfaces:**
- Produces: `Scope.branchIds?: readonly string[]`; `export const PHARMACY_BRANCH_SCOPED_MODELS: readonly string[]` (empty now, filled by Tasks 14 and later phases); a client scoped with `branchIds` adds `branchId IN (...)` to every query and write of a listed model, refuses a write whose `branchId` is outside the list, and refuses a listed model when `branchIds` is absent on a restaurant client unless the scope is `allBranches: true` (`Scope.allBranches?: true`, the OWNER).
- Consumes: Task 1 models.

- [ ] **Step 1: Write failing tests** in `tenant-branch-scope.test.ts`, against the private database with a throwaway model list injected through an exported `withBranchScopedModels(list)` test seam: `reads only the rows of the branches in scope`, `refuses to create a row for a branch outside the scope`, `an allBranches client reads every branch of its restaurant`, `a client with neither branchIds nor allBranches refuses a branch-scoped model`, `a branch of another restaurant is never reachable even if listed`.
- [ ] **Step 2: Run** `npx vitest run tests/data/tenant-branch-scope.test.ts`. Expected: FAIL (no `branchIds`).
- [ ] **Step 3: Implement** the scope extension following how `restaurantId` filtering is already written in `tenantScope`; one helper `confineBranch(args, scope)` used by read, count, aggregate, update, delete and create paths.
- [ ] **Step 4: Add to `tenant-registry.test.ts`** the rule: every model body with a required `branchId String` is listed in `PHARMACY_BRANCH_SCOPED_MODELS`, and every listed name is a real model. Run `npx vitest run tests/data`. Expected: PASS.
- [ ] **Step 5: Commit** `feat(tenancy): branch scope for pharmacy models`.

### Task 3: Pharmacy roles and permissions (pure)

**Files:**
- Create: `src/server/domain/pharmacy/permissions.ts`
- Test: `tests/pharmacy/permissions.test.ts`

**Interfaces:**
- Produces: `PH_ROLES` (the seven `PhRole` values), `PH_PERMISSIONS` = `catalog.view`, `catalog.manage`, `price.change`, `cost.view`, `profit.view`, `discount.apply`, `discount.over_limit`, `rx.dispense`, `rx.attachment.view`, `batch.override`, `return.approve`, `stock.adjust`, `stock.count`, `transfer.manage`, `purchase.manage`, `shift.use`, `report.view`, `ai.use`, `import.apply`, `staff.manage`, `settings.manage`, `support.grant`; `canPh(role: PhRole, permission: PhPermission): boolean`; `phPermissionsOf(role): ReadonlySet<PhPermission>`; `roleMatrix()`.
- Matrix (my call, owner may change): OWNER all; BRANCH_MANAGER all except `support.grant` and `settings.manage`; PHARMACIST_IN_CHARGE `catalog.view catalog.manage price.change cost.view discount.apply discount.over_limit rx.dispense rx.attachment.view batch.override return.approve stock.adjust stock.count shift.use report.view ai.use import.apply`; PHARMACIST `catalog.view discount.apply rx.dispense rx.attachment.view shift.use ai.use`; CASHIER `catalog.view discount.apply shift.use`; STOCK `catalog.view catalog.manage cost.view stock.count transfer.manage purchase.manage import.apply`; ACCOUNTANT `catalog.view cost.view profit.view report.view purchase.manage`.

- [ ] **Step 1: Write failing tests**: `owner holds every permission`, `only the owner holds support.grant`, `a cashier cannot see cost or profit`, `an accountant cannot dispense or change stock`, `the matrix has a row for every role and every permission key exists in at least one role`, `a permission string not in the list is refused by canPh`.
- [ ] **Step 2: Run** `npx vitest run tests/pharmacy/permissions.test.ts`. Expected: FAIL (module missing).
- [ ] **Step 3: Implement** as pure data and functions, mirroring `domain/pos/permissions.ts`.
- [ ] **Step 4: Run** the test. Expected: PASS.
- [ ] **Step 5: Commit** `feat(pharmacy): roles and permission matrix`.

### Task 4: Support-grant rules (pure)

**Files:**
- Create: `src/server/domain/pharmacy/support-grant.ts`
- Test: `tests/pharmacy/support-grant.test.ts`

**Interfaces:**
- Produces: `SUPPORT_SCOPES` = `catalog.read`, `stock.read`, `sales.read`, `rx.read`, `patients.read`; `SENSITIVE_SUPPORT_SCOPES` = `rx.read`, `patients.read`; `MAX_GRANT_HOURS = 72`; `validateGrantRequest(input: { scopes: string[]; reason: string; startsAt: Date; expiresAt: Date; now: Date; sensitiveConfirmed: boolean }): { ok: true } | { ok: false; code: 'NO_SCOPE' | 'UNKNOWN_SCOPE' | 'REASON_REQUIRED' | 'TOO_LONG' | 'PAST' | 'SENSITIVE_NOT_CONFIRMED' }`; `grantStatus(grant: { startsAt: Date; expiresAt: Date; revokedAt: Date | null }, now: Date): 'pending' | 'active' | 'expired' | 'revoked'`; `grantAllows(grant, scope, now): boolean`.

- [ ] **Step 1: Write failing tests**: `72 hours is the longest grant and 72h plus one minute is refused`, `a reason shorter than 10 characters is refused`, `an unknown scope is refused`, `a sensitive scope needs sensitiveConfirmed`, `a grant is expired exactly at expiresAt (the boundary instant is expired)`, `a revoked grant is never active even inside its window`, `grantAllows is false for a scope the grant does not list`, `a grant that starts in the future is pending`.
- [ ] **Step 2: Run** and expect FAIL. **Step 3: Implement** the signatures above. **Step 4: Run**, expect PASS.
- [ ] **Step 5: Commit** `feat(pharmacy): support grant rules`.

### Task 5: Audit redaction rule for pharmacy actions (pure)

**Files:**
- Create: `src/server/domain/pharmacy/audit-fields.ts`
- Modify: `src/server/studio/framework/action.ts` (apply to entries of `ph` actions, wired in Task 7)
- Test: `tests/pharmacy/audit-fields.test.ts`

**Interfaces:**
- Produces: `FORBIDDEN_AUDIT_FIELDS: readonly RegExp[]` (patient, customer, prescription, doctor, nationalId, phone, address, dob, attachment); `assertAuditSafe(entityType: string, changes: Record<string, { before: unknown; after: unknown }> | undefined): void` throws `PharmacyAuditError` naming the field; `redactForAudit(changes)` is not provided (refuse, never silently drop).

- [ ] **Step 1: Write failing tests**: `a change on patientName is refused`, `a change on prescriptionNo is refused`, `catalog fields (tradeName, strength, barcode, amount) pass`, `the error names the field and never the value`, `nested keys are checked case-insensitively`.
- [ ] **Step 2: Run**, expect FAIL. **Step 3: Implement.** **Step 4: Run**, expect PASS.
- [ ] **Step 5: Commit** `feat(pharmacy): refuse patient fields in audit changes`.

### Task 6: Pharmacy actor and gate

**Files:**
- Create: `src/server/pharmacy/actor.ts`, `tests/pharmacy/fixture.ts`
- Test: `tests/pharmacy/actor.test.ts`

**Interfaces:**
- Consumes: Task 3 `PhRole`, Task 4 `grantStatus`, `effectiveStatus`/`graceEndsAt` from `src/server/domain/billing/subscriptions.ts`.
- Produces: `PhActor { userId; name; restaurantId; restaurantName; role: PhRole | null; allBranches: boolean; branchIds: string[]; viaMembership: boolean; support: { grantId: string; scopes: ReadonlySet<string>; expiresAt: Date } | null; locale: Locale }`; `PhGate = { state: 'open' } | { state: 'readOnly'; until: Date } | { state: 'closed'; reason: 'restaurantInactive' | 'notPharmacy' | 'planInactive' | 'archived' }`; `resolvePhActor(prisma: PrismaClient, userId: string, opts?: { restaurantId?: string; branchId?: string; now?: Date }): Promise<PhActor | null>`; `phGate(prisma, restaurantId: string, now?: Date): Promise<PhGate>`; `PH_RETENTION_DAYS_DEFAULT = 90` read from `PlatformSetting('pharmacyRetentionDays')` when present.
- Rules: Studio OWNER member of a PHARMACY restaurant is Ph OWNER with `allBranches`; others need an active `PhStaff` row and their `PhStaffBranch` rows (a non-owner with no branch row has no actor); a Super Admin has an actor only through an active support grant for that restaurant, with `role: null` and `support` set; a deactivated user or one whose `PhStaff.deactivatedAt` is set has none; `phGate`: restaurant not ACTIVE gives `restaurantInactive`; `sector != PHARMACY` gives `notPharmacy`; no `pharmacy` subscription gives `planInactive`; live (TRIAL/ACTIVE/GRACE by `effectiveStatus`) gives `open`; EXPIRED within `PH_RETENTION_DAYS` of `graceEndsAt` (CANCELLED: of `cancelledAt ?? currentPeriodEnd`) gives `readOnly`; later gives `archived`.
- `tests/pharmacy/fixture.ts` mirrors `tests/pos/fixture.ts`: `useTestDatabase`, `resetWorld` (creates applications `menu`, `cashier`, `pharmacy`), `pharmacy(name, opts)` (business with `sector PHARMACY`, one branch, a `pharmacy` subscription), `person`, `asPh(userId, restaurantId)`.

- [ ] **Step 1: Write failing tests**: `an owner member is the pharmacy owner of all branches`, `a staff member sees only the branches they were given`, `a staff member of pharmacy A has no actor in pharmacy B`, `a Studio DESIGNER alone has no pharmacy actor`, `a cashier-only staff row of a FOOD restaurant gives no pharmacy actor`, `a super admin has no actor without a grant`, `a super admin with an active grant has an actor with role null and the grant's scopes`, `an expired or revoked grant gives no actor`, `a grant for pharmacy A gives no actor in pharmacy B`, `a deactivated user has none`, and the gate table: `trial, active and grace are open`, `expired the day after grace is readOnly`, `expired 91 days after grace is archived`, `cancelled counts from cancelledAt`, `suspended restaurant is closed`, `a FOOD restaurant is closed notPharmacy`, `a retention setting of 30 days changes the archive boundary`.
- [ ] **Step 2: Run** `npx vitest run tests/pharmacy/actor.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement** `resolvePhActor` and `phGate` copying the structure of `resolvePosActor`/`posGate`; take `now` as a parameter everywhere (no hidden clock).
- [ ] **Step 4: Run** the test. Expected: PASS.
- [ ] **Step 5: Commit** `feat(pharmacy): actor, gate and subscription states`.

### Task 7: The `ph` target in the action and query framework

**Files:**
- Modify: `src/server/studio/framework/access.ts`, `action.ts`, `query.ts`
- Modify: `tests/studio/enforcement.test.ts`
- Test: `tests/pharmacy/framework.test.ts`

**Interfaces:**
- Consumes: Task 2 scope, Task 3 `canPh`, Task 5 `assertAuditSafe`, Task 6 `resolvePhActor`/`phGate`.
- Produces: `Target` gains `{ kind: 'ph'; branchId?: string }` (`PhTarget`); `defineAction`/`defineQuery` accept `{ permission: null; ph: PhPermission; target(input): PhTarget }` and optional `allowReadOnly?: true`; `ActionContext.ph` and `QueryContext.ph: PhActor | null`; `ctx.transaction` for a `ph` action runs on `scopedClient(prisma, { restaurantId, branchIds | allBranches })`; `resolvePhAccess(prisma, actor, required, target, allowReadOnly)` returns the same `Access` shape (no Studio permissions, `ph` set). `branchId` from the input must be inside the actor's branches or the call fails `FORBIDDEN`; a support actor passes only if its scopes cover the permission's mapped read scope (`catalog.view` to `catalog.read`; anything that writes is refused for a support actor). A lapsed gate: `readOnly` allows only definitions with `allowReadOnly` (queries default to allowed, actions default to refused); `closed` refuses all with `FORBIDDEN`; no actor and a closed gate answer alike.
- Enforcement rules added to `enforcement.test.ts`: every file under `src/server/pharmacy` and `src/app/pharmacy` that touches a `Ph*` model does so only through a `ctx`/`tx` (no `getPrisma()` import in `src/app/pharmacy`); no file under `src/server/studio/**` (the Studio's own areas) references a `Ph*` delegate (so a Super Admin's restaurant-target action cannot read pharmacy data); a `ph` action's audit entries pass `assertAuditSafe`.

- [ ] **Step 1: Write failing tests** in `framework.test.ts`: `a ph action runs for an owner and writes its audit row in the same transaction`, `a cashier is refused a catalog.manage action`, `a branch outside the actor's branches is refused FORBIDDEN`, `a readOnly pharmacy refuses actions and allows queries and allowReadOnly actions`, `an archived pharmacy refuses everything`, `a super admin without a grant gets the same refusal as a stranger`, `a support actor can run a catalog.view query and cannot run any action`, `an audit entry with patientName fails the action`, `no restaurant-target Studio action can read a Ph model` (static).
- [ ] **Step 2: Run**, expect FAIL.
- [ ] **Step 3: Implement** the target, the access resolver and the context wiring; reuse `admit`'s order (actor, two-factor for super admin, input, access). Extend `checkDefinition` so a `ph` permission requires a `ph` target and the reverse.
- [ ] **Step 4: Run** `npx vitest run tests/pharmacy tests/studio/enforcement.test.ts tests/studio/framework.test.ts`. Expected: PASS.
- [ ] **Step 5: Commit** `feat(pharmacy): ph target in the action framework`.

### Task 8: Sector separation and the golden regression

**Files:**
- Modify: `src/server/pos/actor.ts` (`posGate`/`resolvePosActor` ignore `sector PHARMACY`), the Studio menu and cashier-overview queries that list restaurants (filter by sector where they must not show pharmacies), `src/studio/nav.ts` only if a Pharmacy item is needed later (not in this task)
- Test: `tests/pharmacy/sector-separation.test.ts`, `tests/pharmacy/golden-food.test.ts`

**Interfaces:**
- Consumes: Task 6 fixture. Produces: a rule that a `PHARMACY` business never resolves a till actor and never appears in menu lists; a golden snapshot of FOOD behaviour.

- [ ] **Step 1: Write failing tests**: `a pharmacy business has no till actor even for an owner`, `a pharmacy business does not appear in the Studio's menus list or the cashier overview`, `golden: effectivePermissions for every existing role and flag combination is unchanged` (snapshot of the full matrix taken from `main` before this plan, stored in the test), `golden: the Studio nav items for a Super Admin, an owner and a designer of a FOOD restaurant are unchanged`, `golden: a FOOD restaurant's public menu loader issues no query on a Ph table` (assert through a Prisma query log).
- [ ] **Step 2: Run**, expect the first two FAIL and the golden ones PASS.
- [ ] **Step 3: Implement** the sector filters at the narrowest points; do not touch public menu code.
- [ ] **Step 4: Run** `npx vitest run tests/pharmacy tests/pos tests/studio`. Expected: PASS, nothing else changes.
- [ ] **Step 5: Commit** `feat(pharmacy): keep pharmacies out of the till and menu lists; golden FOOD tests`.

### Task 9: Super Admin creates a pharmacy

**Files:**
- Modify: `src/server/studio/actions/restaurants.ts`, `src/server/studio/services/restaurants.ts`, `src/server/studio/queries/restaurants.ts`
- Modify: `src/app/studio/(studio)/(app)/restaurants/new/*` and the list page (sector selector, badge, filter)
- Create: `src/server/pharmacy/provision.ts`
- Test: `tests/pharmacy/provision.test.ts`, `tests/e2e/pharmacy-create.spec.ts`

**Interfaces:**
- Consumes: `restaurant.create` permission, the existing owner-invitation service (`src/server/studio/services/invitations.ts`).
- Produces: `createRestaurant` input gains `sector: 'FOOD' | 'PHARMACY'` (default FOOD, unchanged for existing callers) and, for PHARMACY, `branches: { name: string; city?: string }[]` (1 to 20) and `currencies: ('IQD' | 'USD')[]` (default `['IQD']`); `provisionPharmacy(tx, { restaurantId, branches, currencies, ownerEmail?: string }): Promise<{ branchIds: string[] }>` creates the branches, the `PhSettings` row and, when an owner email is given, the owner invitation; the `pharmacy` subscription is started by the existing billing screens, not here.

- [ ] **Step 1: Write failing tests**: `creating a pharmacy makes the business, its branches and settings in one transaction and audits it under the business`, `a pharmacy needs at least one branch`, `an unknown currency is refused`, `a failure inside provisioning leaves no business behind`, `a FOOD restaurant is created exactly as before (same rows, same audit)`, `only a Super Admin can create a pharmacy`, `the owner invitation is created for the email and carries the business id`, `a pharmacy with an email already owning another business is allowed (same person, two businesses)`.
- [ ] **Step 2: Run**, expect FAIL.
- [ ] **Step 3: Implement** the extension; the form shows branches and currencies only when the sector is Pharmacy; the list page shows a sector badge with text (icon plus label) and a sector filter.
- [ ] **Step 4: Run** `npx vitest run tests/pharmacy/provision.test.ts tests/studio/restaurants*.test.ts`. Expected: PASS. Then `npx playwright test tests/e2e/pharmacy-create.spec.ts` (sign in as the seeded Super Admin, create a pharmacy with two branches, see it in the list). Expected: PASS.
- [ ] **Step 5: Commit** `feat(pharmacy): Super Admin creates a pharmacy with branches and an owner invitation`.

### Task 10: Plans, limits and their enforcement

**Files:**
- Create: `src/server/domain/pharmacy/limits.ts`, `src/server/studio/actions/app-plans.ts`, `src/server/studio/queries/app-plans.ts`, `src/app/studio/(studio)/(app)/billing/plans/*`
- Modify: `src/server/studio/services/billing.ts` (pharmacy `planCode` validated against `AppPlan` codes, not `PlanTier`)
- Test: `tests/pharmacy/limits.test.ts`, `tests/pharmacy/app-plans.test.ts`

**Interfaces:**
- Produces: `PharmacyLimits { branches: number; users: number; storageMb: number; aiMonthlyBudgetMinor: number }` with Zod schema `pharmacyLimitsSchema` (non-negative integers; `0` means none left, never unlimited, as `PosAiPackage` does); `checkLimit(kind: 'branches' | 'users', current: number, limits: PharmacyLimits): { ok: true } | { ok: false; code: 'LIMIT_REACHED'; limit: number }`; actions `appPlans.upsert` (platform owner only, version-checked) and `appPlans.deactivate`; `limitsOf(prisma, restaurantId): Promise<PharmacyLimits | null>` reading the live subscription's `AppPlan`; branch and staff creation call `checkLimit` before writing.
- No plan prices are seeded; the platform owner enters them.

- [ ] **Step 1: Write failing tests**: `limits of zero mean none left`, `a negative or fractional limit is refused`, `adding the (limit+1)th branch is refused with LIMIT_REACHED and the limit`, `staff limit counts only active staff`, `a pharmacy with no live subscription has no limits and creates nothing`, `only the platform owner edits plans`, `editing a plan with a stale version is refused naming who changed it`, `a subscription to a pharmacy plan code that does not exist is refused`, `lowering a limit below current use does not delete anything and blocks further creation`.
- [ ] **Step 2: Run**, expect FAIL. **Step 3: Implement.** **Step 4: Run**, expect PASS.
- [ ] **Step 5: Commit** `feat(pharmacy): app plans and enforced limits`.

### Task 11: Support access grants

**Files:**
- Create: `src/server/pharmacy/support.ts`, `src/server/studio/actions/support-access.ts`, `src/app/pharmacy/_ui/SupportBanner.tsx`
- Modify: `src/server/pharmacy/actor.ts` (already resolves grants; add the per-read audit hook)
- Test: `tests/pharmacy/support.test.ts`

**Interfaces:**
- Consumes: Task 4 rules, Task 6 actor, Task 7 framework.
- Produces: actions `support.grant` (target `ph`, permission `support.grant`, held by the owner), `support.revoke` (owner), `support.recordConsent` (platform target, Super Admin, requires `consentRef` of at least 10 characters and the same validation; the grant's `approvedByUserId` stays null and the audit row says "consent recorded by platform"); `listGrants` query for the owner; a support actor's every query writes one `AuditLog` row `support.read` with `grantId`, entity and no data; `SupportBanner` shows "Support mode" with the expiry whenever `actor.support` is set.

- [ ] **Step 1: Write failing tests**: `the owner creates a 2-hour catalog.read grant for a named Super Admin`, `a branch manager cannot create a grant`, `a grant for rx.read without sensitiveConfirmed is refused`, `the grantee gets an actor for that pharmacy only`, `the grant stops working at expiresAt even mid-session (checked on every request, not cached)`, `revoking takes effect on the very next request`, `a grant issued for pharmacy A is refused on pharmacy B`, `every support read writes a support.read audit row naming the grant`, `recordConsent without a consentRef is refused`, `a support actor cannot run any write action`, `the banner renders with the expiry for a support actor and not for staff`.
- [ ] **Step 2: Run**, expect FAIL. **Step 3: Implement.** **Step 4: Run**, expect PASS.
- [ ] **Step 5: Commit** `feat(pharmacy): time-boxed, audited support access`.

### Task 12: The `/pharmacy` shell

**Files:**
- Create: `src/app/pharmacy/layout.tsx`, `src/app/pharmacy/page.tsx`, `src/app/pharmacy/select/page.tsx`, `src/app/pharmacy/(app)/layout.tsx`, `src/app/pharmacy/_ui/{Shell,BranchPicker,StateNotice}.tsx`, `src/server/pharmacy/entry.ts`
- Create: `src/studio/messages/pharmacy/{en,ar,ckb}.ts` (register in `src/studio/messages/index.ts` the way `pos-till` is)
- Test: `tests/pharmacy/entry.test.ts`, `tests/e2e/pharmacy-shell.spec.ts`

**Interfaces:**
- Produces: `phEntry(input: { signedIn: boolean; actor: PhActor | null; gate: PhGate | null }): { kind: 'signIn'; to: string } | { kind: 'notFound' } | { kind: 'closed'; reason } | { kind: 'readOnly'; actor; until } | { kind: 'open'; actor }` (a signed-in person with no pharmacy gets `notFound`, never a redirect loop, as `posEntry` does); `PH_SIGN_IN = '/studio/sign-in?next=/pharmacy'`; the picker lists the person's pharmacies and branches (owner also "All branches"); the selected business and branch live in a signed cookie validated against the actor on every request, never trusted.
- No link to `/pharmacy` appears anywhere in the Studio or on public pages in this plan.

- [ ] **Step 1: Write failing tests** (`entry.test.ts`): `not signed in goes to sign-in with next`, `signed in without a pharmacy is notFound`, `a closed gate shows its reason`, `a readOnly gate opens with a read-only notice`, plus a message parity test: every `pharmacy.*` key exists in en, ar and ckb.
- [ ] **Step 2: Write the e2e** `pharmacy-shell.spec.ts`: owner signs in, lands on the picker, chooses branch 1, sees the home; a second user with only branch 2 cannot open branch 1 by editing the cookie; a user of another pharmacy gets not found; the page is readable in Arabic RTL with no horizontal scroll at 375px and 1280px; keyboard focus order passes `axe`.
- [ ] **Step 3: Run** both, expect FAIL.
- [ ] **Step 4: Implement** the shell with the Studio's stylesheet and fonts (same document approach as `src/app/pos/layout.tsx`), no motion.
- [ ] **Step 5: Run** `npx vitest run tests/pharmacy` and `npx playwright test tests/e2e/pharmacy-shell.spec.ts`. Expected: PASS.
- [ ] **Step 6: Commit** `feat(pharmacy): /pharmacy shell with business and branch picker`.

### Task 13: RLS spike (time-boxed, report only)

**Files:**
- Create: `scripts/spikes/rls-spike.ts` (labelled throwaway, deleted in Task 25 unless the decision is "adopt")
- Create: `docs/superpowers/specs/2026-10-27-pharmacy-rls-spike.md`

**Interfaces:** no production interface. Output is a measured decision.

- [ ] **Step 1: Write the spike** on a scratch table in the private database only: enable RLS with a policy on `current_setting('app.restaurant_id')`, run reads and writes inside `$transaction` with `SET LOCAL`, through the same adapter and pooler settings as production (`DATABASE_URL` pooled, `DIRECT_DATABASE_URL` for DDL).
- [ ] **Step 2: Measure and record** in the report: p95 of 1,000 indexed product searches and 1,000 inserts with and without RLS (budget: overhead at most 10%); that `migrate deploy` still runs; that a query outside a transaction is denied (fails closed) and not returned unfiltered; that a Neon pooled connection never leaks the setting to the next request (run 200 interleaved transactions for two businesses and assert zero cross-reads).
- [ ] **Step 3: Decide** in the report: ADOPT (a follow-up task adds RLS to each `Ph*` table as it is created), or DEFER with the measured reason. Do not add RLS to any real table in this plan.
- [ ] **Step 4: Commit** `docs(pharmacy): RLS spike result`.

---

# Phase 1: the product catalog

### Task 14: Catalog schema

**Files:**
- Modify: `prisma/schema.prisma`, `src/server/data/tenant-db.ts`
- Create: `prisma/migrations/<timestamp>_pharmacy_catalog/migration.sql`
- Test: `tests/pharmacy/catalog-schema.test.ts`

**Interfaces:**
- Produces (all with required `restaurantId`, registered in `RESTAURANT_SCOPED_MODELS`; money `BigInt` with `currency Currency`): `PhCategory(name, nameKey, @@unique([restaurantId, nameKey]))`; `PhProduct(tradeName, genericName, activeIngredient, strength, form, manufacturer, categoryId?, rxLevel{OTC RX RESTRICTED}, requiresCold Boolean, storageNote, shelfLocation, imageAssetId?, identityKey, active, version, @@unique([restaurantId, identityKey]))`; `PhProductUnit(productId, level Int (0 is the base unit), label, baseQty Int, sellable Boolean, @@unique([productId, level]))` with a CHECK `baseQty >= 1` and `level 0` having `baseQty 1` (hand-written in the migration); `PhBarcode(productId, unitId, code TEXT, shared Boolean @default(false), @@unique([restaurantId, code, unitId]))`; `PhProductBranch(branchId, productId, minQty Int, reorderQty Int, @@unique([branchId, productId]))` (branch-scoped, so `branchId` required and listed in `PHARMACY_BRANCH_SCOPED_MODELS`); `PhPrice(productId, unitId, branchId?, currency, amountMinor BigInt, validFrom, validTo?, reason, changedById)` with a CHECK `amountMinor >= 0`; `PhPriceChangeBatch(id, restaurantId, status, previewHash, validFrom, createdById)`; `PhImportBatch(id, restaurantId, status, fileSha256, mapping Json, summary Json, createdById)` and `PhImportRow(batchId, rowNumber, raw Json, parsed Json, issues Json, status)`.

- [ ] **Step 1: Write failing tests** against the private database: `two products with the same identityKey in one business are refused by the database`, `the same identityKey in two businesses is allowed`, `a unit with baseQty 0 is refused`, `a negative price is refused`, `two barcodes with the same code and unit in one business are refused`, `a barcode stored as 0012345678905 keeps its leading zeros on read-back`, `a BigInt price above 2,147,483,647 round-trips exactly`.
- [ ] **Step 2: Run**, expect FAIL. **Step 3: Edit schema, generate migration, add the CHECKs by hand, register models.** **Step 4: Run** `npx vitest run tests/pharmacy tests/data` and `tests/pharmacy/migration-additive.test.ts`. Expected: PASS.
- [ ] **Step 5: Commit** `feat(pharmacy): catalog tables`.

### Task 15: Money for pharmacy (pure)

**Files:**
- Create: `src/server/domain/pharmacy/money.ts`
- Test: `tests/pharmacy/money.test.ts`

**Interfaces:**
- Produces: `type PhMoney = { amount: bigint; currency: 'IQD' | 'USD' }`; `parseMoney(text: string, currency): PhMoney | null` (accepts Latin and Arabic-Indic digits, thousands separators `,` `٬` and space, decimal `.` or `٫` only where the currency has digits; refuses scientific notation and extra decimals); `addMoney(a, b): PhMoney` and `compareMoney(a, b): -1 | 0 | 1` throw `CurrencyMismatchError` on different currencies; `mulQty(m: PhMoney, qty: number): PhMoney` (qty a safe integer); `formatPhMoney(m, locale)` via `formatMoney`; `assertEnabledCurrency(currency, enabled: readonly Currency[])` throws `CurrencyNotEnabledError`.

- [ ] **Step 1: Write failing tests**: `250 IQD parses to 250n and 12.50 USD to 1250n`, `Arabic-Indic digits ١٢٥٠ parse to 1250n`, `1,250 and 1 250 and ١٬٢٥٠ parse equally`, `12.5 IQD is refused (no decimals)`, `1.2E3 is refused`, `adding IQD and USD throws CurrencyMismatchError`, `mulQty of 9_000_000_000n by 1000 does not overflow`, `a USD price on a business that enabled only IQD throws CurrencyNotEnabledError`, `negative amounts are refused by parseMoney`.
- [ ] **Step 2: Run**, expect FAIL. **Step 3: Implement** with BigInt only. **Step 4: Run**, expect PASS.
- [ ] **Step 5: Commit** `feat(pharmacy): bigint money with two currencies`.

### Task 16: Unit ladders (pure)

**Files:**
- Create: `src/server/domain/pharmacy/units.ts`
- Test: `tests/pharmacy/units.test.ts`

**Interfaces:**
- Produces: `type UnitLevel = { level: number; label: string; baseQty: number; sellable: boolean }`; `validateLadder(levels: UnitLevel[]): { ok: true } | { ok: false; code: 'NO_BASE' | 'BASE_NOT_ONE' | 'NOT_ASCENDING' | 'NOT_A_MULTIPLE' | 'NONE_SELLABLE' | 'DUPLICATE_LEVEL' | 'EMPTY_LABEL' }` (each level's `baseQty` is a whole multiple of the level below, level 0 is `baseQty 1`); `toBaseQty(levels, level: number, qty: number): number` (safe integer); `splitQty(levels, baseQty: number): { level: number; label: string; qty: number }[]` (largest level first, remainders below); `sellableLevels(levels)`.

- [ ] **Step 1: Write failing tests**: `box of 10 strips of 10 tablets validates (1, 10, 100)`, `a level that is not a multiple of the one below is refused (1, 10, 25)`, `no sellable level is refused`, `toBaseQty(box, 2) is 200`, `splitQty of 235 tablets with (1, 10, 100) is 2 boxes, 3 strips, 5 tablets`, `splitQty of 0 is empty`, `a quantity beyond Number.MAX_SAFE_INTEGER is refused`, `duplicate level numbers are refused`.
- [ ] **Step 2: Run**, expect FAIL. **Step 3: Implement.** **Step 4: Run**, expect PASS.
- [ ] **Step 5: Commit** `feat(pharmacy): unit ladders`.

### Task 17: Barcode handling (pure)

**Files:**
- Create: `src/server/domain/pharmacy/barcode.ts`
- Test: `tests/pharmacy/barcode.test.ts`

**Interfaces:**
- Produces: `normalizeScan(raw: string): string` (trims whitespace and one trailing Enter/Tab/CR/LF, converts Arabic-Indic digits to Latin, never strips leading zeros, never converts to a number); `checkDigitStatus(code: string): 'valid' | 'invalid' | 'not-applicable'` (EAN-8, EAN-13, UPC-A by length; other lengths are not applicable, internal codes are legal); `looksNumericLossy(raw: string): boolean` (true for `1.23457E+12`, `1.2E+11` and for a plain integer string of 7 to 11 digits that came from a numeric cell, flagged by the caller).

- [ ] **Step 1: Write failing tests**: `0012345678905 keeps its zeros`, `a scan ending in a carriage return is trimmed`, `Arabic-Indic digits are converted`, `a valid EAN-13 is valid and a one-digit-off one is invalid`, `a 6-digit internal code is not-applicable and accepted`, `1.23457E+12 is lossy`, `a code with letters is kept as text`, `empty and whitespace-only input normalise to an empty string and are refused by callers`.
- [ ] **Step 2: Run**, expect FAIL. **Step 3: Implement.** **Step 4: Run**, expect PASS.
- [ ] **Step 5: Commit** `feat(pharmacy): barcode normalisation and check digits`.

### Task 18: Product identity (pure)

**Files:**
- Create: `src/server/domain/pharmacy/product-identity.ts`
- Test: `tests/pharmacy/product-identity.test.ts`

**Interfaces:**
- Produces: `identityKeyOf(input: { tradeName: string; strength: string; form: string; manufacturer: string; packLabel: string }): string` (case-folded, Arabic and Latin digits unified, Arabic letter variants unified (ا أ إ آ, ى ي, ة ه as the project's existing name-key helper does; reuse `nameKey` from `src/server/domain/pos/stock.ts` if it fits, else extend a shared helper without changing its current outputs), whitespace and punctuation collapsed, units spelled `mg`/`ملغ` unified); `sameProduct(a, b): boolean`.
- A different strength, form or pack label gives a different key; a different manufacturer gives a different key.

- [ ] **Step 1: Write failing tests**: `Panadol 500 mg tablet 24s equals panadol 500MG Tablet 24s`, `Arabic and Latin digits are the same (٥٠٠ and 500)`, `500 mg and 1000 mg are different products`, `tablet and syrup are different products`, `pack of 20 and pack of 24 are different products`, `two manufacturers are different products`, `120 mixed Arabic and Latin characters produce a key and never throw`, `the key is stable (same input twice)`.
- [ ] **Step 2: Run**, expect FAIL. **Step 3: Implement.** **Step 4: Run**, expect PASS.
- [ ] **Step 5: Commit** `feat(pharmacy): product identity key`.

### Task 19: Product service, actions and barcode resolver

**Files:**
- Create: `src/server/pharmacy/products.ts`, `src/server/pharmacy/barcodes.ts`, `src/server/pharmacy/actions/products.ts`, `src/server/pharmacy/queries/products.ts`
- Test: `tests/pharmacy/products.test.ts`

**Interfaces:**
- Consumes: Tasks 7, 15, 16, 17, 18.
- Produces: actions `ph.products.create`, `ph.products.update` (input carries `expectedVersion`), `ph.products.archive` (no delete), all `ph: 'catalog.manage'`; input schema `productInput` (trade name 1 to 200 characters, strength, form, manufacturer, `rxLevel`, `levels: UnitLevel[]`, `barcodes: { code: string; level: number; shared?: boolean }[]`, `branchSettings: { branchId; minQty; reorderQty }[]`); `resolveBarcode(db, code: string): Promise<{ kind: 'none' } | { kind: 'one'; productId: string; unitId: string } | { kind: 'many'; candidates: { productId; unitId }[] }>`; queries `ph.products.get`, `ph.products.list` (`ph: 'catalog.view'`, paged, `active` filter, never returns cost to a role without `cost.view`).
- Rules: the ladder is validated; `identityKey` is computed server-side, and a duplicate returns `DUPLICATE_PRODUCT` with the existing product id and name; a barcode already used on another product is refused `BARCODE_IN_USE` unless the same call marks it `shared`, which needs `catalog.manage` and writes an audit line; changing a unit's `baseQty` after the product has any batch or sale is refused (a Phase 2 guard: the check reads the batch table when it exists and is a no-op until then, with a test that fails if the table appears without the guard); archive is refused while an open record references it (also a no-op now).

- [ ] **Step 1: Write failing tests**: `creates a product with units, barcodes and branch settings in one transaction and audits it`, `a duplicate identity is refused and names the existing product`, `500 mg and 1000 mg of the same trade name are both created`, `an invalid ladder is refused with its code`, `a barcode on another product is refused BARCODE_IN_USE`, `a shared barcode makes resolveBarcode return many`, `resolveBarcode of 0012345678905 does not match 12345678905`, `a stale expectedVersion is refused naming who changed it`, `a cashier cannot create a product and can list it`, `an accountant sees cost fields and a cashier does not`, `a branch manager of branch 1 cannot set branch settings for branch 2`, `two simultaneous creates of the same product end with exactly one product`, `archive keeps the row and hides it from the default list`.
- [ ] **Step 2: Run**, expect FAIL. **Step 3: Implement** with services returning plain data and actions only orchestrating; use `updateWithVersion` as the restaurants service does. **Step 4: Run**, expect PASS.
- [ ] **Step 5: Commit** `feat(pharmacy): products, units and barcodes`.

### Task 20: Prices with history, and bulk pricing

**Files:**
- Create: `src/server/domain/pharmacy/bulk-price.ts`, `src/server/pharmacy/prices.ts`, `src/server/pharmacy/actions/prices.ts`, `src/server/pharmacy/queries/prices.ts`
- Test: `tests/pharmacy/bulk-price.test.ts`, `tests/pharmacy/prices.test.ts`

**Interfaces:**
- Consumes: Task 15 money, Task 7 framework.
- Produces: `ph.prices.set` (`ph: 'price.change'`; input `productId, unitId, branchId?, currency, amount: string, validFrom, reason`) appends a `PhPrice` row and sets the previous open row's `validTo` to the new `validFrom` in the same transaction; rows are never updated otherwise; `priceAt(db, { productId, unitId, branchId, currency, at: Date }): Promise<PhMoney | null>` (a branch row wins over the business-wide row); `ph.prices.history` query; pure `previewBulk(input: { rows: { productId; unitId; currency; current: bigint }[]; change: { kind: 'percent'; basisPoints: number } | { kind: 'fixed'; amount: bigint }; rounding: { step: bigint; mode: 'nearest' | 'up' | 'down' } }): { rows: { productId; unitId; before: bigint; after: bigint }[]; previewHash: string }`; `ph.prices.previewBulk` stores a `PhPriceChangeBatch` and `ph.prices.applyBulk` takes `{ batchId, previewHash }` and applies all or nothing; a hash that no longer matches the current prices is refused `PREVIEW_STALE`.

- [ ] **Step 1: Write failing tests**: `setting a price closes the previous one at the new validFrom and keeps it in history`, `priceAt returns the price that was valid at a past date`, `a branch price overrides the business price only in that branch`, `a USD price on an IQD-only business is refused`, `a negative amount is refused`, `a price without a reason is refused`, `a price change never updates an old row's amount (assert by reading history)`, `10% up on 1,250 IQD with step 250 rounding nearest gives 1,500`, `rounding up and down differ as expected at the boundary`, `a bulk apply with a stale preview hash is refused and changes nothing`, `a bulk apply is all or nothing (one failing row leaves every price unchanged)`, `a cashier cannot set a price`, `applying the same batch twice changes prices once`.
- [ ] **Step 2: Run**, expect FAIL. **Step 3: Implement.** **Step 4: Run**, expect PASS.
- [ ] **Step 5: Commit** `feat(pharmacy): price history and previewed bulk pricing`.

### Task 21: Central search and its load budget

**Files:**
- Create: `src/server/pharmacy/search.ts`, `prisma/seed-load-pharmacy.ts`, `tests/load/pharmacy-search.test.ts`
- Modify: the catalog migration of Task 14 only through a new additive migration `<timestamp>_pharmacy_search_indexes` (trigram extension and indexes)
- Test: `tests/pharmacy/search.test.ts`

**Interfaces:**
- Produces: `searchProducts(db, input: { q: string; branchId?: string; limit?: number; includeInactive?: boolean }): Promise<{ productId; unitId?: string; matchedOn: 'barcode' | 'tradeName' | 'genericName' | 'activeIngredient'; label: string; strength: string; form: string; packLabel: string; price: PhMoney | null }[]>` with this order: exact barcode (normalised), then name prefix, then trigram similarity on trade name, generic name and active ingredient; Arabic and Latin digits and letter variants unified through the identity normaliser; limit default 30, max 100. `seed-load-pharmacy.ts` creates 50,000 products across two businesses for the load test.
- Budget (spec 9): p95 under 150 ms at 50,000 products with 2 concurrent clients, measured on the private database.

- [ ] **Step 1: Write failing tests**: `an exact barcode wins over any name match`, `a barcode with leading zeros finds the product and the same digits without zeros do not`, `an Arabic name finds the product typed in Arabic-Indic digits`, `search by active ingredient finds every brand`, `results show strength, form and pack so 500 mg and 1000 mg are distinguishable`, `search never returns another business's products or an archived one by default`, `an empty query returns an empty list, not the whole catalog`, `a 120-character query does not throw`.
- [ ] **Step 2: Load test** `tests/load/pharmacy-search.test.ts` (runs under `npm run test:load`): asserts p95 under 150 ms over 1,000 mixed queries on the seeded 50,000 products.
- [ ] **Step 3: Run**, expect FAIL. **Step 4: Implement** with `pg_trgm` GIN indexes in the new migration (check that Neon allows `CREATE EXTENSION IF NOT EXISTS pg_trgm` on the private database; if the extension cannot be created in this environment, stop and report instead of falling back to `ILIKE '%q%'`).
- [ ] **Step 5: Run** `npx vitest run tests/pharmacy/search.test.ts` then `npm run test:load -- tests/load/pharmacy-search.test.ts`. Expected: PASS, PASS within budget.
- [ ] **Step 6: Commit** `feat(pharmacy): central product search`.

### Task 22: Product import rules (pure)

**Files:**
- Modify: `src/server/sheets/read.ts` (accept `maxRows` option; default stays 2,000 so the menu import is unchanged)
- Create: `src/server/domain/pharmacy/import-products.ts`
- Test: `tests/pharmacy/import-products.test.ts`, existing `tests/sheets/*` stays green

**Interfaces:**
- Produces: `PRODUCT_COLUMNS` (`tradeName`, `genericName`, `activeIngredient`, `strength`, `form`, `manufacturer`, `category`, `rxLevel`, `packLabel`, `unitsPerPack`, `barcode`, `salePrice`, `currency`, `minQty`, `shelfLocation`); `suggestMapping(headers: string[]): Record<string, string | null>` using a synonym dictionary in en, ar and ckb (a header with no confident match maps to `null`, never guessed); `validateRows(input: { rows: string[][]; rowNumbers: number[]; mapping; existingIdentityKeys: ReadonlySet<string>; existingBarcodes: ReadonlyMap<string, string>; enabledCurrencies }): { rows: ParsedRow[]; summary: { ok: number; warnings: number; errors: number } }` where each `ParsedRow` has `status: 'ok' | 'warning' | 'error' | 'duplicate'` and `issues: { code; field; message }[]`; codes include `LOSSY_BARCODE`, `BARCODE_CHECK_DIGIT`, `DUPLICATE_IN_FILE` (names the first row), `DUPLICATE_PRODUCT`, `BARCODE_IN_USE`, `BAD_PRICE`, `CURRENCY_NOT_ENABLED`, `MISSING_NAME`, `UNKNOWN_RX_LEVEL`, `BAD_PACK`; `batchHash(rows, mapping): string`.

- [ ] **Step 1: Write failing tests**: `suggestMapping maps English, Arabic and Sorani headers and leaves an unknown header null`, `a barcode cell 1.23457E+12 is an error LOSSY_BARCODE naming its row`, `a numeric barcode of 7 digits from a number cell is a warning (leading zeros may be lost)`, `a barcode read as text keeps its zeros`, `prices with Arabic-Indic digits and thousands separators parse`, `a row repeated in the file is DUPLICATE_IN_FILE pointing to the first row`, `500 mg and 1000 mg rows with the same name are both ok`, `a row that matches an existing product is duplicate and never updates it`, `a USD price on an IQD-only business is an error`, `a UTF-8 BOM CSV reads the first header correctly`, `5,000 rows validate in under 2 seconds`, `an unknown rx level is an error and is never defaulted to OTC`.
- [ ] **Step 2: Run**, expect FAIL. **Step 3: Implement** reusing `domain/import-sheet.ts` conventions (draft hash) and Tasks 15 to 18. **Step 4: Run** `npx vitest run tests/pharmacy/import-products.test.ts tests/sheets`. Expected: PASS.
- [ ] **Step 5: Commit** `feat(pharmacy): product import validation rules`.

### Task 23: Import and export actions

**Files:**
- Create: `src/server/pharmacy/imports.ts`, `src/server/pharmacy/exports.ts`, `src/server/pharmacy/actions/imports.ts`, `src/server/pharmacy/queries/exports.ts`
- Test: `tests/pharmacy/imports.test.ts`

**Interfaces:**
- Consumes: Tasks 19, 22.
- Produces: `ph.imports.preview` (`ph: 'import.apply'`; input file base64 up to 5 MB, `.xlsx` or `.csv` checked by bytes with the existing `media-type` helpers, optional confirmed `mapping`) reads at most 10,000 rows, stores a `PhImportBatch` with its rows and issues, returns `{ batchId, suggestedMapping, summary, firstRowsWithIssues }`; `ph.imports.apply` (`{ batchId, batchHash, acceptWarnings: boolean }`) creates the `ok` rows (and `warning` rows only if accepted) in one transaction through the same service as `ph.products.create`, is idempotent by `batchId`, and refuses a batch with errors unless those rows are excluded explicitly; `ph.exports.products` query (`ph: 'catalog.view'`, `allowReadOnly`) returns CSV or XLSX of the products the actor may see, without cost columns unless `cost.view`, and works in the read-only state; duplicate files are flagged by `fileSha256` (`DUPLICATE_IMPORT` with the earlier batch date; applying again needs an explicit override reason).

- [ ] **Step 1: Write failing tests**: `preview stores rows and issues and changes no product`, `apply creates exactly the ok rows and audits one summary entry`, `apply of the same batch twice creates the products once`, `a changed batchHash is refused`, `a batch with error rows cannot be applied unless they are excluded`, `the same file uploaded again is flagged DUPLICATE_IMPORT`, `a file with the wrong bytes behind an .xlsx name is refused`, `10,001 rows are refused with TOO_MANY_ROWS`, `5,000 rows preview in at most 10 seconds on the test database` (my call, adjust with the owner), `export works for a readOnly pharmacy and is refused for an archived one`, `export omits cost for a cashier`, `a cashier cannot preview an import`, `a failure halfway through apply leaves no product from that batch`.
- [ ] **Step 2: Run**, expect FAIL. **Step 3: Implement.** **Step 4: Run**, expect PASS.
- [ ] **Step 5: Commit** `feat(pharmacy): previewed product import and permission-aware export`.

### Task 24: Catalog screens

**Files:**
- Create: `src/app/pharmacy/(app)/catalog/{page.tsx,new/page.tsx,[id]/page.tsx,import/page.tsx}`, `src/app/pharmacy/_ui/{ProductSearch,ProductEditor,UnitLadderEditor,BarcodeList,PriceHistory,ImportWizard,UnsavedBadge}.tsx`, `src/lib/use-draft.ts`
- Modify: `src/studio/messages/pharmacy/{en,ar,ckb}.ts`
- Test: `tests/pharmacy/ui-catalog.test.tsx`, `tests/e2e/pharmacy-catalog.spec.ts`

**Interfaces:**
- Produces: `useDraft<T>(key: string, initial: T): { value: T; set(next: T): void; dirty: boolean; clear(): void; restored: boolean }` storing in IndexedDB under `userId:screen:id`, never in the server and never containing a barcode scan buffer; the list (central search, `/` focuses it, results show strength, form, pack and, with `cost.view`, cost); the editor with the unit ladder, barcodes (scan input uses `normalizeScan`), branch settings, price history tab; the import wizard (upload, mapping, preview table with row issues, apply); every state has loading, empty, error and offline notices with text and an icon; the read-only notice disables write controls with the reason.

- [ ] **Step 1: Write failing tests**: `the editor shows an unsaved-changes badge after an edit and clears it after save`, `a restored draft offers restore or discard`, `leaving with unsaved changes warns`, `a read-only pharmacy renders no save buttons and says why`, `a 120-character mixed-script name wraps and is not clipped at 375px`, `an empty catalog shows the empty state with the import and add actions`, `the barcode field keeps 0012345678905 as typed`, `cost is not in the DOM for a cashier`.
- [ ] **Step 2: E2E** `pharmacy-catalog.spec.ts`: owner creates a product with box/strip/tablet and two barcodes, searches it by barcode and by Arabic name, changes its price with a reason and sees the history, imports a 20-row sample with two bad rows and applies it, exports it; a cashier sees the list only; in Arabic RTL at 375, 768 and 1280px with no horizontal scroll; `axe` passes.
- [ ] **Step 3: Run**, expect FAIL. **Step 4: Implement** with the Studio's components where they exist (`PageHeader`, `EmptyState`, `StatusBadge`); no motion.
- [ ] **Step 5: Run** `npx vitest run tests/pharmacy` and `npx playwright test tests/e2e/pharmacy-catalog.spec.ts`. Expected: PASS.
- [ ] **Step 6: Commit** `feat(pharmacy): catalog screens, drafts and import wizard`.

### Task 25: Acceptance, cleanup and review

**Files:**
- Create: `tests/pharmacy/acceptance-phase-0-1.test.ts`, `docs/pharmacy/README.md` (what exists, what is not built, how to run, the support-access policy, the retention policy)
- Modify: `docs/superpowers/specs/2026-10-27-pharmacy-design.md` (record the RLS decision and any call changed)
- Delete: `scripts/spikes/rls-spike.ts` unless Task 13 decided ADOPT

- [ ] **Step 1: Write the acceptance test** mapping the spec's phase 0 and 1 criteria to one scenario each: Super Admin creates a pharmacy with two branches and invites an owner; isolation by business, by branch and by permission passes; the FOOD golden tests are green; a duplicate product with a different strength is accepted and with the same identity is refused; a barcode keeps its zeros end to end; 5,000-row import previews inside the budget.
- [ ] **Step 2: Run the whole suite:** `npm run typecheck`, `npx eslint src tests`, `npm test`, `npm run test:load`, `npm run test:e2e`. Expected: all green; the test count is the baseline plus this plan's tests and nothing regressed.
- [ ] **Step 3: Run** `graphify update .`, then `git diff --stat` to catch CRLF churn.
- [ ] **Step 4:** Use `superpowers:verification-before-completion`, then `code-review` on the branch diff; fix findings; commit `docs(pharmacy): phase 0 and 1 acceptance and README`.
- [ ] **Step 5:** Stop. Do not push, open a PR or touch production without the owner's explicit word.

---

## Self-review

- **Spec coverage:** section 4.1 (Task 1, 8, 9), 4.2 (2, 7), 4.3 catalog groups of phase 1 (14), 4.4 money and units (15, 16), 4.5 (3), 4.6 (4, 6, 7, 11), 4.7 (6), section 5 shell (12), phase 0 RLS spike (13), phase 1 catalog, barcodes, prices, import and export (14 to 24), owner decisions: two currencies (1, 9, 15, 20, 22), single branch now with branch isolation kept (2, 7), 90 days (6), RLS spike (13), Excel import (22, 23). Not in these phases by design: batches, sales, AI, devices, printing (Phases 2 to 8).
- **Open questions still affecting this plan:** retail price caps (A) are not enforced anywhere in Phase 1 and the price actions have no cap hook yet; the import timing budget in Task 23 and the permission matrix in Task 3 are my calls for the owner to confirm.
- **Type consistency:** `PhActor`, `PhGate`, `PhTarget`, `PhPermission`, `PhMoney`, `UnitLevel` are defined once (Tasks 3, 6, 7, 15, 16) and used by name afterwards.
