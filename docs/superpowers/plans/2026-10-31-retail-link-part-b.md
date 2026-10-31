# Retail link, Part B (Studio side, in `buzzify-menu`): implementation plan

> **For implementers:** use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans. Steps
> are `- [ ]` checkboxes. Read `AGENTS.md` first: this is Next.js 16.4.1. Before writing a Route Handler, `after()`,
> `cookies()` or a redirect, read the matching guide in `node_modules/next/dist/docs/`. Before calling a Better Auth API
> not used in this repo yet, read it in `node_modules/better-auth` (pinned 1.7.10).

**Goal:** a Super Admin creates a RETAIL business in Studio the way a pharmacy is created; Studio bills it with `retail`
AppPlans, pushes signed, versioned state snapshots to Retails through a durable outbox, serves Retails the Anthropic key
and identities, and signs its users in to Retails with a single-use handoff token.

**Architecture:** Studio is the source of truth. One `RetailLink` row per RETAIL business holds the link (Retails id,
currencies, `ai.intake` switch, a monotonic `stateVersion`). Every change that alters the snapshot bumps `stateVersion`
and upserts one coalescing `RetailOutbox` row **in the same transaction**. A sender (an immediate `after()` kick plus a
per-minute cron) leases due rows with `FOR UPDATE SKIP LOCKED`, builds the snapshot from the database at send time
(under a `FOR SHARE` lock on the link row, so the version and the content match), signs it and POSTs `provision` or
`state`. A daily reconcile reads Retails' `GET state` and re-pushes on drift. Retails calls three signed Studio
endpoints under `/api/retail/v1/*`.

**Tech stack:** Next.js 16.4.1 (App Router, Route Handlers, `after`), Prisma 7.10.1 (`prisma.config.ts`, migrations in
`prisma/migrations`), PostgreSQL (CI: postgres:18), Better Auth 1.7.10, zod 4.6.7, Vitest 5 (real PostgreSQL), Playwright.

**Spec (binding: sections 5 and 9):** `buzzify-retails/docs/superpowers/specs/2026-10-31-retail-core-unified-admin-design.md`.
Contract as built: `buzzify-retails/docs/superpowers/plans/2026-10-31-retail-core-unified-admin-A.md`,
`buzzify-retails/docs/deployment-notes.md` ("Studio (core) link: sign-in handoff", "Studio contract (Part B must
implement)", "Studio link (Part A)"), and the code in `buzzify-retails/src/server/core/{signing,handoff,state,client,config}.ts`,
`src/server/admin/core-{provision,state,handoff}.ts`, `src/app/api/core/v1/**`. When this plan and that code disagree,
the Retails code wins: it is deployed-ready and has tests.

---

## Resolved: where plan limits live (spec section 9, last open item)

Verified in code, not docs:

- **Menu and Cashier** use `Restaurant.plan` (`PlanTier` BASIC/PRO/PREMIUM) plus `src/server/domain/entitlements.ts`
  (feature flags) and `PlatformSetting('plans')` (`src/server/data/plans.ts`, `PLANS_SETTING = 'plans'`). These are
  feature tiers, not numeric limits. `planCodesFor()` in `src/server/domain/billing/catalog.ts` returns `PLAN_TIERS` for them.
- **Pharmacy** uses `AppPlan` rows (`prisma/schema.prisma` model `AppPlan { applicationId, code, name Json, features Json,
  limits Json, active, sortOrder, version }`, unique `(applicationId, code)`), created by the migration
  `20261027100000_pharmacy_foundation`. Limits are parsed by `pharmacyLimitsSchema` in
  `src/server/domain/pharmacy/limits.ts` (`branches, users, storageMb, aiMonthlyBudgetMinor`; 0 = none, never
  unlimited), read through the live `pharmacy` subscription by `limitsOf()`, edited by `appPlans.upsert` /
  `appPlans.deactivate` (`src/server/studio/actions/app-plans.ts`, permission `plans.manage`) on
  `/studio/billing/plans` (`AppPlansEditor.tsx`), and sold by `sellablePlanCodes()` in `src/server/studio/services/billing.ts`.
  The pharmacy spec line 47 ("no table, entitlements.ts + PlatformSetting('plans')") describes the state *before*
  phase 0; line 129 and the code introduced `AppPlan`. That is the conflict the Retails implementer saw.
- **RETAIL uses `AppPlan` with `applicationId = 'retail'`** and a new `retailLimitsSchema`
  (`branches, users, terminals, storageMb, aiMonthly`), exactly like the pharmacy. No entitlements, no `PlatformSetting('plans')`.

## Verified facts the tasks depend on

- **Business identity.** A business is a `Restaurant` row (`id String @id @default(cuid())`, `sector BusinessSector
  @default(FOOD)`, `status RestaurantStatus` = ACTIVE | SUSPENDED | ARCHIVED, the same three values as Retails'
  snapshot `status`). **`coreBusinessId = Restaurant.id`** (a cuid, well under Retails' 128-char limit).
- **Owner.** Ownership is `Membership { userId, restaurantId, role: MemberRole (DESIGNER | OWNER), createdAt }`.
  **`coreOwnerUserId` = the `userId` of the earliest OWNER membership** whose `User.deactivatedAt` is null
  (`User.id` is Better Auth's user id). The owner does **not exist** when the business is created: `provisionPharmacy`
  only creates an `Invitation` (`createInvitation`, `src/server/studio/services/invitations.ts`), and the membership
  appears in `acceptInvitation()` (same file, `prisma.$transaction`, `tx.membership.create` / `.update` to OWNER).
  Retails' `coreStateSchema` requires `owner.coreUserId` (min 1), so **a RETAIL business cannot be provisioned until
  its owner has accepted** (Task 4: readiness).
- **Subscription.** `provisionPharmacy` does not start a subscription ("the billing screens do that"). Retails requires
  `subscription` in every snapshot, so provisioning also waits for a `retail` subscription row.
- **Session for the handoff.** `actorFromHeaders(prisma: PrismaClient, requestHeaders: Headers): Promise<Actor | null>`
  in `src/server/studio/auth/actor.ts` reads the Better Auth session from the request cookies (cookie prefix `studio`,
  host-only cookies: `advanced: { cookiePrefix: 'studio', useSecureCookies: production }` in `src/server/studio/auth/auth.ts`).
  `Actor` has `userId, email, name, isSuperAdmin, memberships: {restaurantId, role}[]`. `emailVerified` is on `User`
  (not on `Actor`): read it. Every account is made by invitation (`createPasswordUser` sets `emailVerified: true`).
- **Domains.** Production Studio is `https://studio.buzzify-menu.online` (`docs/deploy/hostinger.md`); Retails is a
  separate deployment with its own `APP_URL`. No shared cookie, no shared DB: the handoff is redirect-based
  (Retails `/api/core/v1/handoff/start` -> Studio `/api/retail/v1/handoff` -> Retails `/api/core/v1/handoff/callback?token=&state=`).
- **Host routing.** `src/proxy.ts` -> `routeHost()` in `src/server/http/hosts.ts` returns 404 on the Studio host for any
  path not in `STUDIO_SERVES`. **`/api/retail` must be added to `STUDIO_ONLY`**, or every Retails call gets a 404.
  `/api/cron/*` already passes on any host.
- **Sign-in `next`.** `safeNextPath()` (`src/studio/nav.ts`, `STUDIO_PATH = /^\/(?:studio|pos|pharmacy)(?:\/[A-Za-z0-9_-]+)*$/`)
  allows no query string, so the handoff's `return/state/nonce` cannot ride `?next=`. Task 7 parks them in a short-lived
  HttpOnly cookie and resumes at `/studio/retail/continue`.
- **No reusable outbox sender.** `CashierLinkEvent` (schema lines 1303-1320) is a cashier-only table (FK to
  `CashierLink`) and has **no server code** in `src/` (only generated client). It is not reusable; we build `RetailOutbox`.
  What *is* reusable: `canonicalRequest/signRequest/bodyHash` in `src/server/domain/link/signing.ts` produce exactly
  Retails' MAC string (`METHOD\npathWithQuery\nts\nsha256hex(body)`, HMAC-SHA256 hex); `checkRateLimit()` +
  `AuthRateLimit` (`src/server/studio/auth/rate-limit.ts`); `readBodyWithLimit()` (`src/server/http/route.ts`);
  `clientIp()` (`src/server/http/client-ip.ts`); `parseCronEnv()` + `authorized()` for cron routes
  (`src/app/api/cron/subscriptions/route.ts` is the template); `sendAfterResponse`-style `after()` with a fallback.
- **AI key.** `PlatformSetting('ai')` (`src/server/ai/settings.ts`): `{ provider?, anthropic: { key?: {enc,last4},
  askModel?, fastModel? }, openai: {...} }`, key decrypted with `decryptSecret(enc, encryptionKey())`
  (`src/server/domain/link/secret.ts`, env `AI_SETTINGS_ENCRYPTION_KEY`), env fallback `envApiKey('anthropic')`
  (`ANTHROPIC_API_KEY`). `resolveAiProvider(db, now?)` returns an `AiProvider` object, **not the key**: Task 6 adds a
  sibling `readAnthropicConfig()` reusing the private `readStored()`.
- **Sector checks are binary today.** `=== 'PHARMACY'` / `!== 'PHARMACY'` / `'FOOD'` decide behaviour in:
  `src/server/pos/actor.ts:83` (`posGate`: a RETAIL business would **open the till**), `src/server/studio/services/billing.ts:41`
  (`offeredTo`: RETAIL would be offered menu+cashier), `src/server/studio/services/restaurants.ts:288` (delete refusal),
  `src/server/studio/actions/restaurants.ts:74,88,92,259,304`, `src/studio/sector-param.ts:8`,
  `restaurants/RestaurantsTable.tsx:93,129`, `restaurants/SectorBadge.tsx:7`, `restaurants/[id]/layout.tsx:31`,
  `restaurants/new/page.tsx:19,33`, `RestaurantForm.tsx:356`. Every one is revisited in Task 2.
- **Tenant registry.** `tests/data/tenant-registry.test.ts` fails when a model with a required `restaurantId` is not in
  `RESTAURANT_SCOPED_MODELS` or `RESTAURANT_CONFINED_MODELS` (`src/server/data/tenant-db.ts`). `globalDb()` refuses
  restaurant-scoped models; the sweep and platform actions use it. So `RetailLink` and `RetailOutbox` go in
  `CROSS_RESTAURANT_MODELS` + `RESTAURANT_CONFINED_MODELS: 'restaurantId'` (like `Subscription`): served by the base
  client and `globalDb`, confined in a restaurant's scoped client.
- **Tests and DB.** `npm test` = `vitest run`, `tests/**/*.test.ts`, `fileParallelism: false`, real PostgreSQL at
  `127.0.0.1:${BUZZIFY_DB_PORT ?? 54329}` (`scripts/db-config.ts`), database `buzzify_test`, migrated by
  `tests/helpers/global-setup.ts` with `prisma migrate deploy`. Start it with `npm run db:up`. **In this worktree set
  `BUZZIFY_DB_PORT` (e.g. 54339)** so it does not share the main checkout's server. Fixtures: `tests/pharmacy/fixture.ts`
  (`resetWorld`, `person`, `pharmacy`, `GOOD`), `tests/helpers/db.ts` (`resetTestData`), actions via
  `runAction(prisma(), actor, def, input, META)`, queries via `runQuery`. `vi.mock('next/headers', ...)` at file top.
  Test files live under `tests/<area>/`; ours go in `tests/retail/`.
- **Migrations.** Prisma Migrate, hand-reviewed SQL; data rows that must exist are inserted by hand in the migration
  (see the `Application` insert at the end of `20261027100000_pharmacy_foundation/migration.sql`). No
  `shadowDatabaseUrl` in `prisma.config.ts`: `migrate dev --create-only` makes its own shadow on the embedded server; a
  second `--create-only` producing an empty migration is the no-drift check (spike doc, `2026-10-16-studio-core-2a-spike.md` line 392).
  **Deploys run `prisma migrate deploy` automatically** (`vercel-build`, `build:host` in `package.json`): merging is deploying the migration.
- **Repo rules that bind.** `AGENTS.md`: read the Next docs in `node_modules`. `CLAUDE.md`: brainstorming done (the
  spec), TDD per task, verification before completion, UI via the project's tokens. Global: commit/push only when the
  owner asks, branch first (we are on `retail-core-link`). No RLS in this repo (isolation is `tenant-db.ts`), so the
  registry test is the guard. i18n: `src/studio/messages/{en,ar,ckb}.ts` with sub-catalogs (`pharmacy/`, `ai-settings/` ...),
  key parity enforced by `tests/studio/messages.test.ts`; ar and ckb are machine-drafted and flagged for review, as the
  pharmacy did. `vercel.json` crons are pinned by `tests/server/vercel-config.test.ts` (only `/api/cron/publish`): do not
  add the retail crons there; they run from the Hostinger/external scheduler like `/api/cron/subscriptions`.

---

## Global constraints (verbatim from the contract)

- **Signed requests, both directions.** HMAC-SHA256, hex, over `METHOD\nPATH\nTIMESTAMP\nSHA256(body)` where PATH is the
  pathname plus the raw query exactly as sent and the body is the raw text (a GET signs the empty string). Headers
  `x-bz-timestamp` (unix seconds, `^\d{1,12}$`) and `x-bz-signature`. Accepted skew **±120 s**. Constant-time compare,
  every accepted secret tried without short-circuit.
- **Secrets per direction** (each ≥ 16 chars; use 32+):
  | Studio variable (new) | Same value as Retails' | Used by Studio to |
  | --- | --- | --- |
  | `RETAIL_SYNC_SECRET` | `CORE_SYNC_SECRET` | sign `POST /api/core/v1/provision`, `POST`/`GET /api/core/v1/state` |
  | `RETAIL_CALLER_SECRET` (+ optional `_PREVIOUS`) | `CORE_OUT_SECRET` | verify `ai-config`, `identities` |
  | `RETAIL_HANDOFF_SECRET` | `CORE_HANDOFF_SECRET` | sign handoff tokens |
  | `RETAIL_URL` | (Retails' `APP_URL`) | base URL for calls, handoff return allow-list; https in production |
  Retails' `CORE_BASE_URL` = Studio's public origin. Rotation: Retails sets `*_PREVIOUS` first, then Studio switches.
- **Snapshot (`state`) = Retails' `coreStateSchema`:** `{ coreBusinessId (1..128), version (int 1..2e9), status:
  "ACTIVE"|"SUSPENDED"|"ARCHIVED", plan: { code (1..64), name (1..120), maxBranches, maxTerminals, maxUsers, storageMb,
  aiMonthly } (ints 0..1e9), subscription: { status: TRIAL|ACTIVE|GRACE|EXPIRED|CANCELLED, trialEndsAt: ISO|null
  (required for TRIAL), currentPeriodStart: ISO, currentPeriodEnd: ISO (> start), graceDays 0..365 }, aiIntake: boolean,
  owner: { coreUserId (1..128), email (≤254, valid), emailVerified, name (≤200) } }`. ISO with offset (`toISOString()`).
- **Provision body = `coreProvisionInput`:** `{ coreBusinessId, name (1..120), activityType ("MARKET"|"CLOTHING"|
  "ELECTRONICS"|"BEAUTY"|"STATIONERY"|"MIXED", default MIXED), capabilities ([] default), branches: [{ name (1..80) }]
  (1..20, unique names), currencies: ["IQD"|"USD"] (1..2, unique), state }` with `state.coreBusinessId === coreBusinessId`.
  Answers `200 {businessId}` (also on repeat), `401`, `400 INVALID_INPUT`, `413`, `422 {code}` (e.g. `PLAN_LIMIT`,
  `PLAN_UNAVAILABLE`), `429`, `503`. Body cap 256 KiB.
- **State push** answers `200 {applied, version}`; older/equal version is `200 {applied:false}`; unknown business is a
  retryable **404**. **Reconcile** `GET /api/core/v1/state?coreBusinessId=` (empty body signed) answers
  `{ version, status: "SETUP"|"ACTIVE"|"SUSPENDED"|"ARCHIVED", aiUsageMonth: { month, units } }` (units are **half** units) or 404.
- **Retails rate limit:** 120 requests/minute per client address on the `sync` bucket (provision + state). Studio's
  sender and reconcile together must stay under it.
- **`GET /api/retail/v1/ai-config`** -> `200 {"apiKey": string|null, "model": string|null}`; `apiKey:null` or `404` = no key.
  Any other status is a Retails-side failure. Never log the key; error bodies carry only a code.
- **`POST /api/retail/v1/identities`** `{email, name?}` -> `200 {"coreUserId", "created", "emailVerified"}`.
  `emailVerified` true only when Studio verified that email. Must be rate-limited.
- **Handoff:** `GET /api/retail/v1/handoff?return=&state=&nonce=`. Token = `base64url(JSON(claims)) + "." +
  base64url(HMAC-SHA256(<the base64url payload string>, RETAIL_HANDOFF_SECRET))`, ≤ 4096 chars. Claims exactly:
  `aud: "retail"`, `iat` (unix s), `exp` (`exp - iat` ≤ 60, > 0), `nonce` (the query's `nonce`, **copied unchanged**),
  `jti` (unique), `coreUserId`, `email`, `emailVerified` (truthful), `name` (string), `coreBusinessId` (must be a
  business Retails has; unknown is refused as `BUSINESS`). Redirect to `${return}?token=…&state=…` (state unchanged),
  only when `return` is exactly `${RETAIL_URL}/api/core/v1/handoff/callback`.
- **Logs:** never a key, body, token, secret or signature; error class and status only.
- **Additive migrations only.** New enum value, new tables, new nullable/defaulted columns. No edit of existing migrations.
- **UI text** in en/ar/ckb with key parity. Every commit ends with `Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>`.

## Review focus (inputs logic usually forgets; each has a test)

1. **Ordering and duplicates.** Two concurrent bumps give two distinct, increasing versions; a stale snapshot never
   overwrites a newer one (Retails ignores ≤); "Resync" bumps the version so Retails cannot ignore it.
   Tests: `bump.test.ts > concurrent bumps are strictly increasing`, `sender.test.ts > resync sends a higher version`.
2. **Not ready.** No accepted owner, or no `retail` subscription: nothing is sent, no attempt is spent, the row shows
   *waiting for owner / subscription*, and the owner's acceptance or the trial start sends it at once.
   Tests: `snapshot.test.ts > waits for the owner`, `> waits for a subscription`, `hooks.test.ts > accepting the owner invitation enqueues`.
3. **Retails failing.** 5xx, 429, 401, timeout, network: backoff 1 min doubling to 1 h, `failedAt` after 20 attempts,
   visible on the page; 400/413/422 are permanent at once; state 404 makes the next attempt a provision.
   Tests: `sender.test.ts > backoff schedule`, `> permanent on 422 with its code`, `> 404 on state re-provisions`.
4. **Concurrent senders.** Two workers never deliver the same row at once (`SKIP LOCKED` + lease); an expired lease is
   re-claimed. Tests: `sender.test.ts > two claims never return the same row`, `> expired lease is reclaimed`.
5. **Hostile handoff.** `return` not exactly the allow-listed callback (other host, extra path, `//`, userinfo,
   encoded tricks), missing/oversized/odd `state` or `nonce`, no session, a deactivated user, a user who owns no RETAIL
   business, a pick cookie naming someone else's business, a business not provisioned: no token, no redirect to
   `return`. Tests: `handoff-route.test.ts` (one `it` per case).
6. **Inbound signatures.** Missing/stale(121 s)/future headers, wrong secret, tampered body, path or query: `401` before
   the body is parsed; previous secret accepted; the key never appears in a log or an error body.
   Tests: `inbound-signing.test.ts`, `ai-config-route.test.ts > never logs the key`.
7. **Identities.** Unknown email creates exactly one identity-only account (case/whitespace variants map to it,
   concurrent calls race to one), sends one set-password mail, answers `emailVerified:false`; known verified email
   answers `created:false, emailVerified:true`; deactivated user answers `emailVerified:false`; per-address and per-email
   limits answer 429. Tests: `identities-route.test.ts`.

Also (sector separation): a RETAIL business never opens the till, `/pharmacy`, menus, or the menu/cashier products.
Test: `tests/retail/sector-separation.test.ts` modelled on `tests/pharmacy/sector-separation.test.ts`.

---

### Task 1: Schema, migrations and domain constants

**Files**
- Modify `prisma/schema.prisma`: `enum BusinessSector { FOOD PHARMACY RETAIL }`; new models below; back-relations on `Restaurant`.
- Create `prisma/migrations/20261103100000_retail_sector/migration.sql` (only `ALTER TYPE "BusinessSector" ADD VALUE 'RETAIL';`,
  alone, because a new enum value cannot be used in the transaction that adds it).
- Create `prisma/migrations/20261103100100_retail_link/migration.sql` (tables, indexes, FKs, CHECKs, hand-written
  `INSERT INTO "Application" ... ('retail', '{"en": "Retail", "ar": "التجزئة", "ckb": "تاکفرۆشی"}', 'DISABLED', 4, ...) ON CONFLICT ("id") DO NOTHING`).
  Pick timestamps after the newest migration on `origin/main` at implementation time (today `20261101100200_pharmacy_return_credit`);
  re-check before merging, pharmacy phase branches add migrations too.
- Modify `src/server/domain/restaurant-profile.ts`: `BUSINESS_SECTORS = ['FOOD', 'PHARMACY', 'RETAIL'] as const`.
- Modify `src/server/domain/billing/catalog.ts`: `APPLICATION_IDS = ['menu','cashier','pharmacy','retail']`,
  `planCodesFor` returns `[]` for `pharmacy` and `retail`, `DEFAULT_APPLICATIONS` adds `{ id: 'retail', name: {...same...}, status: 'DISABLED', sortOrder: 4 }`.
- Create `src/server/domain/retail/limits.ts`.
- Modify `src/server/data/tenant-db.ts`: add `'RetailLink', 'RetailOutbox'` to `CROSS_RESTAURANT_MODELS` and to
  `RESTAURANT_CONFINED_MODELS` with `'restaurantId'`.
- Modify `tests/helpers/db.ts` (`resetTestData`: delete `retailOutbox`, `retailLink` before `restaurant`) and
  `tests/pharmacy/fixture.ts` `resetWorld` (add `{ id: 'retail', name: { en: 'Retail' } }`).
- Tests: create `tests/retail/schema.test.ts`, `tests/retail/limits.test.ts`; existing `tests/billing/schema.test.ts`
  (asserts migrated `Application` rows equal `DEFAULT_APPLICATIONS`) and `tests/data/tenant-registry.test.ts` must stay green.

**Produces**
```prisma
/// The link between a RETAIL business and its shop in Buzzify Retails (docs/superpowers/plans/2026-10-31-retail-link-part-b.md).
model RetailLink {
  restaurantId     String     @id
  /// The shop's id in Retails, from the provision answer; null until provisioned.
  retailBusinessId String?
  currencies       Currency[] @default([IQD])
  /// The per-shop AI master switch Retails applies as its `ai.intake` override.
  aiIntake         Boolean    @default(false)
  /// Grows by one in the transaction of every change that alters the snapshot. 0 = nothing to send yet.
  stateVersion     Int        @default(0)
  /// The highest version Retails answered 200 for (applied or not).
  acceptedVersion  Int        @default(0)
  /// sha256 of the last sent snapshot without its version: the reconcile's drift check.
  sentHash         String?
  provisionedAt    DateTime?
  /// What the last reconcile read from Retails (display only).
  remoteVersion    Int?
  remoteStatus     String?
  aiUsageMonth     String?
  aiUsageHalfUnits Int?
  reconciledAt     DateTime?
  createdAt        DateTime   @default(now())
  updatedAt        DateTime   @updatedAt
  restaurant       Restaurant @relation(fields: [restaurantId], references: [id], onDelete: Cascade)
  @@index([reconciledAt])
}

/// What is still to be delivered to Retails for one business: one coalescing row (the snapshot is built at send time).
model RetailOutbox {
  restaurantId  String     @id
  dueVersion    Int
  attempts      Int        @default(0)
  nextAttemptAt DateTime   @default(now())
  leasedUntil   DateTime?
  /// OWNER or SUBSCRIPTION while the business cannot be provisioned yet; no attempt is spent then.
  waitingFor    String?
  /// A code only (HTTP_503, TIMEOUT, NETWORK, PLAN_LIMIT, INVALID_INPUT ...), never a body.
  lastError     String?
  lastAttemptAt DateTime?
  failedAt      DateTime?
  createdAt     DateTime   @default(now())
  updatedAt     DateTime   @updatedAt
  restaurant    Restaurant @relation(fields: [restaurantId], references: [id], onDelete: Cascade)
  @@index([failedAt, nextAttemptAt])
}
```
Hand-written CHECKs: `"stateVersion" >= 0`, `"acceptedVersion" >= 0`, `"dueVersion" >= 1`, `"attempts" >= 0`,
`cardinality("currencies") BETWEEN 1 AND 2`.
```ts
// src/server/domain/retail/limits.ts
export const retailLimitsSchema: z.ZodObject<{ branches; users; terminals; storageMb; aiMonthly }> // ints 0..1_000_000_000 (Retails' max), 0 = none
export type RetailLimits = z.infer<typeof retailLimitsSchema>;
export const RETAIL_LIMIT_KEYS = ['branches', 'users', 'terminals', 'storageMb', 'aiMonthly'] as const;
```

**Steps**
- [ ] 1. Write `tests/retail/schema.test.ts`: `BusinessSector has RETAIL` (query `enum_range`); `the retail Application row is DISABLED with sortOrder 4`;
  `one RetailLink per restaurant` (second insert -> P2002); `deleting the restaurant removes its link and outbox row`;
  `CHECK refuses dueVersion 0` and `refuses empty currencies`. `tests/retail/limits.test.ts`: `accepts 0`, `refuses negative,
  fractions, > 1e9 and missing keys`, `ignores no extra key silently` (strict object).
- [ ] 2. Run, see them fail. Edit the schema, `npx prisma migrate dev --create-only --name retail_sector`, move the
  enum line alone into the first migration and the rest into `..._retail_link`; add the CHECKs and the Application insert by hand.
  Run `npx prisma migrate dev` on the dev DB, then `npx prisma migrate dev --create-only --name drift_check`: it must
  be empty (delete it).
- [ ] 3. Update catalog, profile, tenant-db, test helpers. `npx vitest run tests/retail tests/billing/schema.test.ts tests/data/tenant-registry.test.ts`, `npm run typecheck`.
- [ ] 4. Commit: `feat(retail): RETAIL sector, retail application and link tables`.

### Task 2: Creating a RETAIL business, and keeping sectors apart

**Files**
- Create `src/server/retail/provision.ts` (mirror of `src/server/pharmacy/provision.ts`).
- Modify `src/server/studio/actions/restaurants.ts` (`createInput`, `createRestaurant.run`, `createBranch`, `deleteBranch`).
- Modify `src/server/studio/services/restaurants.ts` (`removeRestaurant`: refuse RETAIL, new `RETAIL_NOT_DELETED`).
- Modify `src/server/pos/actor.ts:83` (`posGate`: `restaurant.sector !== 'FOOD'`).
- Modify `src/studio/sector-param.ts` (`RETAIL` accepted), `restaurants/new/page.tsx`, `RestaurantForm.tsx`
  (`RetailFields`: branches, currencies, owner email; reuse `PharmacyFields`' pieces), `RestaurantsTable.tsx`,
  `SectorBadge.tsx` (ShoppingBag icon), `restaurants/[id]/layout.tsx` (no menu tabs for RETAIL).
- Messages: `restaurants.sector.RETAIL` ("Retail shop" / "محل تجزئة"), `restaurants.form.retail*`, `RETAIL_NOT_DELETED` text in `src/studio/errors`/server text as the pharmacy's is.
- Tests: create `tests/retail/create.test.ts`, `tests/retail/sector-separation.test.ts`.

**Consumes** `createInvitation(db: AnyDb, args: NewInvitation, options?: InvitationOptions): Promise<{ invitationId: string; url: string }>`;
`provisionPharmacy(tx: ScopedTx, args: ProvisionArgs)` as the pattern (one nested `tx.restaurant.update` write, because the
platform transaction refuses top-level restaurant-scoped models); `defineAction`; `PH_CURRENCIES`.

**Produces**
```ts
// src/server/retail/provision.ts
export interface RetailBranchInput { name: string; city?: string }   // name 1..80 (Retails' cap), unique (case-insensitive)
export async function provisionRetail(tx: AnyDb, args: {
  restaurantId: string; branches: readonly RetailBranchInput[]; currencies: readonly PhCurrency[];
  ownerEmail?: string; invitedById?: string; afterCommit?: InvitationOptions['afterCommit'];
}): Promise<{ branchIds: string[]; invitationId: string | null }>
// creates branches (nested), RetailLink { currencies }, the owner invitation; enqueues nothing yet (stateVersion 0).
```
`createInput` gains `sector: 'RETAIL'`; for RETAIL `branches` are required (1..20), `name` ≤ 80 and unique, `ownerEmail`
required (a retail shop is useless without an owner: owner question 6).

**Steps**
- [ ] 1. `create.test.ts`: `a Super Admin creates a RETAIL business with two branches, IQD+USD and an owner invitation`
  (asserts `Restaurant.sector`, branches in order, `RetailLink.currencies`, `stateVersion === 0`, one `Invitation` OWNER,
  audit rows `restaurant.created` + `invitation.created`); `refuses duplicate branch names` (INVALID on `branches`);
  `refuses a branch name of 81 characters`; `refuses without an owner email`; `a non-Super-Admin cannot create` (FORBIDDEN);
  `deleting a RETAIL business is refused` (CONFLICT, `RETAIL_NOT_DELETED`); `a FOOD create is unchanged` (no RetailLink).
- [ ] 2. `sector-separation.test.ts` (copy the shape of `tests/pharmacy/sector-separation.test.ts`): `a RETAIL business has
  no till actor and posGate is closed even with a cashier subscription`; `the pharmacy actor refuses it (notPharmacy)`;
  `listMenus and posOverview do not list it`; `billing refuses menu, cashier and pharmacy for it and pharmacy refuses retail`
  (the last part passes after Task 3).
- [ ] 3. Implement. Branch create/delete for RETAIL after provisioning: refuse with `RETAIL_BRANCHES_IN_RETAILS`
  ("Branches of a retail shop are managed in Retails") because the contract has no branch sync (decision below).
- [ ] 4. `npx vitest run tests/retail tests/pharmacy/sector-separation.test.ts tests/studio/restaurants.test.ts tests/studio/messages.test.ts`, `npm run typecheck`, `npm run lint`.
- [ ] 5. Commit: `feat(retail): create retail businesses in Studio and keep sectors apart`.

### Task 3: Retail plans and billing

**Files**
- Modify `src/server/studio/services/billing.ts`: `offeredTo(sector, applicationId)` becomes an explicit map
  `{ FOOD: ['menu','cashier'], PHARMACY: ['pharmacy'], RETAIL: ['retail'] }`; `sellablePlanCodes` reads `AppPlan` for
  `pharmacy` **and** `retail`.
- Modify `src/server/studio/actions/app-plans.ts`: input gains `applicationId: z.enum(['pharmacy','retail']).default('pharmacy')`;
  `limits` is validated with `pharmacyLimitsSchema` or `retailLimitsSchema` by application (a `superRefine` or two
  discriminated objects); `deactivate` gains the same `applicationId`. On a RETAIL limits/name change, call
  `bumpRetailForPlan(tx, code)` (Task 4; wire it in Task 4 step 3 to keep this task independently testable).
- Modify `src/server/studio/queries/app-plans.ts`: `appPlansList` input `{ applicationId }` (default `pharmacy`), rows
  typed per application.
- Modify `src/server/domain/pharmacy/limits.ts` only to widen `AppPlanRow.limits` to `PharmacyLimits | RetailLimits | null` (or add `RetailAppPlanRow`).
- Modify `src/app/studio/(studio)/(app)/billing/plans/page.tsx` + `AppPlansEditor.tsx` (`LIMIT_KEYS` per application;
  a two-tab switch Pharmacy / Retail via `?app=retail`) and `src/app/studio/_actions/app-plans.ts` (unchanged signatures).
- Messages: `appPlans.app.retail`, `appPlans.limit.terminals`, `appPlans.limit.aiMonthly` ("AI reads per month" / "قراءات الذكاء الاصطناعي شهرياً").
- Tests: create `tests/retail/plans.test.ts` (mirror `tests/pharmacy/app-plans.test.ts`).

**Consumes** `appPlans.upsert` / `deactivate` (permission `plans.manage`, `updateWithVersion`), `billing.startTrial`
(`trialInput {restaurantId, applicationId, planCode, trialDays 1..60, period, currency}`), `limitRefusal`.

**Steps**
- [ ] 1. Tests: `the platform owner creates a retail plan with the five limits`; `a pharmacy-shaped limits object is refused for retail and vice versa`;
  `a Super Admin who is not the owner cannot write` (FORBIDDEN); `appPlansList({applicationId:'retail'}) lists only retail plans with subscription counts`;
  `startTrial on a RETAIL business with a retail plan succeeds`; `startTrial on a RETAIL business with 'pharmacy' or 'cashier' is WRONG_SECTOR`;
  `existing pharmacy app-plan tests are unchanged` (run `tests/pharmacy/app-plans.test.ts`).
- [ ] 2. Implement; keep `applicationId` defaulting to `pharmacy` so the existing editor calls still work.
- [ ] 3. `npx vitest run tests/retail/plans.test.ts tests/pharmacy/app-plans.test.ts tests/studio/billing.test.ts tests/studio/billing-ui.test.ts tests/studio/messages.test.ts`, typecheck, lint.
- [ ] 4. Commit: `feat(retail): retail AppPlans with branch, user, terminal, storage and AI limits`.

### Task 4: Snapshot, version bump and outbox enqueue (no network)

**Files**
- Create `src/server/retail/snapshot.ts`, `src/server/retail/outbox.ts`.
- Modify (hook points, each inside the transaction that makes the change):
  `src/server/studio/services/billing.ts` (`startTrial`, `changePlan`, `cancel`, `reactivate`, `recordPayment`: when the
  subscription's `applicationId === 'retail'`); `src/server/studio/services/billing-sweep.ts` (`sweepOne`: same, inside
  its `globalDb(prisma).$transaction`); `src/server/studio/actions/restaurants.ts` (`setRestaurantStatus`);
  `src/server/studio/services/invitations.ts` (`acceptInvitation`, when an OWNER membership is created or a designer
  is raised to OWNER on a RETAIL restaurant); `src/server/studio/services/people.ts` / `actions/people.ts`
  (`unassignMember`, `deactivateUser`, `deleteUser`, `changeUserEmail`: `bumpRetailForUser`); `src/server/studio/actions/app-plans.ts`
  (`bumpRetailForPlan`).
- Create `src/server/studio/actions/retail.ts` (`retail.setAiIntake`, `retail.resync`) and `src/app/studio/_actions/retail.ts`.
- Tests: `tests/retail/snapshot.test.ts`, `tests/retail/bump.test.ts`, `tests/retail/hooks.test.ts`.

**Consumes** `effectiveStatus`, `isLive` (`src/server/domain/billing/subscriptions.ts`); `retailLimitsSchema`; `delegates()`.

**Produces**
```ts
// src/server/retail/snapshot.ts
export type RetailState = { coreBusinessId: string; version: number; status: 'ACTIVE'|'SUSPENDED'|'ARCHIVED';
  plan: { code: string; name: string; maxBranches: number; maxTerminals: number; maxUsers: number; storageMb: number; aiMonthly: number };
  subscription: { status: 'TRIAL'|'ACTIVE'|'GRACE'|'EXPIRED'|'CANCELLED'; trialEndsAt: string|null; currentPeriodStart: string; currentPeriodEnd: string; graceDays: number };
  aiIntake: boolean; owner: { coreUserId: string; email: string; emailVerified: boolean; name: string } };
export type ProvisionBody = { coreBusinessId: string; name: string; activityType: 'MIXED'; capabilities: []; branches: { name: string }[]; currencies: ('IQD'|'USD')[]; state: RetailState };
export type Built = { ready: false; waitingFor: 'OWNER' | 'SUBSCRIPTION' } | { ready: true; state: RetailState; provision: ProvisionBody; hash: string };
/** Reads everything under a FOR SHARE lock on the RetailLink row taken first; call inside a transaction. */
export async function buildRetailState(tx: AnyDb, restaurantId: string): Promise<Built>;
export function stateHash(state: RetailState): string;  // sha256 hex of canonical JSON without `version`
```
Rules: plan = `AppPlan('retail', subscription.planCode)`; missing plan or invalid limits -> every limit 0 (the safe
reading `limitsOf` uses), `plan.name` = `name.en` falling back to the code (max 120); subscription = the live one
(TRIAL/ACTIVE/GRACE by stored status) else the newest by `createdAt`; stored `status` is sent as is (the sweep bumps on
change); owner = earliest OWNER membership with an active user, `name` trimmed to 200, `email` as stored (lower case);
`activityType` `MIXED`, `capabilities` `[]` (owner question 7); branches by `sortOrder`.
```ts
// src/server/retail/outbox.ts
/** +1 on RetailLink.stateVersion and upsert of RetailOutbox(dueVersion, attempts 0, nextAttemptAt now, failedAt/lastError/waitingFor null).
 *  Returns the new version, or null when the restaurant has no RetailLink (not RETAIL): callers can call it unconditionally. */
export async function bumpRetailState(tx: AnyDb, restaurantId: string): Promise<number | null>;
export async function bumpRetailForUser(tx: AnyDb, userId: string): Promise<void>;     // every RETAIL business the user OWNs
export async function bumpRetailForPlan(tx: AnyDb, planCode: string): Promise<void>;   // every RETAIL business with a retail subscription on the code
/** Registers the immediate first attempt after commit (Task 5 fills the sender in; until then a no-op). */
export function kickAfterCommit(afterCommit: ((fn: () => void) => void) | undefined, restaurantId: string): void;
```
The bump is `UPDATE "RetailLink" SET "stateVersion" = "stateVersion" + 1 WHERE "restaurantId" = $1 RETURNING "stateVersion"`
(row lock, so concurrent bumps serialise) followed by `INSERT ... ON CONFLICT ("restaurantId") DO UPDATE SET "dueVersion" = EXCLUDED."dueVersion", ...`.
Actions: `retail.setAiIntake { restaurantId, enabled: boolean, reason: string 3..300 }` (permission `platform.settings`,
target the restaurant, audit `retail.ai_intake_changed` with before/after and reason, bump);
`retail.resync { restaurantId }` (permission `platform.settings`, audit `retail.resync`, bump: a resync is a new version
so Retails cannot ignore it as "equal").

**Steps**
- [ ] 1. `snapshot.test.ts`: `waits for the owner` (invitation pending -> `{ready:false, waitingFor:'OWNER'}`);
  `waits for a subscription`; `builds a state that passes Retails' schema` (parse with the oracle from Task 5 step 1;
  until then with a local copy of `coreStateSchema`); `TRIAL carries trialEndsAt`; `a missing plan sends zero limits`;
  `earliest active owner wins, a deactivated earlier owner is skipped`; `hash ignores version`.
- [ ] 2. `bump.test.ts`: `concurrent bumps are strictly increasing` (10 parallel transactions -> versions 1..10, outbox
  `dueVersion` 10); `a bump on a FOOD restaurant is null and writes nothing`; `a bump clears failedAt and attempts`.
- [ ] 3. `hooks.test.ts`: one `it` per hook: `accepting the owner invitation enqueues`, `starting a retail trial enqueues`,
  `a pharmacy trial does not`, `the sweep moving a retail subscription to GRACE enqueues`, `suspending enqueues`,
  `changing a retail plan's limits enqueues every business on it`, `changing the owner's email enqueues`,
  `setAiIntake is audited with its reason and enqueues`, `resync enqueues a higher version`, `a refused (rolled back) change enqueues nothing`.
- [ ] 4. Implement; wire the hooks; keep every hook a single call after the write it follows.
- [ ] 5. `npx vitest run tests/retail tests/studio/billing.test.ts tests/billing tests/studio/invitations.test.ts tests/studio/people.test.ts`, typecheck, lint.
- [ ] 6. Commit: `feat(retail): versioned retail snapshots and the outbox`.

### Task 5: Signing, sender, cron and reconcile

**Files**
- Create `src/server/retail/config.ts`, `src/server/retail/signing.ts`, `src/server/retail/client.ts`,
  `src/server/retail/sender.ts`, `src/server/retail/reconcile.ts`.
- Create `src/app/api/cron/retail-sync/route.ts` (every minute) and `src/app/api/cron/retail-reconcile/route.ts`
  (hourly; each run reconciles at most 50 links whose `reconciledAt` is null or older than 24 h, so every shop is
  reconciled daily and the run stays under Retails' 120/min).
- Fill `kickAfterCommit` (Task 4) with the sender.
- Tests: `tests/retail/contract-oracle.ts` (helper, not a test), `tests/retail/signing.test.ts`, `tests/retail/sender.test.ts`,
  `tests/retail/reconcile.test.ts`, `tests/retail/cron-routes.test.ts` (mirror `tests/billing/cron.test.ts`).

**Consumes** `signRequest(secret, method, pathWithQuery, timestamp, body): string` and `canonicalRequest` from
`src/server/domain/link/signing.ts` (identical MAC string to Retails'); `parseCronEnv(process.env)`, `authorized(header, secret)`;
`getPrisma()`; `after` from `next/server` with the `try { after(task) } catch { void task() }` fallback of `sendAfterResponse`.

**Produces**
```ts
// config.ts — read lazily; errors name the variable, never a value
export class RetailConfigError extends Error { readonly variable: string }
export function retailConfig(): { enabled: boolean; baseUrl: string; syncSecret: string; callerSecrets: string[]; handoffSecret: string; callbackUrl: string };
// enabled = RETAIL_URL set; https required when NODE_ENV=production; secrets ≥ 16 chars; callbackUrl = `${baseUrl}/api/core/v1/handoff/callback`
// signing.ts
export const RETAIL_MAX_SKEW_SECONDS = 120;
export function signRetailRequest(method: string, pathWithQuery: string, body: string, secret: string, now?: Date): { 'x-bz-timestamp': string; 'x-bz-signature': string };
export function verifyRetailRequest(req: { method: string; pathWithQuery: string; body: string; headers: Headers }, secrets: readonly string[], now?: Date):
  { ok: true } | { ok: false; reason: 'MISSING' | 'SKEW' | 'BAD_SIGNATURE' };
// client.ts — 5 s timeout, redirect: 'error', cache: 'no-store'; never reads an error body except the 422 code
export type RetailAnswer = { kind: 'ok'; body: unknown } | { kind: 'notFound' } | { kind: 'permanent'; code: string } | { kind: 'retry'; code: string };
export interface RetailClient { provision(body: ProvisionBody): Promise<RetailAnswer>; pushState(state: RetailState): Promise<RetailAnswer>; readState(coreBusinessId: string): Promise<RetailAnswer> }
export function createHttpRetailClient(): RetailClient;
// sender.ts
export const MAX_ATTEMPTS = 20; export const LEASE_MS = 120_000;
export function nextDelayMs(attempts: number, random?: () => number): number; // min(60_000 * 2 ** (attempts - 1), 3_600_000) ± 10 %
export async function claimDue(prisma: PrismaClient, now: Date, limit: number): Promise<string[]>;
export async function deliverOne(prisma: PrismaClient, client: RetailClient, restaurantId: string, now: Date): Promise<'sent' | 'waiting' | 'retry' | 'failed' | 'gone'>;
export async function runSender(prisma: PrismaClient, client: RetailClient, now: Date, limit?: number): Promise<{ sent: number; waiting: number; retried: number; failed: number }>;
// reconcile.ts
export async function reconcileOne(prisma: PrismaClient, client: RetailClient, restaurantId: string, now: Date): Promise<'same' | 'drift' | 'reprovision' | 'error'>;
export async function runReconcile(prisma: PrismaClient, client: RetailClient, now: Date, limit?: number): Promise<{ checked: number; drifted: number; errors: number }>;
```
`claimDue` is one statement: `UPDATE "RetailOutbox" SET "leasedUntil" = $now + LEASE, "lastAttemptAt" = $now WHERE "restaurantId" IN
(SELECT "restaurantId" FROM "RetailOutbox" WHERE "failedAt" IS NULL AND "nextAttemptAt" <= $now AND ("leasedUntil" IS NULL OR "leasedUntil" < $now)
ORDER BY "nextAttemptAt" LIMIT $limit FOR UPDATE SKIP LOCKED) RETURNING "restaurantId"`.
`deliverOne`: in a short transaction build the snapshot (`buildRetailState`); not ready -> `waitingFor` set, lease
cleared, `nextAttemptAt` +1 h (a hook re-kicks it sooner), **attempts unchanged**. Ready -> outside any transaction
call `provision` when `retailBusinessId` is null, else `pushState`. Then in a transaction: on `ok` store
`retailBusinessId` + `provisionedAt` (provision), `acceptedVersion = max(acceptedVersion, sent)`, `sentHash`, and
`DELETE FROM "RetailOutbox" WHERE "restaurantId" = $1 AND "dueVersion" <= $sent` (a newer bump keeps the row);
`notFound` on state -> `retailBusinessId = null` (next attempt provisions; covers a Retails restore), retry;
`permanent` (400, 413, 422 with its code) -> `failedAt = now`, `lastError = code`; `retry` (401, 429, 5xx, timeout,
network) -> `attempts + 1`, `nextAttemptAt = now + nextDelayMs`, `failedAt` when attempts reach 20. A thrown
`RetailConfigError` -> `retry` with `lastError = 'CONFIG'`. Logs: `[retail.sync] <restaurantId> <code>` only.
`reconcileOne`: rebuild; when the hash differs from `sentHash` -> bump (catches any change without a hook, e.g. a user
renamed); `readState` -> store `remoteVersion/remoteStatus/aiUsageMonth/aiUsageHalfUnits/reconciledAt`; 404 while
`provisionedAt` is set -> `retailBusinessId = null` + bump; `remoteVersion < acceptedVersion` -> bump (Retails restored from backup).
Cron routes copy `src/app/api/cron/subscriptions/route.ts`: 503 without `CRON_SECRET`, 401 on a bad bearer, 200 JSON
counts, 500 with a generic body when the run itself fails; when `retailConfig().enabled` is false they answer
`{ disabled: true }` and do nothing.

**Steps**
- [ ] 1. Create `tests/retail/contract-oracle.ts`: a **verbatim copy** (with a header naming the Retails file and commit)
  of Retails' `mac`/`verifyRequest` (`src/server/core/signing.ts`, secrets passed in), `verifyHandoff`/`handoffNonce`
  (`src/server/core/handoff.ts`), `coreStateSchema` (`src/server/core/state.ts`) and `coreProvisionInput`
  (`src/server/admin/core-provision.ts`, enums inlined). Every Studio-side test that produces a request, a token or a
  body asserts it against the oracle. Re-copy when Retails changes them.
- [ ] 2. `signing.test.ts`: `Studio's signature verifies with Retails' verifier`; `verify accepts 120 s and refuses 121 s skew`;
  `previous caller secret accepted`; `body, path, query and method tampering fail`; `non-hex or short signature fails without throwing`;
  `config refuses http in production and a 15-char secret, naming only the variable`.
- [ ] 3. `sender.test.ts` (fake `RetailClient` recording calls): `first delivery provisions with a body Retails' coreProvisionInput accepts`;
  `later deliveries push state`; `two claims never return the same row` (two concurrent `claimDue`); `expired lease is reclaimed`;
  `backoff schedule` (1, 2, 4, 8 ... min, capped at 60 min, failed after 20); `permanent on 422 with its code`;
  `404 on state re-provisions`; `a bump during delivery keeps the row for the newer version`; `waiting spends no attempt`;
  `resync sends a higher version`; `logs carry no body, secret or signature` (spy on `console.*`).
- [ ] 4. `reconcile.test.ts`: `same version and hash does nothing`; `hash drift bumps`; `remote behind bumps`; `404 re-provisions`;
  `stores usage for display`; `processes at most 50 and the oldest first`.
- [ ] 5. `cron-routes.test.ts`: `503 without CRON_SECRET`, `401 on a wrong bearer`, `disabled without RETAIL_URL`, `runs and returns counts`.
- [ ] 6. Implement; read `node_modules/next/dist/docs` on `after` and Route Handlers first.
- [ ] 7. `npx vitest run tests/retail`, typecheck, lint. Commit: `feat(retail): signed delivery to Retails with retries, leases and reconcile`.

### Task 6: Endpoints Retails calls: `ai-config` and `identities`

**Files**
- Modify `src/server/http/hosts.ts`: add `'/api/retail'` to `STUDIO_ONLY`. Test in `tests/http/hosts.test.ts`.
- Create `src/server/retail/inbound.ts` (shared: body cap 16 KiB via `readBodyWithLimit`, `verifyRetailRequest` with
  `retailConfig().callerSecrets` over `url.pathname + url.search`, per-address `checkRateLimit`, JSON helpers with
  `Cache-Control: no-store`, `X-Content-Type-Options: nosniff`).
- Create `src/app/api/retail/v1/ai-config/route.ts` (GET), `src/app/api/retail/v1/identities/route.ts` (POST).
- Modify `src/server/ai/settings.ts`: add `readAnthropicConfig`.
- Create `src/server/retail/identities.ts`.
- Modify `src/server/studio/auth/rate-limit.ts` `RATE_RULES`: `'retail:ip': { max: 120, windowSec: 60 }`,
  `'retail-identity:ip': { max: 30, windowSec: 600 }`, `'retail-identity:email': { max: 5, windowSec: 3600 }`.
- Modify `prisma/schema.prisma` + migration `20261103100200_user_identity_only`: `User.identityOnly Boolean @default(false)`
  (set for accounts Retails asked for; cleared by `acceptInvitation`). Modify the Studio `(app)` layout (or `landingPath`)
  so an `identityOnly` actor with no memberships sees one page "This account is for Buzzify Retail" with a link to
  `RETAIL_URL`, not the designer working areas `visibleNav` gives a member-less non-admin today.
- Modify `src/server/studio/auth/auth.ts` `onPasswordReset`: set `emailVerified = true` when it was false (the reset
  link proves the address). Verify first that Better Auth 1.7.10's reset creates the `credential` account for a user
  that has none (read `node_modules/better-auth`); if it does not, link it in the hook with `ctx.internalAdapter.linkAccount`.
- Modify `src/server/email/templates.ts` (+ the three language texts): template `retailIdentity` ("Set your password to
  sign in to Buzzify Retail" / "عيّن كلمة المرور للدخول إلى Buzzify للتجزئة").
- Tests: `tests/retail/inbound-signing.test.ts`, `tests/retail/ai-config-route.test.ts`, `tests/retail/identities-route.test.ts`.

**Consumes** `readStored` (private, same file), `decryptSecret(enc, key)`, `encryptionKey()`, `envApiKey('anthropic')`;
`normalizeEmail(raw)`; `authFor(prisma)` -> `(await auth.$context).internalAdapter.createUser(data, { method: 'admin' })`
(as `createPasswordUser` does); `auth.api.requestPasswordReset({ body: { email } })` (as `session.requestPasswordReset`
does; its mail is the `reset` template, so pass a flag or send `retailIdentity` from `sendResetPassword` when
`user.identityOnly`); `checkRateLimit(prisma, key, rule, now)`; `clientIp(headers)`.

**Produces**
```ts
// src/server/ai/settings.ts
/** The Anthropic key and model Retails should use: the saved Anthropic key (whatever provider the Studio itself runs), else
 *  ANTHROPIC_API_KEY; model = anthropic.askModel or null. Never logs; a decrypt failure reads as no saved key. */
export async function readAnthropicConfig(db: AnyDb): Promise<{ apiKey: string | null; model: string | null }>;
// src/server/retail/identities.ts
export const identityInput: z.ZodObject<{ email: z.ZodString /* trim, ≤254, email */; name: z.ZodOptional<z.ZodString> /* trim, ≤120 */ }>;
export async function ensureIdentity(prisma: PrismaClient, input: { email: string; name?: string }, now: Date):
  Promise<{ coreUserId: string; created: boolean; emailVerified: boolean }>;
```
`ensureIdentity`: lookup by `normalizeEmail`; found -> `{ coreUserId: id, created: false, emailVerified: user.emailVerified && !user.deactivatedAt }`;
not found -> create (`emailVerified: false`, `identityOnly: true`, `locale: 'en'`, name = input name or the email's local
part), on P2002 re-read and answer `created:false`; then request the set-password mail after the response. Answers
`emailVerified:false` for a new account (contract: Retails then fails the add with `USER_NOT_FOUND` until the person
has set a password; the owner retries the add).
Routes: verify signature (401) -> `retail:ip` limit (429) -> parse (400) -> work; `ai-config` 200 with the two fields
(or 503 `{code:'UNAVAILABLE'}` when the link is disabled); `identities` additionally limits per email (429) before any write.

**Steps**
- [ ] 1. `inbound-signing.test.ts`: `a request signed by Retails' own signer (oracle) passes`; `missing headers 401`;
  `121 s old 401`; `tampered query 401`; `body is not parsed before the signature` (malformed JSON + bad signature -> 401, not 400);
  `/api/retail/v1/* is served on the Studio host and 404 on the menu host` (hosts test).
- [ ] 2. `ai-config-route.test.ts`: `returns the saved Anthropic key and askModel`; `returns the env key when none is saved`;
  `returns null when there is none`; `returns the Anthropic key even when the Studio runs OpenAI`; `a wrong encryption key reads as no saved key`;
  `never logs the key` (spy `console.*`, assert the key string never appears); `response has no-store`.
- [ ] 3. `identities-route.test.ts`: the seven cases of review focus 7, plus `a Super Admin's email answers emailVerified true and creates nothing`,
  `an identity-only account sees the Retail page, not the working areas`, `resetting the password marks the email verified`,
  `accepting a Studio invitation clears identityOnly`.
- [ ] 4. Implement. `npx vitest run tests/retail tests/http/hosts.test.ts tests/studio/session.test.ts tests/studio/invitations.test.ts tests/studio/nav.test.ts`, typecheck, lint.
- [ ] 5. Commit: `feat(retail): ai-config and identities endpoints for Retails`.

### Task 7: Sign-in handoff and "Open Retails"

**Files**
- Create `src/server/retail/handoff.ts`.
- Create `src/app/api/retail/v1/handoff/route.ts` (GET).
- Create `src/app/studio/retail/continue/route.ts` (GET; resumes after sign-in), `src/app/studio/retail/open/[restaurantId]/route.ts`
  (GET; the button's target), and the page `src/app/studio/(studio)/(app)/retail/choose/page.tsx` (an owner of several
  retail shops picks one). Confirm the specific routes win over the `(studio)/[...rest]` catch-all (Next docs, routing).
- Tests: `tests/retail/handoff.test.ts` (pure), `tests/retail/handoff-route.test.ts`.

**Consumes** `actorFromHeaders(prisma, headers)`; `getPrisma()`; `retailConfig()`; `SIGN_IN_PATH` (`/studio/sign-in`)
and `safeNextPath` (accepts `/studio/retail/continue`); Retails' `HandoffClaims` and `handoffNonce` via the oracle.

**Produces**
```ts
export type HandoffClaims = { aud: 'retail'; iat: number; exp: number; nonce: string; jti: string; coreUserId: string;
  email: string; emailVerified: boolean; name: string; coreBusinessId: string };
export const HANDOFF_TTL_SECONDS = 60;
export const RESUME_COOKIE = 'studio_retail_resume'; // HttpOnly, SameSite=Lax, Secure in prod, Path=/, Max-Age 600: base64url(JSON {state, nonce})
export const PICK_COOKIE = 'studio_retail_pick';     // HttpOnly, SameSite=Lax, Secure in prod, Path=/, Max-Age 600: restaurantId
export function signHandoff(claims: HandoffClaims, secret: string): string; // base64url(JSON).base64url(HMAC(payloadB64))
export function checkReturn(raw: string | null, callbackUrl: string): boolean; // exact string equality after trimming nothing
export function checkStateAndNonce(state: string | null, nonce: string | null): boolean; // base64url, state 16..256, nonce 43 chars
export type Choice = { kind: 'business'; restaurantId: string } | { kind: 'choose' } | { kind: 'none' } | { kind: 'notReady'; restaurantId: string };
export async function chooseBusiness(prisma: PrismaClient, actor: Actor, pick: string | null): Promise<Choice>;
export async function issueHandoff(prisma: PrismaClient, actor: Actor, restaurantId: string, nonce: string, now: Date): Promise<string>;
```
Route flow: link disabled -> 404. `checkReturn` false or bad state/nonce -> 400 plain page, **never** a redirect.
`retail:ip` limit. No session (`actorFromHeaders` null) -> set `RESUME_COOKIE`, 302 `/studio/sign-in?next=/studio/retail/continue`.
`chooseBusiness`: the pick cookie when the actor holds an OWNER membership of that RETAIL restaurant; else the actor's
RETAIL OWNER memberships: one -> it, several -> 302 `/studio/retail/choose`, none -> `none`; the chosen business must
have `RetailLink.retailBusinessId` (else `notReady` page "Your shop is being prepared"). `none` -> see owner question 1
(staff); until decided, a page "Ask your shop owner to add you in Retails, then sign in from Retails" with no token.
`issueHandoff`: re-reads `User` (`emailVerified`, `deactivatedAt` -> refuse), `iat = floor(now/1000)`, `exp = iat + 60`,
`jti = randomUUID()`, `name = user.name.slice(0, 200)`. 302 to `${callbackUrl}?token=…&state=…` with
`Cache-Control: no-store`, `Referrer-Policy: no-referrer`, both cookies cleared. `/studio/retail/continue` reads the
resume cookie and 302s to `/api/retail/v1/handoff` rebuilt from `callbackUrl` + stored state/nonce.
`/studio/retail/open/[restaurantId]`: signed-in OWNER of that RETAIL restaurant only (else 404); sets `PICK_COOKIE`;
302 `${RETAIL_URL}/api/core/v1/handoff/start` (Retails makes the state and comes back).

**Steps**
- [ ] 1. `handoff.test.ts`: `a token Studio signs passes Retails' verifyHandoff (oracle)`; `nonce is copied byte for byte`;
  `exp - iat is 60`; `checkReturn refuses another host, a longer path, a query, //host, userinfo, http in production, case changes`.
- [ ] 2. `handoff-route.test.ts`: `signed-in owner of one provisioned shop is redirected to the callback with a valid token`;
  `no session parks the request and resumes after sign-in`; `owner of two shops goes to the chooser, the pick cookie selects`;
  `a pick cookie for someone else's shop is ignored`; `not provisioned shows the preparing page`; `deactivated user gets no token`;
  `emailVerified false is sent as false`; `bad return is 400 and not a redirect`; `oversized state is 400`; `rate limited is 429`.
- [ ] 3. Implement; read the Next docs on Route Handlers, `cookies()`, redirects first.
- [ ] 4. `npx vitest run tests/retail`, typecheck, lint. Commit: `feat(retail): sign-in handoff to Retails and Open Retails`.

### Task 8: Studio screens

**Files**
- Modify `src/studio/nav.ts`: `NavKey` + `'retail'`, `NavIcon` + `'retail'`, `NAV_ITEMS` entry `{ key: 'retail', href: '/studio/retail', labelKey: 'nav.retail', icon: 'retail' }`
  after `pharmacies`, add to `SUPER_ADMIN_AREAS`. `src/studio/shell/Sidebar.tsx` icon map `retail: ShoppingBag`.
- Create `src/server/studio/queries/retail.ts` (`retail.list`, `retail.detail`, permission `platform.settings`, mirror `listPharmacies`).
- Create `src/app/studio/(studio)/(app)/retail/page.tsx` (list: name, branches, status, retail subscription, sync state
  [synced vN / waiting for owner / waiting for subscription / retrying (attempts, next) / failed (code)], filter "Failed only", "New retail shop" -> `/studio/restaurants/new?sector=RETAIL`).
- Create `src/app/studio/(studio)/(app)/restaurants/[id]/retail/page.tsx` + `RetailPanel.tsx`: Studio version, accepted
  version, Retails version and status from the last reconcile, last error code, attempts, next attempt, AI reads this
  month (half units / 2), the AI switch with a required reason (`retail.setAiIntake`), Resync (`retail.resync`), and for
  an OWNER an "Open Retails" link to `/studio/retail/open/[id]`. Tab added in `[id]/layout.tsx` when `sector === 'RETAIL'`.
- Messages: `src/studio/messages/retail/{en,ar,ckb}.ts` spread into the three catalogs (as `pharmacy/` is). Keys include
  `nav.retail` ("Retail" / "التجزئة"), `retail.title`, `retail.new` ("New retail shop" / "محل تجزئة جديد"),
  `retail.sync.synced` ("Synced, version {version}" / "متزامن، النسخة {version}"), `retail.sync.waitingOwner`
  ("Waiting for the owner to accept the invitation" / "بانتظار قبول المالك للدعوة"), `retail.sync.waitingSubscription`
  ("Waiting for a Retail subscription" / "بانتظار اشتراك التجزئة"), `retail.sync.retrying`, `retail.sync.failed`
  ("Not delivered: {code}" / "لم يصل: {code}"), `retail.resync` ("Resync" / "أعد المزامنة"), `retail.ai.label`
  ("AI receipt reading" / "قراءة الفواتير بالذكاء الاصطناعي"), `retail.ai.reason`, `retail.open` ("Open Retails" / "افتح التجزئة"),
  `retail.preparing`, `retail.askOwner`, `retail.identityOnly`. ckb machine-drafted, flagged.
- Tests: `tests/retail/screens.test.ts` (queries and the pure view helpers, as `tests/pharmacy/studio-pharmacies.test.ts`),
  `tests/studio/nav.test.ts` (new item for Super Admins only), `tests/studio/messages.test.ts` (parity), and one e2e
  `tests/e2e/studio-retail.spec.ts` at 375 px: a Super Admin opens Retail, sees a failed row, presses Resync, sees "retrying".

**Steps**
- [ ] 1. Tests first: `retail.list returns sync states for each case`; `retail.detail refuses an owner of another business`;
  `nav shows Retail to Super Admins only`; `the AI switch needs a reason`; messages parity.
- [ ] 2. Build with the project's tokens and components (`PageHeader`, `StatusBadge`, `EmptyState`, `Alert`, `Switch`,
  `RouteTabs`); follow `pharmacies/page.tsx` and `billing/plans/AppPlansEditor.tsx`. Load `impeccable` / `21st-ui-build` only
  if the owner asks for new visuals; otherwise mirror the pharmacy screens.
- [ ] 3. `npx vitest run tests/retail tests/studio/nav.test.ts tests/studio/messages.test.ts`, typecheck, lint, then
  `npx playwright test tests/e2e/studio-retail.spec.ts` (needs `npm run db:up`, `npm run db:seed`, see `playwright.config.ts`).
- [ ] 4. Commit: `feat(retail): Retail section, sync status, AI switch and Resync in Studio`.

### Task 9: Environment, docs and end-to-end acceptance

**Files**
- Modify `src/server/env.ts` `checkProductionEnv`: when `RETAIL_URL` is set, require https and the three secrets
  (≥ 16, recommend 32), and that they differ from each other and from `CRON_SECRET`/`BETTER_AUTH_SECRET`; unset = link off, no problem reported.
  Test in `tests/server/production-env.test.ts`.
- Modify `.env.example` (commented `RETAIL_URL`, `RETAIL_SYNC_SECRET`, `RETAIL_CALLER_SECRET`, `RETAIL_CALLER_SECRET_PREVIOUS`, `RETAIL_HANDOFF_SECRET`).
- Modify `docs/deploy/hostinger.md` and `docs/deploy/production.md`: the variables and their Retails twins, the two cron
  jobs (`/api/cron/retail-sync` every minute, `/api/cron/retail-reconcile` hourly, same `CRON_SECRET` bearer), rotation
  order, "keep query strings of `/api/retail/v1/handoff` out of access logs", and that deploying runs the migrations.
- Create `docs/retail/README.md` only if the owner wants a runbook (owner question); otherwise the deploy docs suffice.
- Tests: `tests/retail/acceptance.test.ts`: a **fake Retails** HTTP server started in the test (node `http`, random port,
  `RETAIL_URL` stubbed) that verifies every request with the oracle and keeps state like Retails (ignore ≤ version, 404
  before provision): create RETAIL shop -> nothing sent (waiting owner) -> owner accepts -> still waiting (subscription) ->
  trial started -> provision received and valid -> plan limit change -> state v+1 -> suspend -> SUSPENDED received ->
  fake goes down (503) -> retries with backoff -> fake back -> delivered -> Resync -> higher version -> reconcile with
  the fake "restored" to an older version -> re-pushed -> handoff for the owner verifies with the oracle and carries the
  nonce -> `ai-config` and `identities` signed by the oracle answer per contract.

**Steps**
- [ ] 1. Write the acceptance test; run; fix what it finds.
- [ ] 2. Full run: `npm run lint && npm run typecheck && npm test`; `npx prisma migrate dev --create-only --name drift_check`
  is empty (delete it); `npx playwright test tests/e2e/studio-retail.spec.ts`.
- [ ] 3. Cross-repo smoke (manual, local): run Retails (`buzzify-retails`, its README) with `CORE_BASE_URL=http://localhost:3100`
  and the twin secrets, run Studio with `RETAIL_URL` at Retails, create a shop end to end, sign in through "Open Retails".
- [ ] 4. Commit: `test(retail): Studio-Retails acceptance and deployment notes`. Do not merge or deploy: merging runs
  `prisma migrate deploy` in production (owner approval and a fresh backup first).

---

## Decisions I made / questions for the owner

**Decisions (change them if you disagree)**
1. `coreBusinessId` is `Restaurant.id`; `coreOwnerUserId` is the earliest active OWNER member. Other owners in Studio
   are not sent; in Retails they get roles by invitation (spec 9).
2. Plan limits live in `AppPlan('retail')`, like the pharmacy; the existing plan editor gets a Retail tab.
3. One coalescing outbox row per business, snapshot built at send time (instead of one stored row per version). It
   never sends stale content, cannot grow without bound, and still gives per-business monotonic versions.
4. Provisioning waits until the owner has accepted and a `retail` subscription exists, because Retails' snapshot
   requires both; the Retail page says which one is missing.
5. Branches are sent once, at provisioning. Afterwards Studio's branch tab is read-only for RETAIL: the contract has no branch sync.
6. Resync bumps the version (a re-send of the same version would be ignored by Retails).
7. Sync status, Resync and the AI switch need `platform.settings` (every Super Admin), with an audited reason for the switch.
8. Retails gets the **Anthropic** key even when Studio itself runs OpenAI, with the Studio's env key as fallback, and
   the Anthropic `askModel` as `model`.
9. Identity-only accounts (`User.identityOnly`) for staff Studio never knew, so they do not see Studio's working areas.
10. New secret names on the Studio side are `RETAIL_*` (not `CORE_*`, which would read as Studio's own); a table maps each to its Retails twin.
11. Retail crons run from the Hostinger scheduler like the subscription sweep (`vercel.json` stays as is).

**Questions only you can answer**
1. **Staff sign-in (blocker).** Retails refuses a handoff whose `coreBusinessId` it does not have, and a Retails staff
   member usually has no Studio membership, so Studio cannot know which shop to name. Approve a one-line Part A
   amendment in Retails (accept `coreBusinessId: ""` for a non-owner: skip the business lookup and the OWNER grant)? Without it, linked staff cannot sign in at all (they have no local password).
2. Retail plans: codes, names (en/ar/ckb), the five limits, prices (IQD/USD, monthly/yearly) and trial length.
3. Who may create retail shops (today `restaurant.create` = every Super Admin) and who may flip the AI switch (every Super Admin, or only the platform owner)?
4. Should creating a retail shop start its trial at once (one step fewer, shop live as soon as the owner accepts) or stay like the pharmacy (billing screen)?
5. Staff with no Studio account: Studio creates an identity-only account and mails "set your password"; the owner
   retries the add after that. Is that flow and the mail wording acceptable?
6. Owner email required when creating a retail shop (the pharmacy has it optional)?
7. Ask the shop type (`activityType`: market, clothing, electronics, beauty, stationery, mixed) and capabilities in the create form, or default to MIXED and let the owner set them in Retails?
8. When to switch the `retail` product on (it starts DISABLED, like the pharmacy)?
9. Retails' production address (`RETAIL_URL`) and who generates and stores the three shared secrets.
10. Super Admins do not get "Open Retails" (Retails has its own admin). Agree?
11. Merging deploys the migrations (`ALTER TYPE ... ADD VALUE 'RETAIL'` cannot be undone): approve the merge window and take a backup first.
