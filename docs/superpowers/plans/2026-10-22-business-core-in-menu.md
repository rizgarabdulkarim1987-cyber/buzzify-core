# Buzzify Core: Billing for Every Product, Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** This app becomes Buzzify Core, the one backend for every Buzzify product. For each restaurant, the platform
owner chooses which products it has (Menu alone, Cashier alone, or both), on which plan, for which period and price,
and records the payments by hand.

**Architecture:** The user wants everything in one place: this repository, renamed `buzzify-core` on GitHub, with one
Hostinger website and one Neon database. The billing half of the separate `buzzify-business-core` repository moves in
and sits on top of what `main` already has:

- **Plans (`src/server/domain/entitlements.ts`).** `Restaurant.plan` is a `PlanTier` (BASIC, PRO, PREMIUM), and
  `planExtras` and the `plans` platform setting decide the Menu features. They stay exactly as they are and become the
  Menu product's plans.
- **The platform owner (`User.isPlatformOwner`).** Only this account holds `plans.manage`, and it is the only account
  that changes billing too.
- **The framework and history.** `defineAction`/`runAction`, `AuditLog` and the en/ar/ckb Studio are reused as they are.

New:
- `Application`, the products (`menu`, `cashier`);
- `PlanPrice`, what a plan costs per currency and period;
- `Subscription`, one restaurant's subscription to one product, with periods and status;
- `SubscriptionEvent`;
- `Payment`, recorded by hand.

For `menu`, a subscription's `planCode` is a `PlanTier`. Starting, changing or paying a Menu subscription writes
`Restaurant.plan` in the same transaction, so the Menu features keep reading the field they read today.

Core's separate sign-in, `ServiceClient`, v1 API and health probes are not ported.

**Tech Stack:** Next.js 16.4.1, React 19.3, TypeScript 5.9, Prisma 7.10 on PostgreSQL, Zod 4, Tailwind 4, Radix UI,
Vitest 5, Playwright 1.64; Hostinger Node.js website (`build:host`), Neon.

**Spec:**
- `docs/business/2026-10-22-architecture-audit.md` (in the main checkout, untracked; sections on Core and billing);
- `docs/superpowers/specs/2026-10-18-plans-and-entitlements-design.md`, whose rules still hold;
- the user's decisions below.

**Code to port:** `main` of `C:\Users\pc\Documents\GitHub\buzzify-business-core` (merge 79f2654), in
`src/server/domain/{money,periods,subscriptions}.ts`, `src/server/services/{plans,subscriptions,payments}.ts`,
`src/app/api/cron/subscriptions/route.ts`, `src/admin/{settle,money-input}.ts`, and their tests.

**Base:** `main` at 7258408, branch `billing`, worktree `.claude/worktrees/billing`.

## The user's decisions (binding)

- One repository (`buzzify-core` on GitHub), one Hostinger website, one database for every product. Products are
  sections of this app.
- A restaurant can have any single product or several, each subscribed to separately.
- Payments are recorded by hand. CASH is the default. Electronic method names are labels only. No payment gateway,
  ever.
- The Studio's name becomes **Buzzify Core** (Task 0).

## Global Constraints

- The Global Constraints of `docs/superpowers/plans/2026-10-18-plans-and-entitlements.md` still apply:
  - exact version pins and no raw SQL outside migrations;
  - logical CSS, every Studio string in `src/studio/messages/{en,ar,ckb}.ts`, and machine-drafted ar/ckb flagged;
  - every Studio read and write through `defineAction`/`defineQuery`;
  - new audit names registered in `src/server/domain/audit-actions.ts`, with `activity.*` labels in three languages;
  - cross-tenant cases in `tests/studio/cross-tenant.test.ts` for every new action and query;
  - a commit after each task, ending with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
- Plans sell quality, never quantity. Billing adds no limits.
- Money:
  - `Int` minor units beside `Currency` `IQD` (0 digits) or `USD` (2 digits);
  - never floats, never summed across currencies;
  - `amountMinor` from 0 to `2_147_483_647`.
- Periods follow the Asia/Baghdad wall clock (UTC+3, no daylight saving) with the anchor day clamped, as in Core's
  `addPeriod`.
- Subscription statuses are exactly `TRIAL`, `ACTIVE`, `GRACE`, `EXPIRED`, `CANCELLED`. At most one live
  (`TRIAL`/`ACTIVE`/`GRACE`) subscription per restaurant and application is allowed, enforced by the partial unique
  index `Subscription_live_key`. Grace is 7 days by default.
- Writes need `plans.manage` (the platform owner). Reads need `platform.settings` (any Super Admin). No membership role
  or client policy can ever hold either.
- Billing never changes what guests see by itself:
  - an expired or missing subscription does not downgrade or hide anything in this plan;
  - only the `menu` plan code written to `Restaurant.plan` does, as the owner's plan change does today.
- The migration only adds enums, tables and indexes. It never alters, drops or rewrites an existing table, column or
  row.
- No production database change without:
  - a Neon snapshot;
  - the migration tried on a Neon branch of production;
  - the user's explicit approval.
- Use the worktree's own database port (`BUZZIFY_DB_PORT`, not 54329) for every database command and test run.

## Review Focus

1. **Existing restaurants after the deploy** keep their `plan` and every feature, and have no subscription rows. Tested
   in Task 1: the migration on a seeded database leaves `Restaurant` rows unchanged.
2. **A payment sent twice after a lost answer** records one payment. Tested in Task 3 (the same `idempotencyKey` twice
   gives one row and the same result).
3. **Paying an expired subscription while another for the same product is live** answers `CONFLICT`. Tested in Task 3.
4. **A sweep in which one row fails** still sweeps the others and reports `failed: 1`. Tested in Task 4.
5. **A Super Admin who is not the platform owner** can read billing but is refused every billing write with `FORBIDDEN`.
   Tested in Task 3.

---

### Task 0: The Studio is named Buzzify Core

**Files:**
- Modify:
  - `src/app/studio/(studio)/layout.tsx` (the title);
  - `src/server/studio/auth/auth.ts` (`appName` and the two-factor `issuer`);
  - `src/server/email/templates.ts` (`BRAND`);
  - `src/server/domain/platform-settings.ts` (the default `emailSenderName`);
  - `src/server/env.ts` (the default `EMAIL_FROM` name and its message);
  - every `Buzzify Studio` in `src/studio/messages/{en,ar,ckb}.ts`.
- Test: the existing tests that assert `Buzzify Studio` are updated to `Buzzify Core`.

The words "the Studio" as the name of the workspace in running text stay. Only the product name `Buzzify Studio` changes.
Authenticator entries people already added keep their old label, which is expected. Stored platform settings are not
rewritten.

- [ ] **Step 1:** Run `git grep -n "Buzzify Studio" -- src tests` and change each match to `Buzzify Core`.
- [ ] **Step 2:** Run `npm test` and `npm run typecheck`. Expected: PASS.
- [ ] **Step 3:** Commit `feat(studio): the workspace is named Buzzify Core`.

### Task 1: Billing tables and the products

**Files:**
- Modify: `prisma/schema.prisma`
- Create: `prisma/migrations/<timestamp>_billing/migration.sql`
- Create: `src/server/domain/billing/catalog.ts`
- Modify: `prisma/seed.ts` (upsert the two applications)
- Test: `tests/billing/schema.test.ts`

**Interfaces:**
- Produces enums `AppStatus` (`ACTIVE`, `DISABLED`), `Currency`, `BillingPeriod` (`MONTHLY`, `YEARLY`),
  `SubscriptionStatus`, `SubscriptionEventType` and `PaymentMethod`, copied from Core's schema.
- Produces these models.
  - `Application`:
    - `id` String (`menu`, `cashier`);
    - `name` Json `{ en, ar, ckb }`;
    - `status` AppStatus;
    - `sortOrder` Int;
    - timestamps.
  - `PlanPrice`:
    - `applicationId`, `planCode` String, `currency`, `period`, `amountMinor` Int;
    - `@@unique([applicationId, planCode, currency, period])`.
  - `Subscription`, as in Core with these changes:
    - `restaurantId` (a relation to `Restaurant`) instead of `businessId`;
    - `planCode` String instead of `planId`;
    - fields `status`, `period`, `currency`, `priceMinor`, `trialEndsAt`, `currentPeriodStart`, `currentPeriodEnd`,
      `anchorDay`, `graceDays` (default 7), `cancelledAt` and `version`;
    - `@@index([status, currentPeriodEnd])` and `@@index([restaurantId])`.
  - `SubscriptionEvent`: as in Core.
  - `Payment`:
    - as in Core, with `restaurantId` instead of `businessId`;
    - `method` defaults to `CASH`;
    - `idempotencyKey` is unique.
  - `Restaurant` gains only relation lists. There is no new column on any existing table.
- Produces the partial unique index `Subscription_live_key` on `("restaurantId", "applicationId")` where the status is
  `TRIAL`, `ACTIVE` or `GRACE`.
- Produces in `catalog.ts`:
  - `APPLICATION_IDS = ['menu', 'cashier'] as const`;
  - `planCodesFor(applicationId): readonly string[]`, which gives `PLAN_TIERS` for `menu` and `[]` for `cashier` until
    the Cashier has plans;
  - `DEFAULT_APPLICATIONS`, with the en/ar/ckb names Menu / المنيو / مێنو and Cashier / الكاشير / کاشێر (ar and ckb
    machine-drafted). `cashier` is `DISABLED`.

- [ ] **Step 1:** Write `tests/billing/schema.test.ts`:
  - a second live subscription for the same restaurant and application throws a unique violation;
  - an `EXPIRED` one beside a live one is accepted;
  - running the seed twice leaves exactly two applications;
  - an existing restaurant's `plan`, `planExtras` and `version` are unchanged after the migration.
- [ ] **Step 2:** Run it with the worktree's database. Expected: FAIL.
- [ ] **Step 3:** Add the models. Run `npx prisma migrate dev --create-only --name billing` against the worktree
  database, append the partial index, and read the SQL: only `CREATE TYPE`, `CREATE TABLE`, `CREATE INDEX` and
  `ADD CONSTRAINT` on new tables.
- [ ] **Step 4:** Apply it, then run the test and `npm test`. Expected: PASS.
- [ ] **Step 5:** Commit `feat(billing): products, prices, subscriptions and hand-recorded payments tables`.

### Task 2: Billing rules (pure)

**Files:**
- Create: `src/server/domain/billing/{money,periods,subscriptions}.ts`, ported from Core's domain
- Test: `tests/billing/domain/{money,periods,subscriptions}.test.ts`, ported from Core

**Interfaces:**
- Produces Core's signatures unchanged:
  - the money helpers (`MAX_AMOUNT_MINOR = 2_147_483_647` among them);
  - `addPeriod`;
  - `dueTransition`, `effectiveStatus`, `lifecycleSteps`.
- Core's `entitlements.ts` is not ported: Menu's own entitlements stay the only feature resolver.

- [ ] **Step 1:** Copy the tests, fixing import paths only. Run them. Expected: FAIL.
- [ ] **Step 2:** Copy the modules.
- [ ] **Step 3:** Run them. Expected: PASS, with as many tests as in Core.
- [ ] **Step 4:** Commit `feat(billing): money, periods and the subscription lifecycle`.

### Task 3: Billing actions and queries

**Files:**
- Create: `src/server/studio/services/billing.ts`
- Create: `src/server/studio/actions/billing.ts`
- Create: `src/server/studio/queries/billing.ts` (follow the existing query files)
- Modify: `src/server/domain/audit-actions.ts` and the activity labels in three languages
- Test: `tests/studio/billing.test.ts`, ported from Core's service tests; `tests/studio/cross-tenant.test.ts`

**Interfaces:**
- Writes need `plans.manage`; reads need `platform.settings`.

  | Kind | Name | What it does | Audit name |
  |---|---|---|---|
  | action | `billing.setApplication` | name and status of a product | `application.updated` |
  | action | `billing.setPrices` | replaces one plan's prices | `plan_prices.updated` |
  | action | `billing.startTrial` | | `subscription.trial_started` |
  | action | `billing.changePlan` | | `subscription.plan_changed` |
  | action | `billing.cancel` | | `subscription.cancelled` |
  | action | `billing.reactivate` | | `subscription.reactivated` |
  | action | `billing.recordPayment` | | `payment.recorded` |
  | query | `billing.overview` | products with their prices | none |
  | query | `billing.restaurant` | one restaurant's subscriptions, events and payments, statuses judged now with `effectiveStatus` | none |

- Rules kept from Core:
  - `billing.recordPayment` is idempotent per `idempotencyKey`: a repeat returns the first result and writes nothing.
  - Paying `ACTIVE` or `GRACE` renews from the old period end.
  - Paying `TRIAL`, `EXPIRED`, or a `CANCELLED` subscription whose period has ended starts at now and re-anchors.
  - Paying while another live subscription exists answers `CONFLICT`.
  - `billing.startTrial` refuses a restaurant whose status is not `ACTIVE`, and a product that is `DISABLED`.
  - `planCode` must be in `planCodesFor(applicationId)`.
  - Subscription writes use `updateWithVersion`.
- For `menu`: `billing.startTrial`, `billing.changePlan` and `billing.recordPayment` with a plan code set
  `Restaurant.plan` to it in the same transaction. They expire the restaurant's menu caches after commit, exactly as
  `plans.setRestaurantPlan` does (reuse its helper, do not copy it). They also write the existing
  `restaurant.plan_changed` audit row when the plan changed.

- [ ] **Step 1:** Port Core's service tests onto these actions. Add:
  - Review Focus 2, 3 and 5;
  - a Menu plan change that is seen in `Restaurant.plan`;
  - a disabled product that refuses a trial;
  - cross-tenant cases (an OWNER of restaurant A calling each action and query for restaurant B gets `FORBIDDEN`).
- [ ] **Step 2:** Run them. Expected: FAIL.
- [ ] **Step 3:** Implement the services, actions and queries.
- [ ] **Step 4:** Run them, then `npm test`. Expected: PASS.
- [ ] **Step 5:** Commit `feat(billing): trials, plan changes, renewals and hand-recorded payments`.

### Task 4: The lifecycle sweep

**Files:**
- Create: `src/app/api/cron/subscriptions/route.ts` (Core's, without health probes and rate-limit pruning)
- Test: `tests/billing/cron.test.ts`

**Interfaces:**
- Uses the same `CRON_SECRET` check as `src/app/api/cron/publish/route.ts` (reuse its helper).
- Responses:
  - 401 without the secret;
  - 503 when none is configured;
  - 200 with `{ graced, expired, failed }`;
  - a JSON 500 on a systemic failure.
- Each row is handled in its own transaction and writes its `SubscriptionEvent`.

- [ ] **Step 1:** Port Core's cron tests. Add Review Focus 4. Run them. Expected: FAIL.
- [ ] **Step 2:** Implement the route.
- [ ] **Step 3:** Run the tests. Expected: PASS.
- [ ] **Step 4:** Commit `feat(billing): sweep overdue subscriptions every 15 minutes`.

### Task 5: Billing in the Studio

**Files:**
- Create: `src/app/studio/(studio)/(app)/settings/billing/` (products and their prices, as a Settings tab beside
  Plans; register it in `settings/tabs.ts`)
- Create: `src/app/studio/(studio)/(app)/restaurants/[id]/billing/`, the restaurant's products:
  - each product's subscription and status;
  - start trial, record payment, change plan, cancel and reactivate;
  - the payment history.
- Create: `src/studio/settle.ts` and `src/studio/money-input.ts`, ported from Core's `src/admin/`
- Modify: the restaurant tabs (visible to Super Admins only), the messages in three languages, and
  `tests/studio/messages.test.ts` if it lists keys
- Test: component tests in the style of `tests/studio/plans-ui.test.ts`, and one Playwright flow: start a Menu trial on
  a throwaway restaurant, record a cash payment, and see the period end move

**Interfaces:**
- Consumes Task 3's actions and queries only.
- `settle()` keeps a payment's `idempotencyKey` when an answer is lost.
- The money input takes whole IQD, or USD with two decimals, and sends minor units.
- The platform owner sees the controls. Another Super Admin sees the same pages read-only.

- [ ] **Step 1:** Write the component tests and the e2e flow. Run them. Expected: FAIL.
- [ ] **Step 2:** Build the pages with the Studio's existing components and tokens (`src/studio/studio.css`). The model
  is the plan page (`restaurants/[id]/plan`). Right to left for ar and ckb.
- [ ] **Step 3:** Run `npm test`, `npm run lint` and `npm run typecheck`, then the e2e flow with its own `E2E_PORT` and
  `BUZZIFY_DB_PORT`. Expected: PASS.
- [ ] **Step 4:** Commit `feat(studio): products, prices and each restaurant's subscriptions`.

### Task 6: Deploy notes

**Files:**
- Modify: `docs/deploy/hostinger.md`
  - the repository is `buzzify-core`;
  - an hPanel cron job calls `/api/cron/subscriptions` every 15 minutes (`*/15 * * * *`) with the existing `CRON_SECRET`;
  - the production migration procedure: a Neon snapshot, `prisma migrate deploy` on a branch of production, then the
    deploy, with the user's approval.
- Modify: `README.md` for the name.

- [ ] **Step 1:** Write the changes.
- [ ] **Step 2:** Commit `docs(deploy): billing cron and the production migration steps`.

## After the plan (with the user, one approval each)

1. Open the pull request into `main`.
2. Take a Neon snapshot of `buzzify-menu` production, and try `prisma migrate deploy` on a branch of it.
3. Merge, build on Hostinger, and add the cron job.
4. Archive the GitHub repository `buzzify-business-core`, and delete the empty Neon project `buzzify-core`
   (`spring-unit-79756558`).
