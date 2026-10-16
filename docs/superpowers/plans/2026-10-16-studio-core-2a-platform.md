# Studio Core 2a (Platform) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Buzzify staff and invited owners sign in to a three-language Studio that manages restaurants and menus, and every public menu is served from an immutable published revision at a permanent URL.

**Architecture:** Today's `Restaurant` becomes `Menu`; a new `Restaurant` (client business) sits above it. Draft tables stay editable; publishing freezes the menu into a `MenuRevision` snapshot that the public site and the pricing APIs read, with availability laid over it live. The Studio lives at `/studio` in the same Next.js app; every Studio read and write passes through one permission-checking framework that writes the audit log.

**Tech Stack:** Next.js 16.4 (App Router, `proxy.ts`), React 19, TypeScript 5.9, Prisma 7 on PostgreSQL (embedded locally, Neon in production), Better Auth 1.7, Resend, Zod 4, Tailwind 4, Radix UI, cmdk, TanStack Table, Vitest 5, Playwright 1.64.

**Spec:** `docs/superpowers/specs/2026-10-16-studio-core-design.md` (milestone 2a in section 17). Read both documents before starting a task.

## Global Constraints

- Node.js 22.19 or newer. Every dependency is pinned to an exact version in `package.json` (no `^`).
- Before using any Next.js API, read its page under `node_modules/next/dist/docs/` (`AGENTS.md`). Next 16 renamed middleware to `proxy.ts`; `revalidateTag` takes two arguments; `updateTag` works only in Server Actions.
- Raw SQL is banned in application code by lint. Migration SQL files may contain SQL.
- Money is integer minor units. Currency per menu.
- Locales are `en`, `ar`, `ckb`; `ar` and `ckb` are right-to-left. Use logical CSS properties only.
- Arabic and Sorani strings are machine-drafted and must be flagged for native review (README and message file headers).
- Studio code (`src/studio`, `src/server/studio`, `src/app/studio`) is never imported by public menu routes (`src/app/[tenant]`, `src/ui`).
- No secret is committed. `.env.example` holds placeholders only. Development-only credentials (seeded users) come from `.env`.
- Slugs: lowercase Latin letters, digits and single hyphens, 3 to 48 characters, unique across the platform including tombstones. Reserved: `studio`, `api`, `admin`, `www`, `menu`, `media`, `app`, `help`, `login`, `assets`, `static`, `_next`, plus the platform setting.
- Passwords: at least 12 characters and not in the common-password list. Invitations valid 7 days. Reset links valid 1 hour. Sessions 30 days sliding. Session cookie host-only, `Secure` in production, `HttpOnly`, `SameSite=Lax`.
- Super Admins must enable an authenticator app (TOTP) before using the Studio; ten single-use recovery codes.
- Every Studio server action and route handler goes through the framework in Task 8; every Studio page loads data through `query()`.
- Commit after every task. Commit messages end with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`. Nothing is pushed unless the user asks; the repository is public.
- Database tests run against the embedded PostgreSQL (`npm run db:up` first).

## Spec refinements

Decisions made while planning; each is a narrower or more concrete reading of the spec. Tell the user about them at handoff.

1. **Studio URLs keep the `/studio` prefix on every host.** On `studio.buzzify.me`, `/` redirects to `/studio` and only `/studio`, `/api/auth`, `/api/studio` and `/_next` are served. No rewriting, so links, redirects and Server Actions behave identically in development and production. (Spec 4.2 said "rewritten".)
2. **The 1,000-menu load seed and the 300 ms list test move to 2a**, because All Menus and Restaurants are built in 2a.
3. **Rollback, restore to draft and scheduling ship with the Revisions tab in 2b.** 2a publishes and shows the live revision. The snapshot-to-draft writer is built in 2a (duplicate uses it) and reused by 2b's restore.
4. **The palette contrast publish rule moves to 2b** with the brand kit.
5. **"Hidden" needs a field.** `Product.isHidden` (live) hides a product without a publish; `isAvailable` stays "sold out".
6. **Client IDs** are derived from an autoincrement `Restaurant.clientNumber`: `BZ-` plus the number padded to 4 digits.
7. **Unpublished changes** is `Menu.draftHash` ≠ `Menu.liveHash`, both stored and compared with a Prisma field reference.
8. **A restaurant's suspension or archiving applies at read time.** Its menus keep their own status; the public page is unavailable while the restaurant is not `ACTIVE`.
9. **Publishing a suspended menu** creates a revision and keeps it suspended. Archived menus cannot be published.
10. **Email change** uses Better Auth's flow: the old address confirms, then the new address verifies. A Super Admin can change a user's email directly from People.
11. **Sign-in, two-factor, reset and invitation flows run as Server Actions** that call `auth.api.*`. They are rate limited by the Studio's own Postgres limiter; Better Auth's database limiter covers its HTTP endpoints. Public sign-up is disabled.
12. **The Studio has a light theme only** in 2a.
13. **A price of 0 blocks publishing** (`NO_PRICE`).
14. **A duplicated menu starts with everything available** (no sold-out, hidden or stock state is copied).
15. **`RestaurantDomain` becomes `MenuDomain`** (a custom domain points at one menu).
16. **SEO editing and generated social preview images ship with the Settings tab in 2b.** 2a emits canonical URLs, `hreflang` alternates and `noindex` for unavailable menus, and uses SEO text already stored on the menu.

## Review Focus

Inputs the spec implies but no feature test would naturally hit. Each line has a test in the named task.

1. **Typed slugs with uppercase, spaces, accents or Arabic script** ("Café Mazo", "مازو") must produce a clear error or a valid suggestion, never a broken URL. (Task 4)
2. **Publish clicked twice, or two people publishing the same menu at once,** must produce consecutive revision numbers with no duplicate and no lost revision. (Task 3)
3. **An invitation link opened while signed in as a different user** must refuse to attach the membership to the wrong account and say so. (Task 10)
4. **Email addresses with uppercase letters or surrounding spaces** at invitation, sign-in and reset must reach the same account. (Task 9)
5. **Arabic-script search text in All Menus and Jump to** (a restaurant named "مطعم مازو", searched as "مازو") must find the restaurant. (Task 13)

## File structure

```
prisma/schema.prisma                       models (Tasks 1, 7, 9, 11)
prisma/seed.ts                             demo seed: restaurants, menus, publish, dev users
prisma/seed/apply.ts                       seedMenu(): draft rows for one menu
prisma/seed/atelier.ts                     ATELIER data, plus its restaurant profile
prisma/seed/users.ts                       development users
prisma/seed-load.ts                        1,000-menu load seed
scripts/create-admin.ts                    first Super Admin, interactive
src/proxy.ts                               host routing (routeHost in src/server/http/hosts.ts)
src/server/env.ts                          environment parsing
src/server/domain/types.ts                 Catalog.menuId (renamed)
src/server/domain/snapshot.ts              MenuSnapshot, buildSnapshot, snapshotHash, parseSnapshot, toCatalog
src/server/domain/publish-rules.ts         validateForPublish
src/server/domain/slug.ts                  slug rules
src/server/domain/menu-status.ts           status transitions
src/server/domain/permissions.ts           keys, defaults, policies, resolver
src/server/domain/locale-negotiation.ts    pickLocale
src/server/data/tenant-db.ts               menuDb, restaurantDb, scopedClient, registries
src/server/data/catalog-loader.ts          loadDraftCatalog (draft tables to Catalog)
src/server/data/public-menu.ts             resolvePublicMenu, getTenant, getCatalog (live revision + overlay)
src/server/data/live.ts                    loadOverlay
src/server/data/cache.ts                   cached, expireMenu, expireLive
src/server/publish/draft.ts                loadDraftSnapshot, writeDraftFromSnapshot, refreshDraftHash
src/server/publish/publish.ts              publishMenu
src/server/email/                          send.ts (adapter), templates.ts
src/server/studio/auth/                    auth.ts, users.ts, password-policy.ts, common-passwords.txt, rate-limit.ts, actor.ts
src/server/studio/framework/               result.ts, action.ts, query.ts, invoke.ts, concurrency.ts
src/server/studio/services/                restaurants, menus, invitations, people, settings, overview, activity, search
src/server/studio/actions/                 action definitions (defineAction) per area
src/server/studio/queries/                 query definitions (defineQuery) per area
src/app/api/auth/[...all]/route.ts         Better Auth handler
src/app/studio/                            layout, (auth) and (app) route groups, _actions/ (the only 'use server' files)
src/studio/                                ui/ components, messages/, fonts.ts, studio.css, nav.ts
tests/                                     unit, data, studio, e2e, load
docs/deploy/production.md                  setup for Vercel, Neon, Resend, DNS
```

---

### Task 0: Spike: Better Auth, Prisma 7 and trigram search

Research only. The output is a findings file and pinned dependencies; spike code is deleted.

**Files:**
- Create: `docs/superpowers/plans/2026-10-16-studio-core-2a-spike.md`
- Modify: `package.json` (add pinned `better-auth@1.7.10`)

- [ ] **Step 1:** Install `better-auth@1.7.10` (exact). In a throwaway file, configure `betterAuth` with `prismaAdapter(getPrisma(), { provider: 'postgresql' })`, `emailAndPassword: { enabled: true, disableSignUp: true, minPasswordLength: 12 }`, the `twoFactor({ issuer: 'Buzzify Studio', backupCodeOptions: { amount: 10 } })` plugin, `nextCookies()`, and `rateLimit: { enabled: true, storage: 'database' }`.
- [ ] **Step 2:** Run `npx auth@latest generate` against that config to print the Prisma models Better Auth needs (`User`, `Session`, `Account`, `Verification`, `TwoFactor`, `RateLimit`, with `user.twoFactorEnabled`). Record them verbatim in the findings file.
- [ ] **Step 3:** Find in `node_modules/better-auth/dist` how to create a user with a password from server code while sign-up is disabled. Check in this order and record the first that works in a scratch Vitest test against the test database: (a) `(await auth.$context).internalAdapter.createUser(...)` plus `internalAdapter.linkAccount({ providerId: 'credential', accountId: user.id, userId: user.id, password: await ctx.password.hash(pw) })`; (b) the admin plugin's `auth.api.createUser` called server-side. Then confirm `auth.api.signInEmail` succeeds with that password and that `POST /api/auth/sign-up/email` is rejected.
- [ ] **Step 4:** Confirm with the same scratch test that `auth.api.enableTwoFactor({ body: { password }, headers })` returns `totpURI` and ten `backupCodes`, that `auth.api.verifyTOTP` completes enrolment, and that a later `signInEmail` returns `twoFactorRedirect: true`. Record how headers and cookies must be passed in tests (outside Next).
- [ ] **Step 5:** On the embedded database, run `CREATE EXTENSION IF NOT EXISTS pg_trgm` and a Prisma schema index `@@index([name(ops: raw("gin_trgm_ops"))], type: Gin)`; run `prisma migrate dev --create-only` twice and record whether the second run reports drift. If `pg_trgm` is unavailable or drifts, record the fallback: plain B-tree indexes (1,000 rows does not need trigram).
- [ ] **Step 6:** Delete the scratch files. Commit the findings file and `package.json`/`package-lock.json`.

```bash
git add docs/superpowers/plans/2026-10-16-studio-core-2a-spike.md package.json package-lock.json
git commit -m "docs: Studio Core 2a spike findings (Better Auth, Prisma 7, pg_trgm)"
```

Later tasks use the mechanism recorded here wherever they say "per the spike".

---

### Task 1: Split Restaurant into Restaurant and Menu

**Files:**
- Modify: `prisma/schema.prisma`, `src/server/data/tenant-db.ts`, `src/server/domain/types.ts` and every file that reads `restaurantId` or `prisma.restaurant` (`src/server/domain/*.ts`, `src/server/data/*.ts`, `src/app/[tenant]/**`, `src/app/api/[tenant]/**`), `prisma/seed.ts`, `prisma/seed/apply.ts`, `prisma/seed/atelier.ts`, `prisma/seed/validate.ts`, `tests/helpers/db.ts`, all tests that use them
- Create: migration `prisma/migrations/<timestamp>_restaurant_menu_split/`
- Test: `tests/data/tenant-registry.test.ts`, `tests/data/tenant-db.test.ts`

**Interfaces:**
- Produces:
  - Prisma models `Restaurant`, `Branch`, `Menu`, `MenuSlug`, `MenuRevision`, `MenuDomain`; catalog models keyed by `menuId`.
  - `menuDb(prisma: PrismaClient, menuId: string)`, `restaurantDb(prisma: PrismaClient, restaurantId: string)`, `scopedClient(prisma, scope: { menuId?: string; restaurantId?: string })`, types `MenuDb`, `ScopedClient`, and `ScopedTx` (the transaction client of a `ScopedClient`, i.e. the parameter type of `scopedClient(...).$transaction(fn)`'s callback).
  - Registries `MENU_SCOPED_MODELS`, `RESTAURANT_SCOPED_MODELS`, `UNSCOPED_LOOKUP_MODELS`, `CROSS_RESTAURANT_MODELS` (global models that reference a restaurant by design because they are queried across restaurants; empty now, `Membership` joins in Task 7), `GLOBAL_MODELS`.
  - `Catalog.menuId` replaces `Catalog.restaurantId`.
  - `seedMenu(prisma, data: SeedData, restaurantId: string): Promise<{ menuId: string }>`.
  - Test helper `createMenuFixture(prisma, slug: string): Promise<{ restaurant; menu; category; product }>` and `resetTestData(prisma)` (deletes in dependency order, including `MenuSlug` tombstones and, from Task 7 on, users, invitations and audit rows).

Schema changes (Prisma types; `@default(cuid())` ids and `createdAt`/`updatedAt` where shown):

```prisma
enum RestaurantStatus { ACTIVE SUSPENDED ARCHIVED }
enum RestaurantType   { CAFE RESTAURANT BAKERY FAST_FOOD FINE_DINING OTHER }
enum MenuStatus       { DRAFT PUBLISHED SUSPENDED ARCHIVED }

model Restaurant {
  id               String           @id @default(cuid())
  clientNumber     Int              @unique @default(autoincrement())
  name             String
  type             RestaurantType   @default(RESTAURANT)
  description      String           @default("")
  address          String           @default("")
  city             String           @default("")
  country          String           @default("")
  phone            String           @default("")
  whatsapp         String           @default("")
  socialLinks      Json             @default("{}")   // { instagram?, facebook?, tiktok?, website? }
  workingHours     Json             @default("{}")   // { mon: [["08:00","23:00"]], ... }
  status           RestaurantStatus @default(ACTIVE)
  notes            String           @default("")
  permissionPolicy Json             @default("{}")
  version          Int              @default(1)
  createdAt        DateTime         @default(now())
  updatedAt        DateTime         @updatedAt
  branches Branch[]
  menus    Menu[]
  @@index([city])
  @@index([status])
}

model Branch {
  id           String @id @default(cuid())
  restaurantId String
  name         String
  address      String @default("")
  city         String @default("")
  phone        String @default("")
  workingHours Json   @default("{}")
  sortOrder    Int    @default(0)
  version      Int    @default(1)
  restaurant   Restaurant @relation(fields: [restaurantId], references: [id], onDelete: Cascade)
  @@index([restaurantId])
}

model Menu {
  id                  String     @id @default(cuid())
  restaurantId        String
  name                String
  slug                String     @unique
  status              MenuStatus @default(DRAFT)
  statusBeforeArchive MenuStatus?
  liveRevisionId      String?    @unique
  draftHash           String?
  liveHash            String?
  currency            String     @default("USD")
  defaultLocale       String     @default("en")
  locales             String[]
  timezone            String
  numeralSystem       NumeralSystem @default(LATN)
  engineConfig        Json       @default("{}")
  seo                 Json       @default("{}")   // { en?: { title, description }, ar?: ..., ckb?: ... }
  notes               String     @default("")
  version             Int        @default(1)
  createdAt           DateTime   @default(now())
  updatedAt           DateTime   @updatedAt
  // relations: restaurant, liveRevision (MenuRevision, "LiveRevision"), revisions, slugs, domains, brand,
  // and every catalog relation that Restaurant has today
  @@index([restaurantId])
  @@index([status])
  @@index([createdAt])
}

model MenuSlug {
  slug      String   @id
  menuId    String?  // null = tombstone of a deleted menu
  createdAt DateTime @default(now())
  menu      Menu?    @relation(fields: [menuId], references: [id], onDelete: SetNull)
  @@index([menuId])
}

model MenuRevision {
  id            String    @id @default(cuid())
  menuId        String
  number        Int
  schemaVersion Int
  snapshot      Json
  snapshotHash  String
  goLiveAt      DateTime?
  wentLiveAt    DateTime?
  cancelledAt   DateTime?
  createdById   String?
  note          String    @default("")
  createdAt     DateTime  @default(now())
  @@unique([menuId, number])
}

model MenuDomain { id String @id @default(cuid())  menuId String  host String @unique  @@index([menuId]) }
```

`Product` gains `isHidden Boolean @default(false)`, `dietary String[]`, `calories Int?`, `badges String[]`, `version Int @default(1)`. `Category`, `ProductVariant`, `ModifierGroup`, `ModifierOption` gain `version Int @default(1)`. `AnalyticsEvent` gains `qrCodeId String?` and `source String?`, and its index becomes `@@index([menuId, type, occurredAt])` plus `@@index([type, occurredAt])`. Trigram indexes on `Restaurant.name`, `Menu.name` and `Menu.slug` per the spike (with `CREATE EXTENSION IF NOT EXISTS pg_trgm` at the top of the migration).

Registry classes: `MENU_SCOPED_MODELS` = `BrandConfig, Category, Product, ProductVariant, ModifierGroup, ModifierOption, UpsellRule, PairingRule, Bundle, BundleItem, DaypartSchedule, Table, AnalyticsEvent, MenuRevision`; `RESTAURANT_SCOPED_MODELS` = `Branch`; `UNSCOPED_LOOKUP_MODELS` = `Menu, MenuSlug, MenuDomain`; `GLOBAL_MODELS` = `Restaurant` (later tasks append their models).

- [ ] **Step 1: Rewrite the registry test**

```ts
// tests/data/tenant-registry.test.ts
// A required column is `name String` followed by whitespace or an attribute, never `String?`.
it('registers every model with a required menuId column', () => {
  const withMenu = names((body) => /^\s*menuId\s+String(?!\?)\b/m.test(body));
  expect(withMenu).toEqual([...MENU_SCOPED_MODELS, 'MenuDomain'].sort());
});
it('registers every model with a required restaurantId column', () => {
  const withRestaurant = names((body) => /^\s*restaurantId\s+String(?!\?)\b/m.test(body));
  expect(withRestaurant).toEqual([...RESTAURANT_SCOPED_MODELS, 'Menu', ...CROSS_RESTAURANT_MODELS].sort());
});
it('classifies every model exactly once', () => {
  const all = [...MENU_SCOPED_MODELS, ...RESTAURANT_SCOPED_MODELS, ...UNSCOPED_LOOKUP_MODELS, ...CROSS_RESTAURANT_MODELS, ...GLOBAL_MODELS];
  expect(new Set(all).size).toBe(all.length);
  expect([...models.keys()].sort()).toEqual([...all].sort());
});
```

(`names(predicate)` returns the sorted model names whose body matches.)

- [ ] **Step 2: Rewrite `tests/data/tenant-db.test.ts` for `menuDb`** with the same cases as today (list, read by id, update, bulk delete, stamp on create, refuse re-homing through update, updateMany, upsert and relation connect, ordinary update, count), using `menuId`/`menu` and the error text `Tenant mismatch`. Add one `restaurantDb` case: `restaurantDb(prisma, a.restaurant.id).branch.findMany()` returns only A's branch.
- [ ] **Step 3: Run `npm test -- tests/data`.** Expected: FAIL (schema and helpers still use `restaurantId`).
- [ ] **Step 4: Change the schema, generate the migration with `npx prisma migrate dev --name restaurant_menu_split --create-only`, add the `pg_trgm` extension line, and apply it.** The local database holds only seed data; the migration may drop and recreate tables.
- [ ] **Step 5: Generalize `scopedDb` into `scopeExtension(column, models, id)`** and export `menuDb`, `restaurantDb`, `scopedClient` (applies both extensions when both ids are given). Keep the existing guard behaviour and messages.
- [ ] **Step 6: Rename across the code.** `Catalog.restaurantId` → `menuId`; `loadCatalog` → `loadDraftCatalog(prisma, menuId)` reading `prisma.menu`; `findTenant` reads `Menu` (plus `MenuDomain` for hosts) and still returns `TenantInfo` with `id` = menu id; `recordEvents(prisma, menuId, ...)`; the table page uses `menuDb`. `SeedData` gains `profile: { name: string; type: RestaurantType; city: string; country: string; phone: string; whatsapp: string; instagram: string; description: string }`; ATELIER's profile is `{ name: 'ATELIER', type: 'CAFE', city: 'Erbil', country: 'Iraq', ... }` with empty contact fields. `prisma/seed.ts` creates (or reuses by name) the restaurant, then `seedMenu`, and creates the `MenuSlug` row for the menu's slug. `seedMenu` deletes a previous menu with the same slug first, as `seedRestaurant` did.
- [ ] **Step 7: Run `npm run typecheck && npm run lint && npm test`.** Expected: all pass, including the existing API, loader, seed and domain suites.
- [ ] **Step 8: Run `npm run db:seed` and `npm run test:e2e -- --project=mobile tests/e2e/menu.spec.ts tests/e2e/cart.spec.ts`.** Expected: PASS (the public menu is unchanged).
- [ ] **Step 9: Commit**

```bash
git add -A prisma src tests
git commit -m "feat(data): restaurants own menus; catalog scoped by menu"
```

---

### Task 2: Menu snapshots and publish rules (pure domain)

**Files:**
- Create: `src/server/domain/snapshot.ts`, `src/server/domain/publish-rules.ts`
- Modify: `src/server/domain/index.ts` (re-export)
- Test: `tests/domain/snapshot.test.ts`, `tests/domain/publish-rules.test.ts`

**Interfaces:**
- Consumes: `Catalog`, `CatalogProduct`, `CatalogOption` (Task 1), `BrandView` and `EngineConfig` (existing).
- Produces:
  - `SNAPSHOT_SCHEMA_VERSION = 1`.
  - `interface MenuSnapshot { schemaVersion: 1; menu: SnapshotMenu; brand: BrandView; catalog: SnapshotCatalog }`.
  - `interface SnapshotMenu { name: string; displayName: string; currency: string; defaultLocale: Locale; locales: Locale[]; timeZone: string; numeralSystem: 'latn' | 'arab'; engineConfig: EngineConfig; seo: Partial<Record<Locale, { title: string; description: string }>> }`.
  - `SnapshotCatalog` = `Catalog` without `menuId`, with products lacking `isAvailable`, `isHidden`, `stockCount`, and options lacking `isAvailable` (`Omit` types named `SnapshotProduct`, `SnapshotOption`). `CatalogProduct` gains `isHidden: boolean`, `dietary: string[]`, `calories: number | null`, `badges: string[]`.
  - `interface LiveOverlay { products: Record<string, { isAvailable: boolean; isHidden: boolean; stockCount: number | null }>; options: Record<string, { isAvailable: boolean }> }`.
  - `buildSnapshot(input: { menu: SnapshotMenu; brand: BrandView; catalog: Catalog }): MenuSnapshot` (strips live fields, sorts every list by `sortOrder` then `id`).
  - `snapshotHash(snapshot: MenuSnapshot): string` (SHA-256 hex of canonical JSON with sorted keys).
  - `parseSnapshot(json: unknown): MenuSnapshot` (Zod; throws `Error('Unsupported snapshot schema version N')`).
  - `toCatalog(menuId: string, snapshot: MenuSnapshot, overlay: LiveOverlay): Catalog` (applies the overlay; ids missing from the overlay default to available, not hidden, stock null; hidden products are removed together with bundles containing them and rules whose source or target they are).
  - `type PublishIssueCode = 'EMPTY_MENU' | 'NO_PRICE' | 'EMPTY_CATEGORY' | 'UNSATISFIABLE_GROUP' | 'BROKEN_REFERENCE' | 'MISSING_TRANSLATION' | 'NO_IMAGE'`.
  - `interface PublishIssue { code: PublishIssueCode; severity: 'block' | 'warn'; entity?: { type: 'category' | 'product' | 'group' | 'rule' | 'bundle'; id: string; slug?: string }; locale?: Locale }`.
  - `validateForPublish(snapshot: MenuSnapshot): PublishIssue[]`.

- [ ] **Step 1: Write the failing tests**

```ts
// tests/domain/snapshot.test.ts (uses tests/domain/fixtures.ts catalogs)
it('produces the same hash regardless of row order and live fields', () => {
  const a = buildSnapshot({ menu, brand, catalog });
  const shuffled = { ...catalog, products: [...catalog.products].reverse().map((p) => ({ ...p, isAvailable: false, stockCount: 3 })) };
  expect(snapshotHash(buildSnapshot({ menu, brand, catalog: shuffled }))).toBe(snapshotHash(a));
});
it('changes the hash when a price changes', () => { /* basePrice + 50 → different hash */ });
it('round-trips through JSON and parseSnapshot', () => {
  const s = buildSnapshot({ menu, brand, catalog });
  expect(parseSnapshot(JSON.parse(JSON.stringify(s)))).toEqual(s);
});
it('rejects an unknown schema version', () => {
  expect(() => parseSnapshot({ schemaVersion: 2 })).toThrow('Unsupported snapshot schema version 2');
});
it('applies the live overlay', () => {
  const c = toCatalog('m1', s, { products: { [burger.id]: { isAvailable: false, isHidden: false, stockCount: 2 } }, options: {} });
  expect(c.menuId).toBe('m1');
  expect(c.products.find((p) => p.id === burger.id)).toMatchObject({ isAvailable: false, stockCount: 2 });
});
it('removes hidden products and the bundles and rules that reference them', () => { /* hide fries → burger-set gone, burger→fries pairing gone */ });
```

```ts
// tests/domain/publish-rules.test.ts
it('blocks an empty menu', () => expect(codes(emptyMenu)).toContainEqual(['EMPTY_MENU', 'block']));
it('blocks a product priced 0', () => expect(codes(withPrice(0))).toContainEqual(['NO_PRICE', 'block']));
it('blocks an active category with no products', () => ...);
it('blocks a group whose minimum exceeds its options or its maximum', () => ...); // min 3 with 2 options; min 2 > max 1
it('blocks a pairing rule whose target is not in the menu', () => ...);
it('warns, not blocks, for a missing Sorani name', () =>
  expect(issues(missingCkb)).toContainEqual(expect.objectContaining({ code: 'MISSING_TRANSLATION', severity: 'warn', locale: 'ckb' })));
it('warns for a product with no media', () => ...);
it('finds nothing blocking in the ATELIER seed', () =>
  expect(validateForPublish(atelierSnapshot()).filter((i) => i.severity === 'block')).toEqual([]));
```

`MISSING_TRANSLATION` checks category `name` and product `name` for every locale in `menu.locales`.

- [ ] **Step 2: Run `npm test -- tests/domain/snapshot.test.ts tests/domain/publish-rules.test.ts`.** Expected: FAIL (module not found).
- [ ] **Step 3: Implement `src/server/domain/snapshot.ts` and `publish-rules.ts`** to the interfaces above. The Zod schema mirrors the types; `canonicalJson` is a local helper that sorts object keys recursively.
- [ ] **Step 4: Run the two test files.** Expected: PASS.
- [ ] **Step 5: Commit** (`feat(domain): menu snapshots, live overlay and publish rules`).

---

### Task 3: Publishing and the public read path

**Files:**
- Create: `src/server/publish/draft.ts`, `src/server/publish/publish.ts`, `src/server/data/live.ts`, `src/server/data/public-menu.ts`
- Modify: `src/server/data/catalog-loader.ts`, `src/server/data/tenant.ts`, `src/server/data/cache.ts`, `src/server/route-context.ts`, `src/server/http/route.ts`, `src/app/api/[tenant]/*/route.ts`, `src/app/[tenant]/[locale]/**/page.tsx`, `prisma/seed.ts`, `tests/helpers/db.ts`
- Test: `tests/publish/publish.test.ts`, `tests/publish/draft.test.ts`, `tests/data/public-menu.test.ts`

**Interfaces:**
- Consumes: Task 1 models and `menuDb`/`scopedClient`; Task 2 snapshot functions.
- Produces:
  - `loadDraftSnapshot(db: PrismaClient | ScopedClient, menuId: string): Promise<MenuSnapshot>` (settings from `Menu`, `displayName` from `Restaurant.name`, brand from `BrandConfig` as `BrandView`, catalog from `loadDraftCatalog`).
  - `refreshDraftHash(db, menuId: string): Promise<string>` (recomputes and stores `Menu.draftHash`).
  - `writeDraftFromSnapshot(tx, menuId: string, snapshot: MenuSnapshot): Promise<void>` (replaces the menu's draft catalog and brand with new ids; remaps every reference; leaves `Table` rows alone).
  - `class PublishError extends Error { code: 'ARCHIVED' | 'NOT_FOUND' }`.
  - `publishMenu(tx: Prisma.TransactionClient | ScopedTx, args: { menuId: string; actorId: string | null; note?: string; now: Date }): Promise<PublishOutcome>` where `PublishOutcome = { ok: true; revisionId: string; number: number; warnings: PublishIssue[] } | { ok: false; issues: PublishIssue[] }`. Always called inside a transaction. It locks the menu row with a version-incrementing update first, throws `PublishError('ARCHIVED')` for archived menus, creates revision `max(number) + 1` with `wentLiveAt: now` (writing `menuId` explicitly so it works on scoped and unscoped clients), sets `liveRevisionId`, `liveHash`, `draftHash`, and moves `DRAFT` to `PUBLISHED` (`SUSPENDED` stays).
  - `loadOverlay(db, menuId: string): Promise<LiveOverlay>`.
  - `type PublicMenuResult = { kind: 'live'; tenant: TenantInfo } | { kind: 'redirect'; slug: string; tenant: TenantInfo } | { kind: 'unavailable'; name: string; defaultLocale: Locale; locales: Locale[] } | { kind: 'missing' }`.
  - `resolvePublicMenu(slug: string): Promise<PublicMenuResult>` (looks up `MenuSlug`; a historical slug yields `redirect` with the current slug; never-published menus are `missing`; `SUSPENDED`/`ARCHIVED` menus or a non-`ACTIVE` restaurant are `unavailable`; brand, settings and name come from the live snapshot).
  - `TenantInfo` gains `restaurantId: string` and `revisionId: string`.
  - `getTenant(slug: string): Promise<TenantInfo | null>` (live or redirect → tenant; otherwise null; API routes keep working on old slugs).
  - `getCatalog(tenant: TenantInfo): Promise<Catalog>` (= `toCatalog(menuId, cached snapshot of tenant.revisionId, cached overlay)`).
  - Cache helpers in `cache.ts`: snapshot by revision id (`revalidate: false`, tag `revision:{id}`), overlay (`revalidate: 30`, tag `live:{menuId}`), slug resolution (`revalidate: 300`, tag `slug:{slug}`); `expireMenu(slugs: string[], menuId: string)` and `expireLive(menuId: string)` call `updateTag` when inside a Server Action and `revalidateTag(tag, { expire: 0 })` otherwise, and do nothing outside the Next runtime.
  - Test helper `createMenuFixture(prisma, slug, { publish = true })` publishes by default.

- [ ] **Step 1: Write the failing integration tests** (against the test database)

```ts
// tests/publish/publish.test.ts
const publish = (menuId: string) => prisma.$transaction((tx) => publishMenu(tx, { menuId, actorId: null, now: NOW }));

it('creates revision 1 and makes the menu PUBLISHED', async () => {
  const out = await publish(a.menu.id);
  expect(out).toMatchObject({ ok: true, number: 1 });
  expect(await prisma.menu.findUniqueOrThrow({ where: { id: a.menu.id } })).toMatchObject({ status: 'PUBLISHED', liveRevisionId: out.ok && out.revisionId });
});
it('refuses to publish when a block issue exists and creates no revision', async () => { /* empty category */ });
it('numbers concurrent publishes consecutively', async () => {
  const results = await Promise.all([1, 2, 3].map(() => publish(menuId)));
  expect(results.map((r) => r.ok && r.number).sort()).toEqual([1, 2, 3]);
});
it('keeps a suspended menu suspended and refuses an archived one', async () => { ... });
it('sets liveHash equal to draftHash after publishing', async () => { ... });
```

```ts
// tests/publish/draft.test.ts
it('writes a snapshot into another menu and reads back the same snapshot apart from ids', async () => {
  const source = await loadDraftSnapshot(prisma, atelierMenuId);
  await prisma.$transaction((tx) => writeDraftFromSnapshot(tx, emptyMenuId, source));
  expect(stripIds(await loadDraftSnapshot(prisma, emptyMenuId))).toEqual(stripIds(source));
});
it('leaves the source menu untouched', async () => { /* row counts for the source are unchanged */ });
```

(`stripIds` replaces every id with its slug path, so references are compared by meaning; it also normalizes `menu.name`, which differs.)

```ts
// tests/data/public-menu.test.ts
it('does not show draft edits until the next publish', async () => {
  await prisma.product.update({ where: { id: a.product.id }, data: { basePrice: 999 } });
  const tenant = await getTenant(a.menu.slug);
  expect((await getCatalog(tenant!)).products[0]!.basePrice).toBe(300);
});
it('shows sold-out at once without a publish', async () => {
  await prisma.product.update({ where: { id: a.product.id }, data: { isAvailable: false } });
  expect((await getCatalog((await getTenant(a.menu.slug))!)).products[0]!.isAvailable).toBe(false);
});
it("never returns another menu's products", async () => { /* B's catalog has only B's product id */ });
it('resolves a historical slug as a redirect to the current one', async () => { ... });
it('is missing for a never-published menu and unavailable for a suspended one', async () => { ... });
it('is unavailable when the restaurant is suspended', async () => { ... });
```

- [ ] **Step 2: Run `npm test -- tests/publish tests/data/public-menu.test.ts`.** Expected: FAIL.
- [ ] **Step 3: Implement `draft.ts`, `publish.ts`, `live.ts`, `public-menu.ts` and the cache helpers.** `tenant.ts` keeps `TenantInfo` and `BrandView` and re-exports `getTenant` from `public-menu.ts`; `catalog-loader.ts` keeps only `loadDraftCatalog`.
- [ ] **Step 4: Update callers.** `loadMenuView`, the quote, suggestions and search-index routes call `getCatalog(tenant)`. `prisma/seed.ts` publishes each seeded menu (`publishMenu` with `actorId: null`, note `Seed`) and fails loudly on block issues. Update `tests/api/routes.test.ts`, `tests/data/loader.test.ts` and `tests/seed/atelier.test.ts` to seed through the fixture helpers that publish.
- [ ] **Step 5: Run `npm test`, then `npm run db:seed` and `npm run test:e2e -- --project=mobile`.** Expected: all PASS.
- [ ] **Step 6: Commit** (`feat(publish): menus publish to immutable revisions; public menus read the live revision`).

---

### Task 4: Slugs, public routes, redirects and host routing

**Files:**
- Create: `src/server/domain/slug.ts`, `src/server/domain/locale-negotiation.ts`, `src/server/http/hosts.ts`, `src/proxy.ts`, `src/app/[tenant]/route.ts`, `src/app/[tenant]/t/[table]/route.ts`, `src/server/public-page.tsx`, `src/ui/MenuUnavailable.tsx`, `src/server/env.ts`
- Modify: `next.config.ts` (remove the `/` redirect), `src/app/[tenant]/[locale]/layout.tsx`, every page under `src/app/[tenant]/[locale]/`, `src/lib/messages/{en,ar,ckb}.ts` (unavailable page strings)
- Test: `tests/domain/slug.test.ts`, `tests/domain/locale-negotiation.test.ts`, `tests/http/hosts.test.ts`, `tests/e2e/public-urls.spec.ts`

**Interfaces:**
- Consumes: `resolvePublicMenu` (Task 3).
- Produces:
  - `RESERVED_SLUGS: readonly string[]` (the twelve in Global Constraints).
  - `normalizeSlugInput(raw: string): string` (trim, lowercase, spaces and underscores to hyphens, strip Latin accents with NFKD, drop other characters, collapse and trim hyphens).
  - `type SlugProblem = 'TOO_SHORT' | 'TOO_LONG' | 'BAD_CHARACTERS' | 'RESERVED'` and `validateSlug(slug: string, extraReserved: readonly string[]): { ok: true } | { ok: false; reason: SlugProblem }`.
  - `suggestSlug(name: string, fallback: string): string` (`normalizeSlugInput(name)`, or `fallback` when the result is shorter than 3).
  - `pickLocale(acceptLanguage: string | null, offered: Locale[], fallback: Locale): Locale` (`ku`, `ckb`, `ku-IQ`, `ckb-IQ` map to `ckb`; quality values respected).
  - `env()` returning `{ publicHost: string | null; studioHost: string | null; publicOrigin: string; rootRedirect: string; ... }` parsed with Zod from `PUBLIC_MENU_HOST`, `STUDIO_HOST`, `PUBLIC_MENU_ORIGIN` (default `http://127.0.0.1:3100`), `PUBLIC_ROOT_REDIRECT` (default `https://buzzify.me`). Later tasks add their variables here.
  - `routeHost(req: { host: string; pathname: string }, cfg: { publicHost: string | null; studioHost: string | null; rootRedirect: string }): { action: 'next' } | { action: 'redirect'; to: string } | { action: 'notFound' }`.
  - `withPublicMenu(params: { tenant: string; locale: string }, subpath: string, search: string, render: (route: RouteContext) => Promise<ReactNode>): Promise<ReactNode>` (missing → `notFound()`; redirect → `permanentRedirect('/' + slug + '/' + locale + subpath + search)`; unavailable → `<MenuUnavailable>`; live → `render`).

Host rules for `routeHost`:

| Host | Path | Action |
|---|---|---|
| studio host | `/` | redirect `/studio` |
| studio host | `/studio*`, `/api/auth*`, `/api/studio*`, `/_next*`, `/favicon.ico` | next |
| studio host | anything else | notFound |
| public host | `/studio*`, `/api/auth*`, `/api/studio*` | notFound |
| public host | `/` | redirect `rootRedirect` |
| any other host (development, previews) | `/` | redirect `/studio` |
| any other host | anything else | next |

- [ ] **Step 1: Write the failing unit tests**

```ts
// tests/domain/slug.test.ts
it.each([['Café Mazo', 'cafe-mazo'], ['  Mazo  Lounge ', 'mazo-lounge'], ['mazo__cafe', 'mazo-cafe'], ['--a--b--', 'a-b'], ['مازو', '']])(
  'normalizes %s to %s', (raw, out) => expect(normalizeSlugInput(raw)).toBe(out));
it('rejects reserved words, short, long and bad slugs', () => {
  expect(validateSlug('studio', [])).toEqual({ ok: false, reason: 'RESERVED' });
  expect(validateSlug('ab', [])).toEqual({ ok: false, reason: 'TOO_SHORT' });
  expect(validateSlug('a'.repeat(49), [])).toEqual({ ok: false, reason: 'TOO_LONG' });
  expect(validateSlug('a--b', [])).toEqual({ ok: false, reason: 'BAD_CHARACTERS' });
  expect(validateSlug('-ab', [])).toEqual({ ok: false, reason: 'BAD_CHARACTERS' });
  expect(validateSlug('mazo', ['mazo'])).toEqual({ ok: false, reason: 'RESERVED' });
});
it('suggests the fallback for names with no Latin letters', () => expect(suggestSlug('مطعم مازو', 'menu-0007')).toBe('menu-0007'));
```

```ts
// tests/domain/locale-negotiation.test.ts
it('picks the best offered language', () => expect(pickLocale('ar-IQ,ar;q=0.9,en;q=0.5', ['en', 'ar'], 'en')).toBe('ar'));
it('maps Kurdish tags to Sorani', () => expect(pickLocale('ku-IQ', ['en', 'ckb'], 'en')).toBe('ckb'));
it('falls back when nothing matches', () => expect(pickLocale('fr', ['en', 'ar'], 'ar')).toBe('ar'));
```

```ts
// tests/http/hosts.test.ts — one case per table row above
```

- [ ] **Step 2: Run them.** Expected: FAIL.
- [ ] **Step 3: Implement `slug.ts`, `locale-negotiation.ts`, `hosts.ts`, `env.ts` and `src/proxy.ts`.** The proxy's matcher excludes `_next/static`, `_next/image` and files with an extension; it calls `routeHost` with `request.headers.get('host')` and returns `NextResponse.redirect`, `NextResponse.next()` or a 404 `Response`.
- [ ] **Step 4: Implement the two route handlers.** `GET /{slug}` resolves the menu (including historical slugs), picks the locale with `pickLocale`, and returns 307 to `/{currentSlug}/{locale}` keeping the query string; 404 when missing. `GET /{slug}/t/{table}` does the same to `/{currentSlug}/{locale}/t/{table}`.
- [ ] **Step 5: Wrap every public page in `withPublicMenu`** with its own subpath (`''`, `/t/{table}`, `/p/{slug}`, `/cart`, `/explore`). In the layout, `generateMetadata` returns `robots: { index: false }` for unavailable and missing menus, and for live ones `alternates: { canonical: origin + '/' + slug + '/' + locale, languages: { [l]: origin + '/' + slug + '/' + l } }`, plus the menu's SEO title and description for the locale when set. `MenuUnavailable` shows the restaurant name and `menu.unavailable` ("This menu is temporarily unavailable.") in the visitor's locale.
- [ ] **Step 6: Write `tests/e2e/public-urls.spec.ts`:** `/atelier` lands on `/atelier/en` (and on `/atelier/ar` with `Accept-Language: ar`); `/atelier/t/04` lands on `/atelier/en/t/04`; after the test renames the menu's slug through the database plus `MenuSlug` (helper in `tests/e2e/helpers/db.ts`), `/atelier/en/p/atelier-burger?x=1` answers 308 to the new slug with the same path and query; a suspended menu shows the unavailable text and a `noindex` robots tag; an unknown slug is 404. The helper restores the slug afterwards.
- [ ] **Step 7: Run unit tests and the new e2e spec, then the full e2e suite.** Expected: PASS.
- [ ] **Step 8: Commit** (`feat(routes): permanent menu URLs, slug redirects, language negotiation and host routing`).

---

### Task 5: Permissions (pure domain)

**Files:**
- Create: `src/server/domain/permissions.ts`
- Test: `tests/domain/permissions.test.ts`

**Interfaces:**
- Produces:
  - `PERMISSIONS` (the 26 keys of spec 9.1, as a readonly tuple) and `type Permission`.
  - `type MemberRole = 'DESIGNER' | 'OWNER'`.
  - `ROLE_DEFAULTS: Record<MemberRole, readonly Permission[]>` exactly as spec 9.2.
  - `NEVER_GRANTABLE: readonly Permission[]` = `restaurant.create`, `restaurant.delete`, `menu.delete`, `people.manage`, `permissions.manage`, `audit.view`, `platform.settings`.
  - `type PermissionPolicy = Partial<Record<MemberRole, { grant: Permission[]; revoke: Permission[] }>>`.
  - `parsePolicy(json: unknown): PermissionPolicy` (drops unknown keys and never-grantable grants).
  - `effectivePermissions(args: { isSuperAdmin: boolean; role: MemberRole | null; policy: PermissionPolicy }): ReadonlySet<Permission>` (Super Admin: all; no role: empty; otherwise defaults + grants − revokes).
  - `PLATFORM_PERMISSIONS: readonly Permission[]` = `restaurant.create`, `people.manage`, `audit.view`, `platform.settings` (only Super Admins hold these, at platform level).

- [ ] **Step 1: Write the failing matrix test**

```ts
const EXPECTED: Record<MemberRole, Permission[]> = { DESIGNER: [/* spec 9.2 list */], OWNER: ['content.edit', 'content.prices', 'content.media', 'content.availability', 'publish.now', 'prices.bulk'] };
it.each(PERMISSIONS.flatMap((p) => (['DESIGNER', 'OWNER'] as const).map((r) => [r, p] as const)))(
  '%s default for %s', (role, permission) => {
    expect(effectivePermissions({ isSuperAdmin: false, role, policy: {} }).has(permission)).toBe(EXPECTED[role].includes(permission));
  });
it('gives Super Admins every key', () => expect(effectivePermissions({ isSuperAdmin: true, role: null, policy: {} }).size).toBe(PERMISSIONS.length));
it('gives nothing without a role', () => expect(effectivePermissions({ isSuperAdmin: false, role: null, policy: {} }).size).toBe(0));
it('applies a client policy', () => {
  const policy = parsePolicy({ OWNER: { grant: ['people.invite'], revoke: ['publish.now'] } });
  const set = effectivePermissions({ isSuperAdmin: false, role: 'OWNER', policy });
  expect(set.has('people.invite')).toBe(true);
  expect(set.has('publish.now')).toBe(false);
});
it('never grants a never-grantable key', () => {
  expect(parsePolicy({ DESIGNER: { grant: ['menu.delete', 'nonsense'], revoke: [] } })).toEqual({ DESIGNER: { grant: [], revoke: [] } });
});
```

- [ ] **Step 2: Run, expect FAIL. Step 3: Implement. Step 4: Run, expect PASS.**
- [ ] **Step 5: Commit** (`feat(domain): Studio permission keys, role defaults and client policies`).

---

### Task 6: Email delivery and templates

**Files:**
- Create: `src/server/email/send.ts`, `src/server/email/templates.ts`
- Modify: `src/server/env.ts`, `.env.example`, `.gitignore` (already ignores `.data/`)
- Test: `tests/email/send.test.ts`, `tests/email/templates.test.ts`

**Interfaces:**
- Produces:
  - `interface Email { to: string; subject: string; html: string; text: string }`.
  - `sendEmail(email: Email): Promise<void>` (Resend when `RESEND_API_KEY` is set, from `EMAIL_FROM`, default `Buzzify Studio <studio@buzzify.me>`; otherwise writes `.data/mail/{timestamp}-{to}.json` and logs the subject and first link to the console; throws in production when the key is missing).
  - `readDevMail(to: string): Promise<Email[]>` (newest first; used by tests and e2e).
  - `type EmailTemplate = 'invite' | 'reset' | 'changeEmailConfirm' | 'verifyNewEmail' | 'emailChanged' | 'passwordChanged'`.
  - `renderEmail(template: EmailTemplate, locale: Locale, params: { name?: string; url?: string; inviter?: string; restaurant?: string; role?: string; newEmail?: string }): Omit<Email, 'to'>` (HTML has `lang` and `dir`; every link is also in the text version; strings come from the Studio message catalog keys `email.*` added in Task 11, so this task adds those keys to `src/studio/messages/{en,ar,ckb}.ts` with the catalog module itself).

- [ ] **Step 1: Write the failing tests:** the dev sink writes a file readable by `readDevMail`; `renderEmail('invite', 'ar', ...)` contains `dir="rtl"` and the URL in both bodies; every template renders in all three locales with no `{placeholder}` left; HTML escapes `<` in names.
- [ ] **Step 2: Run, expect FAIL. Step 3: Implement** (add `resend` pinned; create `src/studio/messages/index.ts` exporting `STUDIO_MESSAGES: Record<Locale, Messages>` and `getStudioTranslator(locale)` built on `createTranslator`). **Step 4: Run, expect PASS.**
- [ ] **Step 5: Commit** (`feat(email): Resend delivery with a development mail folder and three-language templates`).

---

### Task 7: Accounts and sign-in (Better Auth)

**Files:**
- Create: `src/server/studio/auth/auth.ts`, `users.ts`, `password-policy.ts`, `common-passwords.txt`, `rate-limit.ts`, `actor.ts`; `src/app/api/auth/[...all]/route.ts`; migration `<timestamp>_studio_auth`
- Modify: `prisma/schema.prisma`, `src/server/data/tenant-db.ts` (register new global models), `src/server/env.ts`, `.env.example`, `tests/helpers/db.ts`
- Test: `tests/studio/auth.test.ts`, `tests/studio/password-policy.test.ts`, `tests/studio/rate-limit.test.ts`

**Interfaces:**
- Consumes: spike findings (Task 0), `sendEmail`/`renderEmail` (Task 6).
- Produces:
  - Prisma: Better Auth's models from the spike, with `User` extended by `isSuperAdmin Boolean @default(false)`, `locale String @default("en")`, `deactivatedAt DateTime?`; plus `Membership { id; userId; restaurantId; role MemberRole; createdAt; @@unique([userId, restaurantId]) @@index([restaurantId]) }` and `AuthRateLimit { key String @id; windowStart DateTime; count Int }`. `Membership` goes in `CROSS_RESTAURANT_MODELS` (the actor loader reads it by user across restaurants); the rest in `GLOBAL_MODELS`.
  - `auth` (Better Auth instance): `appName: 'Buzzify Studio'`, `baseURL` from `BETTER_AUTH_URL`, `emailAndPassword: { enabled: true, disableSignUp: true, minPasswordLength: 12, maxPasswordLength: 128, resetPasswordTokenExpiresIn: 3600, revokeSessionsOnPasswordReset: true, sendResetPassword, onPasswordReset }`, `user: { additionalFields: { isSuperAdmin, locale, deactivatedAt } (input: false), changeEmail: { enabled: true, sendChangeEmailConfirmation } }`, `emailVerification: { sendVerificationEmail }`, `session: { expiresIn: 2592000, updateAge: 86400 }`, `advanced: { cookiePrefix: 'studio', useSecureCookies: production }` (no cross-subdomain cookies), `rateLimit: { enabled: true, storage: 'database' }`, `trustedOrigins` = the Studio origin, plus `http://localhost:3100` and `http://127.0.0.1:3100` outside production, `plugins: [twoFactor({ issuer: 'Buzzify Studio', backupCodeOptions: { amount: 10 } }), nextCookies()]`, `disabledPaths: ['/sign-up/email']`.
  - `normalizeEmail(raw: string): string` (trim, lowercase).
  - `createPasswordUser(prisma, args: { email: string; name: string; password: string; isSuperAdmin?: boolean; locale?: Locale }): Promise<{ userId: string }>` (normalizes email, checks the password policy, marks the email verified, uses the spike's mechanism; throws `PasswordPolicyError` or `EmailTakenError`).
  - `checkPasswordPolicy(password: string): 'TOO_SHORT' | 'TOO_LONG' | 'COMMON' | null` (common list: SecLists `Passwords/Common-Credentials/10k-most-common.txt`, MIT licence noted at the top of the file, compared lowercase).
  - `checkRateLimit(prisma, key: string, rule: { max: number; windowSec: number }, now: Date): Promise<{ allowed: true } | { allowed: false; retryAfterSec: number }>` (fixed window in `AuthRateLimit`). Rules: `signin:ip` 20/600 s, `signin:email` 5/600 s, `totp:user` 5/300 s, `reset:email` 3/3600 s, `invite:ip` 20/3600 s.
  - `interface Actor { userId: string; email: string; name: string; isSuperAdmin: boolean; twoFactorEnabled: boolean; locale: Locale; memberships: Array<{ restaurantId: string; role: MemberRole }> }`.
  - `loadActor(prisma, userId: string): Promise<Actor | null>` (null when deactivated) and `getActor(): Promise<Actor | null>` (React `cache`; reads the session with `auth.api.getSession({ headers: await headers() })`).
  - `deactivateUser(prisma, userId: string): Promise<void>` (sets `deactivatedAt`, deletes the user's sessions).

- [ ] **Step 1: Write the failing tests**

```ts
// tests/studio/auth.test.ts
it('creates a user who can sign in with any letter case and surrounding spaces in the email', async () => {
  await createPasswordUser(prisma, { email: 'Owner@Example.com ', name: 'Owner', password: GOOD });
  const res = await auth.api.signInEmail({ body: { email: '  owner@example.COM', password: GOOD } });
  expect(res.user.email).toBe('owner@example.com');
});
it('rejects public sign-up', async () => {
  const res = await auth.handler(new Request(`${BASE}/api/auth/sign-up/email`, { method: 'POST', headers: JSON_HEADERS, body: JSON.stringify({ email: 'x@y.z', password: GOOD, name: 'X' }) }));
  expect(res.status).toBeGreaterThanOrEqual(400);
  expect(await prisma.user.count({ where: { email: 'x@y.z' } })).toBe(0);
});
it('rejects a duplicate email', async () => { ... EmailTakenError });
it('returns no actor for a deactivated user and ends their sessions', async () => { ... });
it('loads memberships into the actor', async () => { ... });
```

(The email case test signs in with the normalized email in `body` after `normalizeEmail`; Better Auth also lowercases. The test documents the behaviour the sign-in action in Task 9 relies on.)

```ts
// tests/studio/password-policy.test.ts
expect(checkPasswordPolicy('short')).toBe('TOO_SHORT');
expect(checkPasswordPolicy('password1234')).toBe('COMMON');
expect(checkPasswordPolicy('correct horse battery staple')).toBeNull();
```

```ts
// tests/studio/rate-limit.test.ts
it('allows up to max in a window, then refuses with a retry time, then resets', async () => { ... });
```

- [ ] **Step 2: Run, expect FAIL.**
- [ ] **Step 3: Add the models, create and apply the `studio_auth` migration, implement the files, and mount `toNextJsHandler(auth)` at `src/app/api/auth/[...all]/route.ts`.** `.env.example` gains `BETTER_AUTH_SECRET="generate with: openssl rand -base64 32"` and `BETTER_AUTH_URL="http://127.0.0.1:3100"`. `resetTestData` also deletes users, sessions, accounts, verifications, two-factor rows, memberships and rate-limit rows.
- [ ] **Step 4: Run `npm test`.** Expected: PASS.
- [ ] **Step 5: Commit** (`feat(auth): invitation-only accounts with Better Auth, password policy and database rate limits`).

---

### Task 8: Studio action and query framework, audit log, static enforcement

**Files:**
- Create: `src/server/studio/framework/result.ts`, `action.ts`, `query.ts`, `invoke.ts`, `concurrency.ts`; migration `<timestamp>_audit_log`
- Modify: `prisma/schema.prisma` (`AuditLog`, global), `eslint.config.mjs`
- Test: `tests/studio/framework.test.ts`, `tests/studio/enforcement.test.ts`

**Interfaces:**
- Consumes: `Actor`, `getActor` (Task 7); `effectivePermissions`, `parsePolicy`, `Permission` (Task 5); `scopedClient` (Task 1).
- Produces:
  - Prisma `AuditLog { id; actorId String?; restaurantId String?; menuId String?; action String; entityType String; entityId String; changes Json @default("{}"); ip String @default(""); userAgent String @default(""); occurredAt DateTime @default(now()); @@index([restaurantId, occurredAt]); @@index([actorId, occurredAt]); @@index([occurredAt]) }`.
  - `type ErrorCode = 'UNAUTHENTICATED' | 'TWO_FACTOR_REQUIRED' | 'FORBIDDEN' | 'NOT_FOUND' | 'INVALID' | 'CONFLICT' | 'RATE_LIMITED'`.
  - `class StudioError extends Error { code: ErrorCode; fields?: Record<string, string> }`.
  - `type ActionResult<T> = { ok: true; data: T } | { ok: false; error: { code: ErrorCode; message: string; fields?: Record<string, string> } }`.
  - `type Target = { kind: 'platform' } | { kind: 'restaurant'; restaurantId: string } | { kind: 'menu'; menuId: string } | { kind: 'self' }`. `self` (the signed-in user's own account) needs no permission; it is the only target allowed with `permission: null`.
  - `interface AuditEntry { action: string; entityType: string; entityId: string; changes?: Record<string, { before: unknown; after: unknown }> }`.
  - `interface ActionContext { actor: Actor; restaurantId: string | null; menuId: string | null; permissions: ReadonlySet<Permission>; db: PrismaClient; transaction<T>(fn: (tx: ScopedTx) => Promise<T>): Promise<T>; audit(entry: AuditEntry): void; afterCommit(fn: () => void): void }`. `transaction` opens a transaction on `scopedClient(prisma, { menuId, restaurantId })` and writes queued audit rows (with actor, restaurant, menu, ip and user agent) inside it before commit; `afterCommit` callbacks (cache expiry) run after it commits.
  - `defineAction<I, O>(def: { name: string; permission: Permission | null; input: z.ZodType<I>; target(input: I): Target; run(ctx: ActionContext, input: I): Promise<O>; allowWithoutTwoFactor?: boolean }): ActionDef<I, O>`.
  - `runAction(prisma, actor: Actor | null, def, raw: unknown, meta: { ip: string; userAgent: string }): Promise<ActionResult<O>>`. Order: no actor → `UNAUTHENTICATED`; Super Admin without two-factor and not `allowWithoutTwoFactor` → `TWO_FACTOR_REQUIRED`; input fails Zod → `INVALID` with `fields`; target resolves (menu → its restaurant; missing → `NOT_FOUND`); actor is neither Super Admin nor a member of that restaurant → `NOT_FOUND` (do not reveal existence); permission missing → `FORBIDDEN`; platform targets require the permission at Super Admin level; a `self` target skips the restaurant and permission checks; then `run`. A thrown `StudioError` becomes its result; other errors are logged and become `{ code: 'INVALID', message: 'Something went wrong' }` without details.
  - `type ActorScope = { kind: 'all' } | { kind: 'restaurants'; ids: string[] }` and `actorScope(actor): ActorScope`.
  - `defineQuery<I, O>(def: { name: string; permission: Permission | 'view'; input; target; run(ctx: { actor; db; scope: ActorScope; permissions }, input: I): Promise<O> }): QueryDef<I, O>`; `'view'` means Super Admin or member of the target restaurant (platform target: any signed-in actor, results limited by `scope`).
  - `runQuery(prisma, actor, def, raw): Promise<ActionResult<O>>` (same checks, no transaction, no audit).
  - `invoke(def, raw): Promise<ActionResult<O>>` (`getActor()`, request ip from `x-forwarded-for`, user agent; then `runAction`).
  - `invokeQuery(def: QueryDef, raw): Promise<ActionResult<O>>` (the same for read-only Server Actions called from client components, such as Jump to and slug availability).
  - `query(def, raw): Promise<O>` for pages: `UNAUTHENTICATED` → `redirect('/studio/sign-in')`; `TWO_FACTOR_REQUIRED` → `redirect('/studio/account/two-factor')`; `NOT_FOUND`/`FORBIDDEN` → `notFound()`.
  - `updateWithVersion(delegate, args: { id: string; version: number; data: object; entityType: string }, tx): Promise<void>` (`updateMany` on `{ id, version }` with `version: { increment: 1 }`; when nothing matched, reads the newest audit entry for that entity and throws `StudioError('CONFLICT', ..., { changedBy, changedAt })`).

Rules enforced by `tests/studio/enforcement.test.ts` (reads the files as text):
1. Files containing `'use server'` exist only under `src/app/studio/_actions/`.
2. In those files every export matches `export async function (\w+)\(input: unknown\)\s*\{\s*return (invoke|invokeQuery|invokePublic)\(\w+\.\w+, input\);\s*\}` (`invokePublic` only for the unauthenticated flows of Tasks 9 and 10).
3. Every export of `src/server/studio/actions/*.ts` is `export const X = defineAction(`; of `src/server/studio/queries/*.ts`, `export const X = defineQuery(`.
4. Every `route.ts` under `src/app/api/studio/` exports only `GET`/`POST` built with `studioRoute(` (a thin wrapper over `runQuery`/`runAction`, added here).
5. No file under `src/app/studio/` imports `@/server/data/prisma` or `@/generated/prisma/client`.

ESLint additions: under `src/app/[tenant]/**` and `src/ui/**`, `no-restricted-imports` patterns `@/studio/*`, `@/server/studio/*`, `@/app/studio/*`; under `src/app/studio/**`, patterns `@/server/data/prisma`, `@/generated/prisma/*`.

- [ ] **Step 1: Write the failing framework tests** with a test-only action (`defineAction({ name: 'test.rename', permission: 'restaurant.edit', target: (i) => ({ kind: 'restaurant', restaurantId: i.restaurantId }), ... })`):

```ts
it('refuses without an actor', async () => expect((await runAction(prisma, null, def, input, META)).error.code).toBe('UNAUTHENTICATED'));
it('hides another restaurant as NOT_FOUND', async () => expect((await runAction(prisma, ownerOfB, def, inputForA, META)).error.code).toBe('NOT_FOUND'));
it('refuses a member without the permission', async () => expect((await runAction(prisma, ownerOfA, def, inputForA, META)).error.code).toBe('FORBIDDEN'));
it('lets a designer of A rename A and writes one audit row in the same transaction', async () => { ... });
it('writes no audit row when the handler throws', async () => { ... });
it('requires two-factor for a Super Admin who has not enabled it', async () => { ... 'TWO_FACTOR_REQUIRED' });
it('reports Zod field errors as INVALID with fields', async () => { ... });
it('raises CONFLICT with who changed the row when the version is stale', async () => { ... });
it('limits a designer query to assigned restaurants', async () => { ... });
```

- [ ] **Step 2: Write `tests/studio/enforcement.test.ts`** with the five rules (they pass trivially while the folders are empty, and guard every later task).
- [ ] **Step 3: Run, expect the framework tests to FAIL.**
- [ ] **Step 4: Implement, add the migration, update ESLint.**
- [ ] **Step 5: Run `npm test && npm run lint`.** Expected: PASS.
- [ ] **Step 6: Commit** (`feat(studio): permission-checked actions and queries with an atomic audit log`).

---

### Task 9: Sign-in, two-factor, password reset, account settings, create-admin

**Files:**
- Create: `src/server/studio/actions/session.ts` (public flows), `src/server/studio/actions/account.ts`, `src/app/studio/_actions/session.ts`, `src/app/studio/_actions/account.ts`, `scripts/create-admin.ts`
- Modify: `src/server/studio/framework/invoke.ts` (`invokePublic`), `package.json` (`"studio:create-admin": "tsx scripts/create-admin.ts"`, pinned `qrcode`, `@types/qrcode`)
- Test: `tests/studio/session.test.ts`, `tests/studio/account.test.ts`

**Interfaces:**
- Consumes: `auth`, `checkRateLimit`, `createPasswordUser`, `normalizeEmail` (Task 7); framework (Task 8).
- Produces:
  - `invokePublic<I, O>(def: PublicActionDef<I, O>, raw: unknown): Promise<ActionResult<O>>` (no actor required; Zod input; `run(ctx: { prisma; ip; userAgent; headers: Headers }, input)`).
  - Public actions: `signIn({ email, password }) → { next: '/studio' | '/studio/two-factor' }`; `verifyTwoFactor({ code }) → { next: '/studio' }` (also accepts a recovery code when `code` has the recovery format); `requestPasswordReset({ email }) → { sent: true }` (always the same answer); `resetPassword({ token, password }) → { next: '/studio/sign-in' }`; `signOut() → { next: '/studio/sign-in' }`.
  - Account actions (permission-free, own user; use a `self` target that only requires sign-in): `startTwoFactorSetup({ password }) → { totpUri: string; secret: string; qrSvg: string; backupCodes: string[] }` (QR rendered on the server with `qrcode`), `confirmTwoFactor({ code })`, `regenerateRecoveryCodes({ password })`, `disableTwoFactor({ password })` (refused for Super Admins), `changePassword({ current, next })` (policy, revokes other sessions, sends `passwordChanged`), `requestEmailChange({ newEmail })`, `setStudioLanguage({ locale })`, `listMySessions()`, `endSession({ sessionId })`, `endOtherSessions()`. These are `allowWithoutTwoFactor: true` where needed for enrolment (`startTwoFactorSetup`, `confirmTwoFactor`, `signOut`, `setStudioLanguage`).
  - `scripts/create-admin.ts`: prompts in the terminal for name, email and password (password not echoed), refuses when any Super Admin exists unless `--force`, calls `createPasswordUser` with `isSuperAdmin: true`. Nobody but the person at the terminal sees the password.

- [ ] **Step 1: Write the failing tests:** sign-in with wrong password returns `INVALID` with a generic message and counts toward both limits; the sixth attempt for one email in ten minutes is `RATE_LIMITED`; sign-in for a two-factor user returns `next: '/studio/two-factor'`; `verifyTwoFactor` with a code generated from the enrolment secret (use `otpauth`, pinned dev dependency) succeeds and a used recovery code fails the second time; `requestPasswordReset` for an unknown address returns `{ sent: true }` and sends nothing; for a known address with different case and spaces it sends one `reset` email whose link carries a token that `resetPassword` accepts once; after reset, old sessions are gone; `disableTwoFactor` is refused for a Super Admin; `changePassword` refuses a common password with `fields.next`.
- [ ] **Step 2: Run, expect FAIL. Step 3: Implement. Step 4: Run, expect PASS.**
- [ ] **Step 5: Commit** (`feat(auth): sign-in, two-factor enrolment, password reset and account settings`).

---

### Task 10: Invitations, memberships and people management

**Files:**
- Create: `src/server/studio/services/invitations.ts`, `src/server/studio/services/people.ts`, `src/server/studio/actions/people.ts`, `src/server/studio/queries/people.ts`, `src/app/studio/_actions/people.ts`; migration `<timestamp>_invitations`
- Modify: `prisma/schema.prisma` (`Invitation`, global)
- Test: `tests/studio/invitations.test.ts`, `tests/studio/people.test.ts`

**Interfaces:**
- Produces:
  - Prisma `Invitation { id; email String; restaurantId String?; role MemberRole?; asSuperAdmin Boolean @default(false); tokenHash String @unique; expiresAt DateTime; acceptedAt DateTime?; revokedAt DateTime?; invitedById String; createdAt; @@index([email]); @@index([restaurantId]) }`.
  - `createInvitation(tx, args: { email: string; restaurantId: string | null; role: MemberRole | null; asSuperAdmin: boolean; invitedById: string; now: Date }): Promise<{ invitationId: string; url: string }>` (token: 32 random bytes, base64url; stored as SHA-256 hex; URL `/studio/invite/{token}` on the Studio origin; expires in 7 days; sends `invite` in the inviter's Studio language).
  - `inspectInvitation(prisma, token: string, now: Date): Promise<{ status: 'valid' | 'expired' | 'used' | 'revoked' | 'unknown'; email?: string; restaurantName?: string; role?: MemberRole | 'SUPER_ADMIN' | 'DESIGNER_STAFF'; accountExists?: boolean }>`.
  - `acceptInvitation(prisma, args: { token: string; signedInUserId: string | null; name?: string; password?: string; now: Date }): Promise<{ userId: string }>`. New email: creates the user with `createPasswordUser` (name and password required) and signs nobody in (the action signs in). Existing account: requires `signedInUserId` to be that account's id, else `StudioError('FORBIDDEN', 'This invitation is for another account. Sign out and open the link again.')`. Adds the membership (or sets `isSuperAdmin`), marks `acceptedAt`, writes an audit row with the inviter as actor.
  - Actions: `inviteStaff({ email, asSuperAdmin })` (`people.manage`, platform); `inviteOwner({ restaurantId, email })` (`people.invite`, restaurant); `revokeInvitation({ invitationId })` and `resendInvitation({ invitationId })` (same permission as creating it; resend issues a new token and expiry); `assignDesigner({ userId, restaurantId })`, `unassignMember({ userId, restaurantId })`, `deactivateUser({ userId })`, `reactivateUser({ userId })`, `changeUserEmail({ userId, email })` (all `people.manage`); `setPermissionPolicy({ restaurantId, policy })` (`permissions.manage`, saved through `parsePolicy`, `CONFLICT` on stale `version`).
  - Public actions: `getInvitation({ token })` and `acceptInvitationAction({ token, name?, password? })` (rate limit `invite:ip`; signs in the new user with `auth.api.signInEmail`).
  - Queries: `listPeople({ restaurantId?, q?, page })` (Super Admin: everyone; owner with `people.invite`: members of their restaurant), `listInvitations({ restaurantId?, status, page })`, `restaurantMembers({ restaurantId })`.

- [ ] **Step 1: Write the failing tests:**

```ts
it('invites an owner, accepts with a new account and lands a membership', async () => { ... });
it('refuses an expired, revoked or already used token', async () => { ... });
it('refuses to attach the invitation to a different signed-in account', async () => {
  await expect(acceptInvitation(prisma, { token, signedInUserId: otherUser.id, now })).rejects.toMatchObject({ code: 'FORBIDDEN' });
  expect(await prisma.membership.count({ where: { userId: otherUser.id } })).toBe(0);
});
it('adds a second restaurant to an existing owner who is signed in', async () => { ... });
it('stores only the token hash', async () => { ... });
it('treats invitation emails case-insensitively', async () => { ... });
it('lets an owner invite a co-owner only when the client policy grants people.invite', async () => { ... });
it('refuses a designer granting itself menu.delete through a policy', async () => { ... });
it('deactivating a user ends their sessions and blocks their actions', async () => { ... });
```

- [ ] **Step 2: Run, expect FAIL. Step 3: Implement. Step 4: Run, expect PASS.**
- [ ] **Step 5: Commit** (`feat(studio): invitations, memberships and per-client permission policies`).

---

### Task 11: Studio design system, messages, fonts and shell

Use the `impeccable` skill (shape, then craft) for the visual work in this task, within the tokens fixed below.

**Files:**
- Create: `src/studio/messages/{en,ar,ckb}.ts` (extend Task 6's files), `src/studio/fonts.ts`, `src/studio/studio.css`, `src/studio/nav.ts`, `src/studio/ui/*` (`Button`, `IconButton`, `Field`, `Input`, `Textarea`, `Select`, `Checkbox`, `Switch`, `Dialog`, `ConfirmDialog`, `DropdownMenu`, `RouteTabs`, `DataTable`, `Pagination`, `FilterBar`, `StatusBadge`, `PageHeader`, `EmptyState`, `Toaster` (sonner), `CopyButton`, `CommandPalette` shell), `src/app/studio/layout.tsx`, `src/app/studio/(auth)/layout.tsx`, `src/app/studio/(auth)/{sign-in,two-factor,forgot,reset,invite/[token]}/page.tsx`, `src/app/studio/(app)/layout.tsx`, `src/app/studio/(app)/account/page.tsx`, `src/app/studio/(app)/account/two-factor/page.tsx`
- Modify: `package.json` (pinned `radix-ui`, `cmdk`, `@tanstack/react-table`, `sonner`, `lucide-react`, `@fontsource-variable/hanken-grotesk`, `@fontsource-variable/noto-sans-arabic`; dev `fontkit`)
- Test: `tests/studio/messages.test.ts`, `tests/studio/fonts.test.ts`, `tests/studio/nav.test.ts`, `tests/e2e/studio-auth.spec.ts`

**Interfaces:**
- Consumes: Tasks 7 to 10.
- Produces:
  - `STUDIO_MESSAGES` with key groups `nav.*`, `common.*`, `auth.*`, `account.*`, `email.*`, `status.*`, `permission.*` (one label per permission key), `error.*` (one per `ErrorCode`), plus the groups later tasks add.
  - `studioFontVariables(locale: Locale): string` (Hanken Grotesk variable for Latin, Noto Sans Arabic variable for Arabic and Sorani, both through `next/font/local` from the fontsource packages, weights 400 to 600, `display: 'swap'`).
  - `NAV_ITEMS` and `visibleNav(actor: Actor): NavItem[]`: Overview (`/studio`), Restaurants, All Menus, People, Activity (Super Admin), Settings (Super Admin). Owners see only "My restaurant" linking to `/studio/restaurants/{id}` (or the menu when they have exactly one restaurant with one menu).
  - Design tokens in `studio.css` as CSS variables: `--s-bg #FFFFFF`, `--s-surface #F7F7F6`, `--s-raised #FFFFFF`, `--s-line #E4E4E2`, `--s-text #111111`, `--s-muted #5C5C59` (≥ 4.5:1 on both backgrounds), `--s-ink #000000` (primary buttons), `--s-accent #F2B705` (selection, active nav marker, focus ring; never text on white), `--s-danger #B42318`, `--s-success #067647`. Body 14 px, tables 13 px, 8 px spacing grid, 6 px radius, no shadows except dialogs.
  - `(app)/layout.tsx`: reads the actor with `getActor()`; none → redirect to sign-in; Super Admin without two-factor → redirect to `/studio/account/two-factor` (that page lives outside the guard's redirect loop); renders the sidebar, the language switch and `<html lang dir>` from `actor.locale`. `(auth)/layout.tsx` picks the language from the `studio-locale` cookie, then `Accept-Language` via `pickLocale`.

- [ ] **Step 1: Write the failing unit tests:** Studio messages follow the same four rules as `tests/lib/messages.test.ts` (copy its structure for `STUDIO_MESSAGES`); every permission and error code has a label; `fontkit` opens the Noto Sans Arabic file and `hasGlyphForCodePoint` is true for every code point in `ڕڵۆێەڤگچپژ` and Arabic-Indic digits; `visibleNav` gives the expected items for Super Admin, designer and owner.
- [ ] **Step 2: Run, expect FAIL. Step 3: Implement** the tokens, components, layouts and the sign-in, two-factor (QR, manual key, recovery codes shown once with a download as text), forgot, reset, invite and account pages wired to the Task 9 and 10 actions with `useActionState`. All layout uses logical properties; icons that point a direction are mirrored in RTL.
- [ ] **Step 4: Write `tests/e2e/studio-auth.spec.ts`** (`@desktop` tag): a Super Admin created by the e2e database helper signs in, is sent to two-factor setup, reads the manual key from the page, enrols with an `otpauth` code, sees the recovery codes, reaches `/studio`, signs out, signs in again and passes the two-factor step. Save the authenticated storage state and TOTP secret to `test-results/.auth/super-admin.json` from a Playwright `setup` project that the Studio specs depend on. Then: the forgot-password flow reads the reset link from `.data/mail` with `readDevMail` and sets a new password; an invitation accepted as a new owner lands in their restaurant; the sign-in page in `ar` and `ckb` is right-to-left and passes axe.
- [ ] **Step 5: Run unit tests and the e2e spec.** Expected: PASS.
- [ ] **Step 6: Commit** (`feat(studio): design system, three-language shell and sign-in pages`).

---

### Task 12: Restaurants

**Files:**
- Create: `src/server/studio/services/restaurants.ts`, `src/server/studio/actions/restaurants.ts`, `src/server/studio/queries/restaurants.ts`, `src/app/studio/_actions/restaurants.ts`, `src/app/studio/(app)/restaurants/page.tsx`, `restaurants/new/page.tsx`, `restaurants/[id]/layout.tsx` (header and `RouteTabs`), `restaurants/[id]/page.tsx` (Profile), `restaurants/[id]/branches/page.tsx`, `restaurants/[id]/menus/page.tsx`, `restaurants/[id]/people/page.tsx`, `restaurants/[id]/activity/page.tsx`
- Test: `tests/studio/restaurants.test.ts`

**Interfaces:**
- Produces:
  - `formatClientId(n: number): string` (`BZ-0001`; more than 4 digits print in full) and `parseClientId(text: string): number | null` (case-insensitive, with or without the hyphen).
  - `restaurantInput` Zod schema: name 1 to 120 characters; type; description ≤ 2,000; address, city, country ≤ 200; phone and WhatsApp ≤ 32 and matching `^[+0-9 ()-]*$`; social links as `https://` URLs or empty; working hours as `{ mon..sun: Array<[HH:MM, HH:MM]> }`, at most 3 ranges per day, ranges may cross midnight; notes ≤ 5,000.
  - Actions: `createRestaurant(input) → { restaurantId }` (`restaurant.create`); `updateRestaurant({ restaurantId, version, ...input })` (`restaurant.edit`, `updateWithVersion`); `setRestaurantStatus({ restaurantId, status })` (`restaurant.status`; expires every menu slug's cache); `deleteRestaurant({ restaurantId, confirmName })` (`restaurant.delete`; only when it has no menus; `confirmName` must equal the name); `createBranch`, `updateBranch` (version), `deleteBranch`, `reorderBranches` (all `restaurant.edit`).
  - Queries: `listRestaurants({ q?, city?, type?, status?, createdFrom?, createdTo?, sort: 'name' | 'createdAt' | 'city', dir, page, pageSize: 50 }) → { rows: Array<{ id; clientId; name; type; city; status; menuCount; createdAt }>; total }` (`q` matches name, client ID, city; within `scope`); `getRestaurant({ restaurantId })`; `restaurantActivity({ restaurantId, page })` (`audit.view`).

- [ ] **Step 1: Write the failing tests:** create then list; filters and sorting; a designer lists only assigned restaurants; `BZ-0007`, `bz7` and `bz-0007` all find client 7; stale version → `CONFLICT`; delete refused while menus exist and when the typed name differs; suspending a restaurant makes its published menu `unavailable` through `resolvePublicMenu`; branch CRUD is audited.
- [ ] **Step 2: Run, expect FAIL. Step 3: Implement the services, actions, queries and pages** (list page uses `DataTable` with server paging and URL search params for filters; the profile form shows the conflict message from `CONFLICT`). **Step 4: Run, expect PASS.**
- [ ] **Step 5: Commit** (`feat(studio): restaurants with profiles, branches and status`).

---

### Task 13: Menus: create, All Menus, menu page, publish, status, slug, duplicate, delete, bulk

**Files:**
- Create: `src/server/domain/menu-status.ts`, `src/server/studio/services/menus.ts`, `src/server/studio/actions/menus.ts`, `src/server/studio/queries/menus.ts`, `src/app/studio/_actions/menus.ts`, `src/app/studio/(app)/menus/page.tsx`, `menus/new/page.tsx`, `menus/[id]/page.tsx`
- Test: `tests/domain/menu-status.test.ts`, `tests/studio/menus.test.ts`

**Interfaces:**
- Consumes: `publishMenu`, `loadDraftSnapshot`, `writeDraftFromSnapshot`, `refreshDraftHash`, `expireMenu` (Task 3); slug functions (Task 4); framework (Task 8).
- Produces:
  - `type StatusAction = 'suspend' | 'archive' | 'restore'` and `nextMenuStatus(current: MenuStatus, action: StatusAction, ctx: { hasLiveRevision: boolean; statusBeforeArchive: MenuStatus | null }): MenuStatus | null` (null = not allowed): DRAFT→archive→ARCHIVED; PUBLISHED→suspend→SUSPENDED, →archive→ARCHIVED; SUSPENDED→restore→PUBLISHED, →archive→ARCHIVED; ARCHIVED→restore→`statusBeforeArchive` (DRAFT when null).
  - `checkSlugAvailable(prisma, slug: string, forMenuId: string | null): Promise<'ok' | 'taken' | SlugProblem>` (a menu may reclaim one of its own historical slugs; tombstones and other menus' slugs are taken).
  - The `publish` action maps `PublishError('ARCHIVED')` to `StudioError('INVALID', ...)` and `PublishError('NOT_FOUND')` to `NOT_FOUND`.
  - Actions: `createMenu({ restaurantId, name, slug, locales, defaultLocale, currency, timezone, numeralSystem })` (`menu.create`; creates `Menu`, `MenuSlug`, a `BrandConfig` from the platform default palette and `logoText` = restaurant name, and the default daypart schedule; `draftHash` computed); `publish({ menuId, note? })` (`publish.now`; `INVALID` with `issues` in the error when blocked, warnings returned on success; `expireMenu`); `changeMenuStatus({ menuId, action })` (`menu.status`); `changeMenuSlug({ menuId, slug, version })` (`menu.settings`; adds `MenuSlug`, expires the old and new slug caches); `duplicateMenu({ menuId, name, slug, targetRestaurantId? })` (`menu.duplicate` on the source; a different target restaurant requires Super Admin; copies settings, brand and draft catalog with `writeDraftFromSnapshot`, copies tables; status DRAFT); `deleteMenu({ menuId, confirmName })` (`menu.delete`; ARCHIVED only; sets the menu's `MenuSlug` rows to tombstones, then deletes); `bulkMenuAction({ menuIds (1 to 200), action: 'publish' | StatusAction })` → `{ results: Array<{ menuId; ok: boolean; code?: ErrorCode; issues?: PublishIssue[] }> }` (target `self`, permission `null`; for each menu it calls `runAction` with the same actor on the single-menu definition (`publish` or `changeMenuStatus`), so scope, permission, transaction and audit are exactly those of the single actions).
  - Queries: `listMenus({ q?, status?, city?, restaurantId?, createdFrom?, createdTo?, unpublished?: boolean, sort: 'name' | 'restaurant' | 'status' | 'createdAt' | 'updatedAt', dir, page, pageSize: 50 }) → { rows: Array<{ id; name; slug; status; restaurant: { id; name; clientId; city; status }; liveRevisionNumber: number | null; unpublished: boolean; updatedAt }>; total }` (`q` matches menu name, slug, restaurant name and client ID; `unpublished` compares `draftHash` with `liveHash` through `prisma.menu.fields.liveHash`); `getMenu({ menuId })` (with live revision number, `wentLiveAt`, who published, public URL `${PUBLIC_MENU_ORIGIN}/${slug}`, draft issues from `validateForPublish(await loadDraftSnapshot(...))`); `slugAvailability({ slug, menuId? })`.
  - Pages: All Menus (filters in URL search params, row selection with a bulk bar and a result dialog listing each failure with its reason); New menu (slug suggested from the name with `suggestSlug(name, 'menu-' + clientNumber)`, live availability check with debounce); menu page (header with status, URL with copy and open, live revision, unpublished-changes badge, Publish with an issues dialog, status menu, change slug dialog, duplicate dialog, delete dialog with typed name for Super Admins).

- [ ] **Step 1: Write the failing tests**

```ts
// tests/domain/menu-status.test.ts: one case per transition in the list above, plus null for every pair not listed
```

```ts
// tests/studio/menus.test.ts
it('creates a menu whose slug resolves and is missing publicly until published', async () => { ... });
it('refuses a slug taken by another menu, a tombstone or a reserved word', async () => { ... });
it('lets a menu rename a → b → a and keeps redirects pointing at the current slug', async () => { ... });
it('publishes and returns warnings; blocked publish returns the issues and makes no revision', async () => { ... });
it('duplicates into a new independent draft: editing the copy leaves the source unchanged', async () => { ... });
it('refuses cross-restaurant duplicate for a designer', async () => { ... });
it('deletes only an archived menu with the exact typed name and keeps its slugs as tombstones', async () => { ... });
it('bulk-publishes 3 menus where one is blocked and reports each result', async () => { ... });
it('bulk action skips menus outside the designer scope with NOT_FOUND', async () => { ... });
it('lists unpublished menus only after a draft edit', async () => { ... });
it('finds a restaurant named "مطعم مازو" when searching "مازو"', async () => { ... });
it('filters by city, status and restaurant and sorts by restaurant name', async () => { ... });
```

- [ ] **Step 2: Run, expect FAIL. Step 3: Implement. Step 4: Run, expect PASS.**
- [ ] **Step 5: Commit** (`feat(studio): menus with publishing, status, permanent slugs, duplicate and bulk actions`).

---

### Task 14: People, Activity, Settings, Overview and Jump to

**Files:**
- Create: `src/server/studio/services/{overview,activity,settings,search}.ts`, matching `actions/` and `queries/` files, `src/app/studio/_actions/{settings,search}.ts`, `src/app/studio/(app)/page.tsx` (Overview), `people/page.tsx`, `activity/page.tsx`, `settings/page.tsx`; migration `<timestamp>_platform_settings`
- Modify: `prisma/schema.prisma` (`PlatformSetting { key String @id; value Json; updatedAt DateTime @updatedAt; updatedById String? }`, global), `src/studio/ui/CommandPalette.tsx`, `src/app/studio/(app)/layout.tsx` (mounts the palette, Ctrl+K and Cmd+K)
- Test: `tests/studio/settings.test.ts`, `tests/studio/overview.test.ts`, `tests/studio/search.test.ts`, `tests/studio/activity.test.ts`

**Interfaces:**
- Produces:
  - `PlatformSettings = { reservedSlugs: string[]; emailSenderName: string; defaults: { locales: Locale[]; defaultLocale: Locale; currency: string; timezone: string } }` with defaults `{ reservedSlugs: [], emailSenderName: 'Buzzify Studio', defaults: { locales: ['en', 'ar', 'ckb'], defaultLocale: 'en', currency: 'IQD', timezone: 'Asia/Baghdad' } }`; `getPlatformSettings(prisma)`; action `updatePlatformSettings(input)` (`platform.settings`; a reserved slug already used by a menu is refused with the menu's name). `checkSlugAvailable` and `createMenu` read `reservedSlugs`; `sendEmail` uses `emailSenderName` in the From name.
  - Query `overview() → { restaurants: Record<RestaurantStatus, number>; menus: Record<MenuStatus, number>; unpublished: Array<{ menuId; name; restaurantName; updatedAt }> (10); viewsLast7Days: number; recentActivity: AuditRow[] | null }` within scope (`recentActivity` only with `audit.view`). An owner opening `/studio` is redirected to their restaurant (or their only menu).
  - Query `listActivity({ actorId?, restaurantId?, menuId?, action?, from?, to?, page })` (`audit.view`) with rows showing actor name, action label from messages, entity, restaurant, menu and time.
  - Query `jump({ q })` (called from the palette through `invokeQuery`) → `{ restaurants: Array<{ id; name; clientId; city }>; menus: Array<{ id; name; slug; restaurantName; status }> }` (8 each, within scope; `q` of 1 to 80 characters; matches as in Tasks 12 and 13).
  - People page lists people and invitations with the Task 10 actions (invite staff, invite owner with a restaurant picker, revoke, resend with copy link, assign designer, deactivate and reactivate, change email). The restaurant People tab (Task 12 page) shows members and the per-client permission switches (one switch per grantable key, grouped by area, for designers and owners).

- [ ] **Step 1: Write the failing tests:** settings round-trip and refusal of a reserved slug already in use; a newly reserved word blocks `createMenu`; overview counts within a designer's scope; `jump('bz-0003')` finds client 3, `jump('atel')` finds the ATELIER restaurant and menu, `jump('مازو')` finds the Arabic-named restaurant; activity filters by actor and menu and is `FORBIDDEN` for designers.
- [ ] **Step 2: Run, expect FAIL. Step 3: Implement. Step 4: Run, expect PASS.**
- [ ] **Step 5: Commit** (`feat(studio): overview, people, activity, platform settings and Jump to`).

---

### Task 15: Development users and the 1,000-menu load seed

**Files:**
- Create: `prisma/seed/users.ts`, `prisma/seed-load.ts`, `tests/load/studio-lists.load.ts`, `vitest.load.config.ts`
- Modify: `prisma/seed.ts`, `package.json` (`"db:seed:load": "tsx prisma/seed-load.ts"`, `"test:load": "vitest run --config vitest.load.config.ts"`), `.env.example`
- Test: `tests/seed/users.test.ts`

**Interfaces:**
- Produces:
  - `seedDevUsers(prisma, atelierRestaurantId: string): Promise<void>`: when `NODE_ENV !== 'production'` and `DEV_SEED_PASSWORD` is set, creates `admin@buzzify.test` (Super Admin, two-factor not enrolled), `designer@buzzify.test` (Designer of ATELIER) and `owner@buzzify.test` (Owner of ATELIER), all with `DEV_SEED_PASSWORD`; idempotent. Throws when called with `NODE_ENV=production`. `.env.example` documents `DEV_SEED_PASSWORD="dev-only-change-me-2026"` as a development-only value.
  - `seedLoad(prisma, count = 1000)`: restaurants `Load Test 0001`… with cities from a fixed list of 8 Iraqi cities and alternating types, one menu each (`load-0001`…), one category and five products in three languages, published; batches of 50 with `createMany`; idempotent by deleting previous `load-` menus and `Load Test` restaurants first; two of them use Arabic names (`مطعم مازو`, `مقهى الربيع`) for search tests.
  - `tests/load/studio-lists.load.ts`: seeds once, then runs `listMenus` and `listRestaurants` through `runQuery` as the dev Super Admin 20 times each for: no filter, `q: 'load-07'`, `status: 'PUBLISHED'`, `city: 'Duhok'`, `unpublished: true`, sort by restaurant page 10; asserts the 95th percentile of each is under 300 ms.

- [ ] **Step 1: Write the failing test** `tests/seed/users.test.ts`: the three users exist with the right roles after `seedDevUsers`; a second call changes nothing; with `NODE_ENV=production` it throws.
- [ ] **Step 2: Run, expect FAIL. Step 3: Implement both seeds; call `seedDevUsers` from `prisma/seed.ts`. Step 4: Run, expect PASS.**
- [ ] **Step 5: Run `npm run test:load`.** Expected: every p95 under 300 ms. If one fails, add the missing index (reported query plan in the test output) and rerun.
- [ ] **Step 6: Commit** (`feat(seed): development users and a 1,000-menu load seed with list timing tests`).

---

### Task 16: End-to-end Studio flows and accessibility

**Files:**
- Create: `tests/e2e/studio-menus.spec.ts`, `tests/e2e/studio-owner.spec.ts`, `tests/e2e/studio-a11y.spec.ts`, `tests/e2e/helpers/studio.ts`
- Modify: `playwright.config.ts` (a `setup` project from Task 11 that `desktop` depends on; Studio specs are tagged `@desktop`)

**Interfaces:**
- Consumes: everything above; the `super-admin.json` storage state.

- [ ] **Step 1: Write `studio-menus.spec.ts`:** as Super Admin: create restaurant "E2E Bistro" (Erbil, Restaurant), duplicate the ATELIER menu into it as slug `e2e-bistro`, publish, open `/e2e-bistro` in a new page and see ATELIER's products under the new URL; change the slug to `e2e-bistro-2`, then open `/e2e-bistro/en/cart` and land on `/e2e-bistro-2/en/cart`; suspend and see the unavailable page; restore; archive; delete with the typed name; the old slug now answers 404 and cannot be reused in New menu. Clean up in `afterAll` through the database helper.
- [ ] **Step 2: Write `studio-owner.spec.ts`:** sign in as `owner@buzzify.test` (no two-factor), land in ATELIER, see no Restaurants list, no Settings, no Activity; requesting `/studio/restaurants/{loadTestRestaurantId}` gives 404; publishing ATELIER works (owners have `publish.now`); a Super Admin switches off `publish.now` for ATELIER owners on the People tab, and the owner's Publish button disappears after reload.
- [ ] **Step 3: Write `studio-a11y.spec.ts`:** axe on sign-in, Overview, Restaurants, All Menus, a menu page and People in `en`, `ar` and `ckb`; `dir="rtl"` for `ar` and `ckb`; every interactive control reachable by keyboard on All Menus (Tab through filters, select a row with Space, open the bulk menu with Enter); Ctrl+K opens Jump to and Enter opens the first result.
- [ ] **Step 4: Run `npm run db:seed && npm run test:e2e`.** Expected: all public and Studio specs PASS.
- [ ] **Step 5: Commit** (`test(e2e): Studio menus, owner scope and accessibility in three languages`).

---

### Task 17: Production configuration and deployment guide

**Files:**
- Create: `docs/deploy/production.md`, `vercel.json`
- Modify: `src/server/env.ts`, `prisma.config.ts`, `package.json` (`"vercel-build": "prisma generate && prisma migrate deploy && next build"`), `.env.example`, `README.md`
- Test: `tests/lib/env.test.ts`

**Interfaces:**
- Produces:
  - `env()` complete: `DATABASE_URL` (pooled, required in production), `DIRECT_DATABASE_URL` (migrations), `BETTER_AUTH_SECRET` (required in production, at least 32 characters), `BETTER_AUTH_URL`, `RESEND_API_KEY` (required in production), `EMAIL_FROM`, `PUBLIC_MENU_HOST`, `STUDIO_HOST`, `PUBLIC_MENU_ORIGIN`, `PUBLIC_ROOT_REDIRECT`, `DEV_SEED_PASSWORD` (refused in production). Parsed lazily on first use so `next build` needs no secrets; a missing production variable throws an error naming every missing variable.
  - `prisma.config.ts` uses `DIRECT_DATABASE_URL ?? DATABASE_URL ?? <embedded dev URL>`.
  - `vercel.json`: `{ "regions": ["fra1"] }` (cron arrives with scheduling in 2b).

- [ ] **Step 1: Write the failing test:** in production mode with variables missing, `env()` throws listing `BETTER_AUTH_SECRET` and `RESEND_API_KEY`; with `DEV_SEED_PASSWORD` set in production it throws; in development the defaults apply.
- [ ] **Step 2: Run, expect FAIL. Step 3: Implement. Step 4: Run, expect PASS.**
- [ ] **Step 5: Write `docs/deploy/production.md`**, for the user to follow (they create every account and enter every secret themselves): Vercel Pro project from the GitHub repository with region `fra1` and the environment variables; Neon project in `eu-central-1` with the pooled URL as `DATABASE_URL` and the direct URL as `DIRECT_DATABASE_URL`; Resend domain `buzzify.me` with the SPF, DKIM and DMARC records Resend shows; DNS records for `menu.buzzify.me` and `studio.buzzify.me` pointing at Vercel and both domains added to the project; generating `BETTER_AUTH_SECRET` with `openssl rand -base64 32`; first deploy; creating the first Super Admin by running `npm run studio:create-admin` locally with `DATABASE_URL` set to the Neon direct URL for that one command; enrolling two-factor; Neon point-in-time restore as the backup. Note current prices are checked on each provider's page before signing up.
- [ ] **Step 6: Update the README:** title "Buzzify Menu Studio"; what works now (public menus plus the Studio); new commands (`studio:create-admin`, `db:seed:load`, `test:load`); development sign-in (`admin@buzzify.test` with `DEV_SEED_PASSWORD`, two-factor enrolment on first sign-in); Studio at `http://127.0.0.1:3100/studio`; architecture additions (snapshots, live overlay, framework, permissions); link to the deployment guide; the machine-drafted translation notice now covering the Studio.
- [ ] **Step 7: Run `npm run typecheck && npm run lint && npm test && npm run build`.** Expected: all PASS; the build needs no production secrets.
- [ ] **Step 8: Commit** (`docs: production setup for Vercel, Neon and Resend; README for Studio Core`).

---

### Task 18: Final verification and performance check

**Files:**
- Create: `docs/perf/baseline-<date>-studio-core-2a.md`

- [ ] **Step 1:** `npm run db:up && npm run db:seed && npm test && npm run test:e2e && npm run test:load`. Expected: all PASS. Paste the summary lines into the commit message.
- [ ] **Step 2:** Stop the dev server, `npm run build && npm run start`, then `npm run perf`. Record the public menu's LCP and initial script against `docs/perf/baseline-2026-10-16.md`; the snapshot read path must not make either worse by more than measurement noise (report the numbers either way).
- [ ] **Step 3:** Check that no Studio module appears in the public menu's client chunks: search `.next/static/chunks` for the string `studio/ui` and for `better-auth`; expected: no match in chunks loaded by `/atelier/en`.
- [ ] **Step 4: Commit** (`docs(perf): baseline after Studio Core 2a`).

---

## Self-review notes

- Spec coverage for 2a (section 17): Restaurant and Menu split (Task 1); snapshot publishing and live overlay (Tasks 2 and 3); public routes and redirects (Task 4); accounts with invitations, reset and two-factor (Tasks 7, 9 and 10); permissions and audit (Tasks 5 and 8); the Studio shell in three languages with Jump to, Overview, Restaurants, All Menus, People, Activity and Settings (Tasks 11 to 14); deployment (Task 17). 2b items (workspace tabs, media, brand kit, QR codes, import and export, bulk prices, scheduling, rollback, new demo restaurants) are deliberately absent.
- Names used across tasks: `menuDb`, `scopedClient`, `loadDraftSnapshot`, `writeDraftFromSnapshot`, `publishMenu`, `getTenant`, `getCatalog(tenant)`, `defineAction`, `defineQuery`, `invoke`, `invokePublic`, `query`, `runAction`, `runQuery`, `StudioError`, `updateWithVersion`, `expireMenu`, `expireLive`, `createPasswordUser`, `checkRateLimit`, `getActor`, `effectivePermissions`, `parsePolicy`.
