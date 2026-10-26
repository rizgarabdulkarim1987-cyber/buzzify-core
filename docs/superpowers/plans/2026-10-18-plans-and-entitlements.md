# Plans and Entitlements Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Each restaurant has a plan (Basic, Pro, Premium) that decides which features its menus get; only the platform owner changes plans; locked features show an upgrade hint that opens the owner's WhatsApp; guests never see what the plan lacks, and a downgrade never breaks a published menu.

**Architecture:** A pure catalog and resolver (`src/server/domain/entitlements.ts`) turn a restaurant's plan, the platform's plan contents and the restaurant's extras into a set of feature keys; pure fallbacks (`src/server/domain/plan-choices.ts`) say what guests see instead of a locked choice. The Studio framework resolves entitlements next to permissions and refuses a locked feature with `UPGRADE_REQUIRED`. The public read path applies the fallbacks live when it resolves a slug, so snapshots, revisions and hashes never change.

**Tech Stack:** Next.js 16.4.1, React 19.3, TypeScript 5.9, Prisma 7.10 on PostgreSQL, Zod 4, Tailwind 4, Radix UI, Vitest 5, Playwright 1.64.

**Spec:** `docs/superpowers/specs/2026-10-18-plans-and-entitlements-design.md` (approved). Roadmap: `docs/superpowers/specs/2026-10-18-product-roadmap.md`. Conventions: `docs/superpowers/plans/2026-10-17-studio-core-2b-content.md` (its Global Constraints still apply).

**Base:** `main` at 6fd2227, branch `worktree-plans-and-entitlements` (this worktree). Execution: tasks in order, test first, one whole-branch review at the end (as Studio Core 2b was built).

## Global Constraints

- 2b's Global Constraints apply: Node 22.19 floor, exact version pins, no raw SQL outside migrations, locales `en`/`ar`/`ckb` with logical CSS, machine-drafted Arabic and Sorani flagged in the PR, Studio code never imported by `src/app/[tenant]`, `src/app/api/[tenant]` or `src/ui`, every Studio write and read through `defineAction`/`defineQuery`, commit after every task ending with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`, nothing pushed to `main`, `npm run db:up` before database tests.
- **Plans sell quality, never quantity:** no limit on menus, products, languages or media by plan, anywhere.
- **Plan keys:** `BASIC`, `PRO`, `PREMIUM`; default names English Basic / Pro / Premium, Arabic الأساسية / الاحترافية / المميزة, Sorani بنەڕەتی / پرۆ / پریمیەم (machine-drafted).
- **Live features and defaults (Basic / Pro / Premium):** `design.fontPairs` – ✓ ✓; `design.railStyles` – ✓ ✓; `design.expressiveMotion` – ✓ ✓; `qr.branded` – ✓ ✓; `publish.scheduling` – ✓ ✓; `selling.smart` – ✓ ✓; `immersive.explore` – – ✓; `immersive.stage` – – ✓.
- **Reserved features (project, default lowest plan):** `design.premiumTemplates` 2 Pro; `design.backgroundImage` 2 Pro; `design.backgroundVideo` 2 Premium; `design.motionPresets` 2 Pro; `guest.moodPicker` 3 Pro; `guest.livingPhotos` 3 Premium; `guest.stories` 3 Pro; `guest.occasionMoods` 3 Pro; `guest.drinkMatch` 3 Pro; `immersive.models3d` 4 Premium; `immersive.ar` 4 Premium; `ordering.tableBasket` 5 Premium; `table.callWaiter` 6 Pro; `loyalty.stampCard` 6 Pro; `share.dishCards` 6 Pro; `display.tvBoard` 6 Premium; `selling.limitedDrops` 6 Pro; `design.seasonalParticles` 6 Pro; `contact.whatsapp` 6 Basic. "Starts in X" means on in X and every plan above it.
- **Fallbacks:** font pairs without `design.fontPairs`: `classic` and `modern` only, a locked pair shows as `classic`; rails: `plain` always, `drum`/`flap`/`deck` need `design.railStyles`, `grains` needs `immersive.stage`; a rail not allowed becomes `deck` when `design.railStyles` is on, else `plain`; motion `expressive` without `design.expressiveMotion` becomes `subtle`; a QR style without `qr.branded` is drawn `#000000` on `#FFFFFF` without the logo (frame text kept).
- **The platform owner** is one account (`User.isPlatformOwner`, at most one true), a Super Admin; only it holds `plans.manage`. The upgrade button opens `https://wa.me/{digits}?text={message}` with the owner's number.
- **Audit:** new names `restaurant.plan_changed` (entity `RestaurantPlan`) and `plans.updated` (entity `Plans`) in `AUDIT_ACTIONS`/`AUDIT_ENTITY_TYPES` with `activity.action.*`/`activity.entity.*` labels in all three languages.
- **Cross-tenant sweep:** every new action and query gets its cases in `tests/studio/cross-tenant.test.ts` in the task that defines it.
- **UI work:** `impeccable`, then `21st-ui-build`, within the Studio tokens of `src/studio/studio.css`; follow existing Studio components (`PermissionSwitches.tsx` is the model for switch grids). Every Studio string in `src/studio/messages/{en,ar,ckb}.ts`.

## Spec refinements

Decisions made while planning; tell the user about them at handoff.

1. **`Restaurant.plan` defaults to `PREMIUM` in the database.** The migration then leaves every existing restaurant on Premium with no data step, and test fixtures that create restaurants directly keep every feature. The app never relies on the default: `restaurants.create` always writes a plan (the platform owner's choice, Basic preselected; anyone else's new restaurant is Basic whatever they send).
2. **No concurrency check on plan saves.** Only one account can change plans, so the last save wins; every save is audited.
3. **Storage:** plan contents in the `PlatformSetting` row `plans`, the WhatsApp number in `upgradeWhatsApp`. The Studio reads them per request; the public read path through the data cache under one tag, `plans`, which every slug resolution also carries.
4. **Reading Settings → Plans needs `platform.settings`** (every Super Admin); saving needs `plans.manage` (the owner).
5. **The Preview note lists only brand choices guests do not see** (font pair, rail, motion), not every feature the plan lacks.
6. **`UPGRADE_REQUIRED` failures carry `upgrade: { feature, plan }`.** A screen that expects one shows the upgrade hint at the control; anywhere else the toast says "This is part of the {plan} plan."
7. **Removing a person's Super Admin status has no action today**, so the owner's protection covers deactivation and email changes; a later action that demotes Super Admins must add the same guard.

## Review Focus

1. **A menu downgraded with locked choices, saved after changing only a colour,** is accepted and keeps the choices; choosing a locked one anew is refused with the hint. (Task 6)
2. **A guest arriving at `/explore` or `?rail=grains` on a Basic menu** (an old bookmark, a shared link) lands on the menu or the allowed rail, never a 404 or a blank. (Task 7)
3. **Another Super Admin reaching for plans by any door:** `plans.setRestaurantPlan`, `plans.update`, `restaurants.create` with `plan: 'PREMIUM'`, deactivating or re-addressing the owner: refused or ignored. (Tasks 3 and 5)
4. **A guest's cart holding a bundle when smart selling is switched off:** the line shows "This set is no longer offered" and the quote still answers. (Task 7)
5. **Plan contents changed while menus are cached:** every slug resolution expires with the `plans` tag, so guests do not wait five minutes. (Task 7)

## File structure

```
prisma/schema.prisma                           PlanTier; Restaurant.plan, planExtras, planNote; User.isPlatformOwner
prisma/migrations/<ts>_plans_and_platform_owner one-owner index; the first Super Admin becomes the owner
src/server/domain/entitlements.ts              the catalog, plan contents, extras, the resolver
src/server/domain/plan-choices.ts              fallbacks and locks for fonts, rails, motion, QR; guest features
src/server/domain/permissions.ts               plans.manage, owner-only
src/server/studio/framework/plan.ts            PlanAccess, requireFeature
src/server/studio/services/plans.ts            readPlans, readUpgradeWhatsApp, entitlementsFor, upgradeInfo
src/server/studio/actions/plans.ts             plans.setRestaurantPlan, plans.update
src/server/studio/queries/plans.ts             plans.forRestaurant, plans.get
src/studio/plans/UpgradeHint.tsx, whatsapp.ts  the hint and its link
src/app/studio/(studio)/(app)/restaurants/[id]/plan/   the Plan tab
src/app/studio/(studio)/(app)/settings/plans/          Settings → Plans
scripts/set-platform-owner.ts                  moves the owner flag from the terminal
tests/domain/entitlements.test.ts, plan-choices.test.ts; tests/studio/plans.test.ts; tests/e2e/plans.spec.ts
```

---

### Task 1: The catalog and the resolver (pure)

**Files:**
- Create: `src/server/domain/entitlements.ts`, `tests/domain/entitlements.test.ts`

**Interfaces:**
- Produces:
  - `PLAN_TIERS = ['BASIC', 'PRO', 'PREMIUM'] as const`, `type PlanTier`.
  - `type FeatureArea = 'design' | 'immersive' | 'publishing' | 'selling'`; `interface FeatureDef { key: string; area: FeatureArea; status: 'live' | 'reserved'; project: 1 | 2 | 3 | 4 | 5 | 6; startsIn: PlanTier }` (project 1 for the live ones).
  - `FEATURES: readonly FeatureDef[]` in the Global Constraints' order (live first), `type FeatureKey`, `FEATURE_KEYS`, `isFeatureKey(value: unknown): value is FeatureKey`.
  - `DEFAULT_PLAN_NAMES: Record<PlanTier, Record<Locale, string>>`.
  - `interface Plans { names: Record<PlanTier, Record<Locale, string>>; features: Record<PlanTier, ReadonlySet<FeatureKey>> }`; `parsePlans(json: unknown): Plans` (stored `{ [tier]: { names?: {…}, features?: { [key]: boolean } } }`; a key a tier does not hold takes the catalog default; unknown tiers, keys, non-boolean values and names that are not 1–40 characters are ignored); `plansToStore(plans: Plans): Record<PlanTier, { names: Record<Locale, string>; features: Record<FeatureKey, boolean> }>`; `defaultPlans(): Plans`.
  - `type PlanExtras = Partial<Record<FeatureKey, boolean>>`; `parseExtras(json: unknown): PlanExtras` (stored `{ features?: { [key]: boolean } }`); `extrasToStore(extras: PlanExtras): { features: Record<string, boolean> }`.
  - `interface Entitlements { plan: PlanTier; features: ReadonlySet<FeatureKey> }`; `effectiveEntitlements(args: { plan: PlanTier; plans: Plans; extras: PlanExtras }): Entitlements` (an extra wins over the plan); `allows(entitlements: Entitlements, key: FeatureKey): boolean`; `lowestPlanWith(plans: Plans, key: FeatureKey): PlanTier | null`; `featuresLost(before: Entitlements, after: Entitlements): FeatureKey[]` (live features only, catalog order).

- [ ] **Step 1: Write the failing tests**

```ts
it('starts each live feature where the spec says', () => {
  const plans = defaultPlans();
  const on = (tier: PlanTier) => [...plans.features[tier]].filter((k) => FEATURES.find((f) => f.key === k)!.status === 'live');
  expect(on('BASIC')).toEqual([]);
  expect(on('PRO')).toEqual(['design.fontPairs', 'design.railStyles', 'design.expressiveMotion', 'qr.branded', 'publish.scheduling', 'selling.smart']);
  expect(on('PREMIUM')).toHaveLength(8);
});
it('starts each reserved feature in its plan and every plan above', () => {
  expect(defaultPlans().features.BASIC.has('contact.whatsapp')).toBe(true);
  expect(defaultPlans().features.PRO.has('design.backgroundVideo')).toBe(false);
  expect(defaultPlans().features.PREMIUM.has('design.backgroundVideo')).toBe(true);
});
it('reads stored plan contents over the defaults and ignores what does not fit', () => {
  const plans = parsePlans({ BASIC: { features: { 'immersive.explore': true, 'made.up': true, 'design.fontPairs': 'yes' }, names: { en: 'Starter', ar: '' } }, GOLD: {} });
  expect(plans.features.BASIC.has('immersive.explore')).toBe(true);
  expect(plans.names.BASIC).toEqual({ en: 'Starter', ar: 'الأساسية', ckb: 'بنەڕەتی' });
});
it('lets an extra switch a feature on or off beyond the plan', () => {
  const e = effectiveEntitlements({ plan: 'BASIC', plans: defaultPlans(), extras: parseExtras({ features: { 'immersive.stage': true } }) });
  expect(allows(e, 'immersive.stage')).toBe(true);
  expect(allows(effectiveEntitlements({ plan: 'PREMIUM', plans: defaultPlans(), extras: { 'immersive.explore': false } }), 'immersive.explore')).toBe(false);
});
it('names the lowest plan with a feature, or null', () => { /* qr.branded → PRO; a feature off in all three → null */ });
it('lists the live features a change of plan takes away', () => { /* PREMIUM → BASIC gives the eight live keys in catalog order */ });
it('round-trips plans and extras through what is stored', () => { /* parsePlans(plansToStore(p)) equals p; same for extras */ });
```

- [ ] **Step 2: Run `npx vitest run tests/domain/entitlements.test.ts`.** Expected: FAIL (module not found).
- [ ] **Step 3: Implement `entitlements.ts`** in the style of `permissions.ts` (stored JSON untrusted, pure functions, no imports from the server beyond `@/lib/locale`).
- [ ] **Step 4: Run the test.** Expected: PASS.
- [ ] **Step 5: Commit** (`feat(plans): the feature catalog, plan contents and the entitlement resolver`).

---

### Task 2: Fallbacks and locks for choices (pure)

**Files:**
- Create: `src/server/domain/plan-choices.ts`, `tests/domain/plan-choices.test.ts`

**Interfaces:**
- Consumes: `Entitlements`, `allows`, `FeatureKey` (Task 1); `RailStyle`, `RAIL_STYLES` (`src/lib/rail.ts`); `FontPairId`, `FONT_PAIR_IDS` (`src/lib/font-pairs.ts`); `QrStyle`, `DEFAULT_QR_STYLE` (`src/server/domain/qr.ts`); `BrandView` (`src/server/data/tenant.ts`).
- Produces:
  - `type Motion = 'none' | 'subtle' | 'expressive'`; `interface BrandChoices { fontPairId: FontPairId; railStyle: RailStyle; motionIntensity: Motion }`.
  - `BASIC_FONT_PAIRS: readonly FontPairId[] = ['classic', 'modern']`; `allowedFontPairs(e): FontPairId[]`; `allowedRails(e): RailStyle[]` (in `RAIL_STYLES` order); `allowedMotions(e): Motion[]`; `bestRail(e): RailStyle` (grains, else deck, else plain).
  - `guestFontPair(id: FontPairId, e): FontPairId`; `guestRail(style: RailStyle, e): RailStyle`; `guestMotion(level: Motion, e): Motion`; `guestQrStyle(style: QrStyle, e): QrStyle`; `isBrandedQr(style: QrStyle): boolean` (colours other than black on white, or the logo).
  - `clampBrandView(view: BrandView, e): BrandView`: motion, then the rail (`plain` when motion is `none`, as `resolveRailStyle` does), then the font pair (`fontPairId` left out when it becomes `classic`); `railChoice` and everything else unchanged; the view given is not changed.
  - `clampBrandChoices(choices: BrandChoices, e): BrandChoices` (for a duplicated menu's brand row).
  - `brandChoiceLock(next: BrandChoices, stored: BrandChoices, e): FeatureKey | null`: the first locked choice that differs from the stored one (`design.fontPairs`, then the rail's key, then `design.expressiveMotion`).
  - `qrStyleLock(next: QrStyle, stored: QrStyle, e): 'qr.branded' | null`: refused only when the branded parts changed and are branded.
  - `hiddenChoices(stored: BrandChoices, e): FeatureKey[]`: the keys whose stored choice guests do not see.
  - `interface GuestFeatures { explore: boolean; stage: boolean; smartSelling: boolean; rails: RailStyle[] }`; `guestFeatures(e): GuestFeatures`.

- [ ] **Step 1: Write the failing tests**

```ts
const BASIC = effectiveEntitlements({ plan: 'BASIC', plans: defaultPlans(), extras: {} });
const PRO = effectiveEntitlements({ plan: 'PRO', plans: defaultPlans(), extras: {} });
const PREMIUM = effectiveEntitlements({ plan: 'PREMIUM', plans: defaultPlans(), extras: {} });

it('maps each rail to the closest one the plan allows', () => {
  expect(guestRail('grains', PRO)).toBe('deck');
  expect(guestRail('drum', BASIC)).toBe('plain');
  expect(guestRail('grains', PREMIUM)).toBe('grains');
  expect(bestRail(BASIC)).toBe('plain');
});
it('clamps a brand view without touching the one given', () => {
  const view = { ...SAMPLE_VIEW, motionIntensity: 'expressive', railStyle: 'drum', fontPairId: 'fine' } as BrandView;
  expect(clampBrandView(view, BASIC)).toMatchObject({ motionIntensity: 'subtle', railStyle: 'plain' });
  expect(clampBrandView(view, BASIC).fontPairId).toBeUndefined();
  expect(view.railStyle).toBe('drum');
});
it('keeps a locked choice that was already stored and refuses a new one', () => {
  const stored = { fontPairId: 'fine', railStyle: 'drum', motionIntensity: 'expressive' } as const;
  expect(brandChoiceLock(stored, stored, BASIC)).toBeNull();
  expect(brandChoiceLock({ ...stored, railStyle: 'deck' }, stored, BASIC)).toBe('design.railStyles');
  expect(brandChoiceLock({ ...stored, railStyle: 'grains' }, { ...stored, railStyle: 'plain' }, PRO)).toBe('immersive.stage');
});
it('draws a branded QR style plain on a plan without it, keeping the frame text', () => {
  expect(guestQrStyle({ foreground: '#123456', background: '#FFFFEE', logo: true, frameText: 'Scan' }, BASIC))
    .toEqual({ foreground: '#000000', background: '#FFFFFF', logo: false, frameText: 'Scan' });
});
it('refuses a newly branded QR style but not a kept one', () => { /* qrStyleLock */ });
it('lists the stored choices guests do not see', () => { /* hiddenChoices(stored, BASIC) → ['design.fontPairs', 'design.railStyles', 'design.expressiveMotion'] */ });
it('says which guest features a plan shows', () => {
  expect(guestFeatures(BASIC)).toEqual({ explore: false, stage: false, smartSelling: false, rails: ['plain'] });
  expect(guestFeatures(PREMIUM).rails).toEqual([...RAIL_STYLES]);
});
```

- [ ] **Step 2: Run `npx vitest run tests/domain/plan-choices.test.ts`.** Expected: FAIL.
- [ ] **Step 3: Implement `plan-choices.ts`.**
- [ ] **Step 4: Run the test.** Expected: PASS.
- [ ] **Step 5: Commit** (`feat(plans): what guests see instead of a locked choice, and when a choice is locked`).

---

### Task 3: The data, the platform owner and `plans.manage`

**Files:**
- Modify: `prisma/schema.prisma`; create the migration `prisma/migrations/<timestamp>_plans_and_platform_owner/migration.sql` with `npx prisma migrate dev --create-only`, then add the two SQL statements below to it
- Modify: `src/server/domain/permissions.ts`, `src/server/studio/auth/actor.ts`, `src/server/studio/framework/access.ts` (`platformPermissions`, `resolveAccess`), `src/server/studio/auth/users.ts` (`createPasswordUser`), `scripts/create-admin.ts`, `prisma/seed/users.ts`, `src/server/studio/services/people.ts` (`deactivatePerson`, `changeEmail`), `src/studio/errors.ts`, `src/studio/messages/{en,ar,ckb}.ts`, `package.json`
- Create: `scripts/set-platform-owner.ts`
- Test: `tests/domain/permissions.test.ts`, `tests/studio/actor.test.ts`, `tests/studio/people.test.ts`, `tests/studio/create-admin.test.ts`, `tests/data/tenant-db.test.ts` (or wherever the schema is exercised)

**Interfaces:**
- Produces:
  - Prisma `enum PlanTier { BASIC PRO PREMIUM }`; `Restaurant.plan PlanTier @default(PREMIUM)` with `@@index([plan])`; `Restaurant.planExtras Json @default("{}")`; `Restaurant.planNote String @default("")`; `User.isPlatformOwner Boolean @default(false)`.
  - Migration SQL after Prisma's own: `CREATE UNIQUE INDEX "User_one_platform_owner" ON "User" ("isPlatformOwner") WHERE "isPlatformOwner";` and `UPDATE "User" SET "isPlatformOwner" = true WHERE "id" = (SELECT "id" FROM "User" WHERE "isSuperAdmin" ORDER BY "createdAt" ASC, "id" ASC LIMIT 1);`
  - `'plans.manage'` in `PERMISSIONS` (a `// Plans` group after Platform), in `NEVER_GRANTABLE`; `OWNER_ONLY_PERMISSIONS: readonly Permission[] = ['plans.manage']`; `effectivePermissions(args: { isSuperAdmin: boolean; isPlatformOwner?: boolean; role: MemberRole | null; policy: PermissionPolicy })` gives a Super Admin every key except the owner-only ones unless `isPlatformOwner`.
  - `Actor.isPlatformOwner: boolean` (true only when the user is also a Super Admin).
  - `createPasswordUser(prisma, args: { …; isPlatformOwner?: boolean })`.
  - `npm run studio:set-platform-owner` (`tsx scripts/set-platform-owner.ts`): asks for an email, refuses unless it is an active Super Admin, prints the current owner, asks to confirm, then clears the flag everywhere and sets it on that account in one transaction.
  - Server text `'Only the platform owner can change this account'` (`StudioError('FORBIDDEN', …)`) mapped to `error.text.platformOwnerOnly`.

- [ ] **Step 1: Write the failing tests**

```ts
// tests/domain/permissions.test.ts
it('gives plans.manage to the platform owner only', () => {
  expect(effectivePermissions({ isSuperAdmin: true, isPlatformOwner: true, role: null, policy: {} }).has('plans.manage')).toBe(true);
  expect(effectivePermissions({ isSuperAdmin: true, role: null, policy: {} }).has('plans.manage')).toBe(false);
  expect(parsePolicy({ DESIGNER: { grant: ['plans.manage'], revoke: [] } }).DESIGNER?.grant).toEqual([]);
});
// tests/studio/actor.test.ts
it('marks the platform owner, and never a person who is not a Super Admin', async () => { /* loadActor */ });
it('allows at most one platform owner', async () => { /* a second user with isPlatformOwner: true → unique violation */ });
// tests/studio/people.test.ts
it('refuses another Super Admin deactivating the platform owner or changing their email', async () => {
  expect(failureOf(await runAs(otherAdmin, people.deactivateUser, { userId: owner.userId }))).toMatchObject({ code: 'FORBIDDEN', message: 'Only the platform owner can change this account' });
});
// tests/studio/create-admin.test.ts
it('makes the first Super Admin the platform owner and a forced second one not', async () => { /* … */ });
```

- [ ] **Step 2: Run them.** Expected: FAIL.
- [ ] **Step 3: Change the schema, create the migration, add the SQL, run `npx prisma migrate dev`** on the development database (which has users) and check with `npx prisma studio` or a query that exactly one user, the oldest Super Admin, is the owner and that every restaurant is `PREMIUM`.
- [ ] **Step 4: Implement the permission, actor, access, users, create-admin, seed users, people guards and the new script.** `prisma/seed/users.ts` makes `admin@buzzify.test` the owner.
- [ ] **Step 5: Run `npm test`.** Expected: PASS (existing permission tests that list a Super Admin's keys gain the owner case).
- [ ] **Step 6: Commit** (`feat(plans): restaurant plans in the data, and the platform owner who alone manages them`).

---

### Task 4: Entitlements in the Studio framework

**Files:**
- Create: `src/server/studio/framework/plan.ts`, `src/server/studio/services/plans.ts`
- Modify: `src/server/studio/framework/access.ts`, `action.ts`, `query.ts`, `result.ts`, `src/studio/errors.ts`, `src/studio/messages/{en,ar,ckb}.ts`
- Test: `tests/studio/framework.test.ts`, `tests/studio/errors.test.ts`

**Interfaces:**
- Consumes: Task 1, Task 3.
- Produces:
  - `readPlans(db: AnyDb | ScopedDb): Promise<Plans>` (row `plans`), `readUpgradeWhatsApp(db): Promise<string | null>` (row `upgradeWhatsApp`), `entitlementsOf(restaurant: { plan: PlanTier; planExtras: unknown }, plans: Plans): Entitlements` (pure), `entitlementsFor(db: AnyDb | ScopedDb, restaurantId: string): Promise<Entitlements>` (reads the row and the plans).
  - `interface PlanAccess { entitlements: Entitlements; plans: Plans }`; `Access.plan: PlanAccess | null` (null on platform and self targets); `ActionContext.plan` and `QueryContext.plan` the same.
  - `defineAction`/`defineQuery` specs take `feature?: FeatureKey`; `checkDefinition` throws on an unknown key; `resolveAccess` throws (a bug) when a definition with a feature reaches a platform or self target; after the permission check, a restaurant without the feature is refused.
  - `ErrorCode` gains `'UPGRADE_REQUIRED'` (default message `'This is not part of this restaurant’s plan'`); `StudioFailure.upgrade?: { feature: FeatureKey; plan: PlanTier | null }`; `StudioError` carries it; `failure()`/`expectedFailure()` pass it through.
  - `requireFeature(plan: PlanAccess | null, key: FeatureKey): void` throws `StudioError('UPGRADE_REQUIRED', …, { feature: key, plan: lowestPlanWith(plans, key) })`.
  - Studio message `error.UPGRADE_REQUIRED`: "This is part of the {plan} plan." (and `error.UPGRADE_REQUIRED_none`: "This isn't part of any plan yet." when `plan` is null).

- [ ] **Step 1: Write the failing tests** (`tests/studio/framework.test.ts`)

```ts
const gated = defineAction({ name: 'test.gated', permission: 'brand.edit', feature: 'design.fontPairs',
  input: z.object({ restaurantId: z.string() }), target: (i) => ({ kind: 'restaurant', restaurantId: i.restaurantId }), run: async (ctx) => ctx.plan?.entitlements.plan });
it('refuses a feature the restaurant lacks, naming the lowest plan with it', async () => {
  await prisma.restaurant.update({ where: { id: a.id }, data: { plan: 'BASIC' } });
  expect(failureOf(await runAction(prisma, designerOfA, gated, { restaurantId: a.id }, META))).toMatchObject({ code: 'UPGRADE_REQUIRED', upgrade: { feature: 'design.fontPairs', plan: 'PRO' } });
});
it('runs it on a plan that has it, with the plan in the context', async () => { /* PREMIUM → data 'PREMIUM' */ });
it('checks the permission first', async () => { /* an owner (no brand.edit) on BASIC → FORBIDDEN */ });
it('honours an extra over the plan', async () => { /* BASIC with planExtras { features: { 'design.fontPairs': true } } → runs */ });
it('refuses an unknown feature when the definition is made', () => { expect(() => defineAction({ …, feature: 'made.up' as never })).toThrow(); });
it('gives queries the plan and refuses their feature the same way', async () => { /* defineQuery with feature */ });
```

- [ ] **Step 2: Run `npx vitest run tests/studio/framework.test.ts`.** Expected: FAIL.
- [ ] **Step 3: Implement.** `locate()` selects `plan` and `planExtras` with `permissionPolicy` (for a menu target through `menu.restaurant`); `resolveAccess` reads `readPlans(prisma)` once for a restaurant or menu target.
- [ ] **Step 4: Run `npm test`.** Expected: PASS, including `tests/studio/messages.test.ts` (new server text mapped, new keys in all three languages).
- [ ] **Step 5: Commit** (`feat(plans): the Studio framework checks a restaurant's plan next to the person's permissions`).

---

### Task 5: Plan actions and queries; plans on restaurants

**Files:**
- Create: `src/server/studio/actions/plans.ts`, `src/server/studio/queries/plans.ts`, `tests/studio/plans.test.ts`
- Modify: `src/server/studio/services/plans.ts` (`upgradeInfo`), `src/server/data/cache.ts` (`PLANS_TAG`, `cachedPlans`, `expirePlans`; `cachedSlugResolution` also carries `PLANS_TAG`) with its cases in `tests/data/cache.test.ts`, `src/server/domain/audit-actions.ts`, `src/server/studio/actions/restaurants.ts` (`createRestaurant`), `src/server/studio/services/restaurants.ts` (`restaurantInput.plan`), `src/server/studio/queries/restaurants.ts` (`listRestaurants` plan filter and column; `getRestaurant` `plan` and `can.plans`), `src/studio/messages/{en,ar,ckb}.ts` (activity labels), `tests/studio/cross-tenant.test.ts`, `tests/studio/restaurants.test.ts`

**Interfaces:**
- Consumes: Tasks 1, 3, 4; `menuAddresses(tx)` and `expireMenu` as `restaurants.setStatus` uses them.
- Produces:
  - `setRestaurantPlan` (`'plans.setRestaurantPlan'`, permission `plans.manage`, restaurant target), input `{ restaurantId, plan: z.enum(PLAN_TIERS), extras: z.record(z.string().max(64), z.boolean()).default({}), note: z.string().max(2000) }`; stores `plan`, `extrasToStore(parseExtras({ features: extras }))`, `note`; audits `restaurant.plan_changed` (entity `RestaurantPlan`, id the restaurant) with `plan`, `extras` and `note` changes; after commit expires every address of the restaurant's menus; returns `{ plan, extras, note }`.
  - `updatePlans` (`'plans.update'`, permission `plans.manage`, platform target), input `{ plans: Record<PlanTier, { names: { en, ar, ckb } (1–40 chars, trimmed), features: z.record(z.string().max(64), z.boolean()) }>, whatsapp: string }` where `whatsapp` is empty or 8–15 digits after removing spaces, `+`, `-` and parentheses (message `'Enter the number with its country code, digits only'`); stores `plansToStore(parsePlans(input.plans))` in `plans` and the digits in `upgradeWhatsApp`; audits `plans.updated` (entity `Plans`, id `plans`); after commit `expirePlans()`.
  - `restaurantPlan` (`'plans.forRestaurant'`, permission `view`, restaurant target) → `interface PlanTabView { plan: PlanTier; planNames: Record<PlanTier, string>; features: Array<{ key: FeatureKey; area: FeatureArea; allowed: boolean; inPlan: boolean; extra: boolean | null; lowestPlan: PlanTier | null }> (live features only); note: string | null (Super Admins only); canEdit: boolean; upgrade: UpgradeInfo }`, names in the reader's Studio language.
  - `PLANS_TAG = 'plans'`; `cachedPlans<T>(load: () => Promise<T>): Promise<T>` (revalidate 300, tag `plans`); `expirePlans(): void`; `cachedSlugResolution` tags `[slug:…, plans]`.
  - `getPlans` (`'plans.get'`, permission `platform.settings`, platform target) → `{ plans: ReturnType<typeof plansToStore>; whatsapp: string; features: FeatureDef[]; canEdit: boolean }`.
  - `interface UpgradeInfo { restaurantName: string; whatsapp: string | null; isOwner: boolean; planNames: Record<PlanTier, string>; allowed: FeatureKey[]; lowest: Partial<Record<FeatureKey, PlanTier>>; planTabHref: string }`; `upgradeInfo(ctx: QueryContext): Promise<UpgradeInfo>`.
  - `createRestaurant` writes `plan`: the input's `plan` (optional, `z.enum(PLAN_TIERS)`) when the actor is the platform owner, `BASIC` otherwise.
  - `listRestaurants` input `plan?: PlanTier`; rows gain `plan`.

- [ ] **Step 1: Write the failing tests** (`tests/studio/plans.test.ts`)

```ts
it('lets the platform owner move a restaurant to Basic, and guests see it at once', async () => {
  dataOf(await runAs(owner, plans.setRestaurantPlan, { restaurantId: a.restaurant.id, plan: 'BASIC', extras: {}, note: 'Paid until March' }));
  expect((await getTenant(a.menu.slug))!.features).toEqual({ explore: false, stage: false, smartSelling: false, rails: ['plain'] });
  expect(await auditRow('restaurant.plan_changed')).toMatchObject({ changes: { plan: { before: 'PREMIUM', after: 'BASIC' } } });
});
it('refuses every plan action to another Super Admin, a designer and an owner', async () => { /* FORBIDDEN ×3 for both actions */ });
it('keeps the note from owners and designers', async () => { /* plans.forRestaurant as owner → note null; as other Super Admin → note */ });
it('changes what a plan holds for every restaurant on it', async () => { /* updatePlans BASIC immersive.explore true → a Basic restaurant's tenant.features.explore true */ });
it('refuses a WhatsApp number that is not digits with a country code', async () => { /* '07501234567x' → INVALID */ });
it('creates a restaurant on the owner’s chosen plan, and on Basic for anyone else', async () => {
  const { restaurantId } = dataOf(await runAs(otherAdmin, restaurants.createRestaurant, { ...PROFILE, plan: 'PREMIUM' }));
  expect((await prisma.restaurant.findUniqueOrThrow({ where: { id: restaurantId } })).plan).toBe('BASIC');
});
it('filters the restaurant list by plan', async () => { /* listRestaurants { plan: 'BASIC' } */ });
// tests/data/cache.test.ts
it('tags every slug resolution with plans, and expirePlans expires it', () => { /* as the existing expiry cases */ });
```

Cross-tenant: `plans.forRestaurant` in `SWEPT`; `plans.setRestaurantPlan`, `plans.update` and `plans.get` in `PLATFORM_ONLY`.

- [ ] **Step 2: Run them.** Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run `npm test`.** Expected: PASS (the activity test checks the new labels).
- [ ] **Step 5: Commit** (`feat(plans): the platform owner sets a restaurant's plan and edits the plans`).

---

### Task 6: Locks in the existing Studio actions

**Files:**
- Modify: `src/server/studio/services/brand.ts` (`updateBrand`; the `brand.get` view), `src/server/studio/queries/brand.ts`, `src/server/studio/actions/menus.ts` (`createMenu`, `duplicateMenu`), `src/server/studio/services/qr.ts` (`updateQrCode`, `applyQrStyle`, `downloadQrCode`, `downloadTableCodes`, `previewQrCode`, `listQrCodes`), `src/server/studio/queries/qr.ts`, `src/server/studio/actions/revisions.ts` (`schedule`), `src/server/studio/queries/revisions.ts` (`revisions.list` gains `upgrade`)
- Test: `tests/studio/brand.test.ts`, `tests/studio/menus.test.ts`, `tests/studio/qr.test.ts`, `tests/publish/revisions.test.ts`

**Interfaces:**
- Consumes: Task 2's locks and fallbacks, Task 4's `requireFeature` and `ctx.plan`, Task 5's `upgradeInfo` and `entitlementsFor`.
- Produces:
  - `updateBrand` compares the input's choices with the stored row (the defaults when there is none) through `brandChoiceLock` and refuses with `UPGRADE_REQUIRED` for the key it returns.
  - The `brand.get` result gains `plan: { fontPairs: FontPairId[]; rails: RailStyle[]; motions: Motion[]; hidden: FeatureKey[]; upgrade: UpgradeInfo }`.
  - `createMenu` writes `railStyle: bestRail(ctx.plan.entitlements)` in the new brand row.
  - `duplicateMenu`, after `writeDraftFromSnapshot`, rewrites the new brand row's font pair, rail and motion with `clampBrandChoices` under the destination restaurant's entitlements (`entitlementsFor` on that restaurant).
  - `updateQrCode` refuses `qrStyleLock(...)`; `applyQrStyle` refuses a branded source on a plan without `qr.branded`; every drawing (list, preview, download, table ZIP) uses `guestQrStyle`; `qr.list` gains `upgrade: UpgradeInfo` and `branded: boolean`.
  - `revisions.schedule` gets `feature: 'publish.scheduling'`; `revisions.cancelSchedule` and the cron do not; `revisions.list` gains `canSchedule: boolean` and `upgrade: UpgradeInfo`.

- [ ] **Step 1: Write the failing tests**

```ts
// brand.test.ts
it('keeps a locked choice a downgraded menu already has, and refuses choosing one anew', async () => {
  await save({ railStyle: 'drum', fontPairId: 'fine', motionIntensity: 'expressive' });       // on Premium
  await setPlan('BASIC');
  dataOf(await run(brand.update, { ...current(), palette: OTHER_PALETTE }));                   // kept: accepted
  expect(failureOf(await run(brand.update, { ...current(), railStyle: 'flap' }))).toMatchObject({ code: 'UPGRADE_REQUIRED', upgrade: { feature: 'design.railStyles', plan: 'PRO' } });
});
// menus.test.ts
it('starts a Basic restaurant’s new menu on the plain rail and a Premium one on grains', async () => { /* … */ });
it('brings a duplicated menu within the plan of the restaurant it lands in', async () => { /* Premium source with drum/fine/expressive → Basic target: plain/classic/subtle; the source unchanged */ });
// qr.test.ts
it('refuses giving a code brand colours on Basic and draws a kept branded code plain', async () => { /* … */ });
it('refuses applying a branded style to the other codes on Basic', async () => { /* … */ });
// revisions.test.ts
it('refuses scheduling on Basic but still publishes what was scheduled before the downgrade', async () => { /* schedule on PRO, setPlan BASIC, run the cron → live; schedule again → UPGRADE_REQUIRED */ });
```

- [ ] **Step 2: Run them.** Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run `npm test`.** Expected: PASS.
- [ ] **Step 5: Commit** (`feat(plans): brand, QR codes, new and duplicated menus, and scheduling follow the plan`).

---

### Task 7: What guests get

**Files:**
- Modify: `src/server/data/tenant.ts` (`TenantInfo.features`), `src/server/data/public-menu.ts` (`findPublicMenu`, `tenantInfo`, `getCatalog`), `src/server/studio/queries/preview.ts`, `src/server/studio/queries/revisions.ts` (`revisions.view`), `src/app/[tenant]/[locale]/layout.tsx`, `src/app/studio/(preview)/preview/[menuId]/[locale]/layout.tsx`, `src/app/studio/(preview)/preview/[menuId]/revision/[revisionId]/[locale]/layout.tsx`, `src/app/[tenant]/[locale]/explore/page.tsx`, `src/ui/AppProviders.tsx` (`TenantClientInfo.features`), `src/ui/menu/Header.tsx`, `src/ui/menu/CategoryRail.tsx` (`useRailStyle`), `src/ui/menu/SignatureFeature.tsx`, `src/ui/product/ProductDetail.tsx`
- Test: `tests/data/public-menu.test.ts`, `tests/studio/preview.test.ts`, `tests/api/routes.test.ts` (quote with a bundle)

**Interfaces:**
- Consumes: Task 2 (`clampBrandView`, `guestFeatures`), Task 4 (`readPlans`, `entitlementsOf`, `entitlementsFor`), Task 5 (`cachedPlans`).
- Produces:
  - `TenantInfo.features: GuestFeatures`; `tenantInfo(menu, revisionId, snapshot, entitlements: Entitlements)` returns the brand clamped and the features; every caller passes the menu's restaurant's entitlements.
  - `findPublicMenu` selects `restaurant: { select: { status: true, plan: true, planExtras: true } }` and reads the plans through `cachedPlans(() => readPlans(prisma))`.
  - `getCatalog(tenant)` leaves out `upsellRules`, `pairingRules` and `bundles` when `!tenant.features.smartSelling`.
  - `TenantClientInfo.features: { explore: boolean; stage: boolean; rails: RailStyle[] }`.
  - The Explore page redirects (`redirect`, 307) to `/${slug}/${locale}${search}` when `!route.tenant.features.explore`; `Header` renders `ModeSwitch` only when `features.explore`; `useRailStyle` honours `?rail=` only for a style in `features.rails`; the signature dish and the product detail render `ProductStage` only when `features.stage`.

- [ ] **Step 1: Write the failing tests**

```ts
// tests/data/public-menu.test.ts
it('serves a Basic menu with the fallbacks and the guest features off, without touching its revision', async () => {
  await brandRow({ railStyle: 'drum', fontPairId: 'fine', motionIntensity: 'expressive' }); await publishFixture(prisma, a.menu.id);
  const hashBefore = (await prisma.menu.findUniqueOrThrow({ where: { id: a.menu.id } })).liveHash;
  await prisma.restaurant.update({ where: { id: a.restaurant.id }, data: { plan: 'BASIC' } });
  const tenant = (await getTenant(a.menu.slug))!;
  expect(tenant.brand).toMatchObject({ railStyle: 'plain', motionIntensity: 'subtle' });
  expect(tenant.brand.fontPairId).toBeUndefined();
  expect((await prisma.menu.findUniqueOrThrow({ where: { id: a.menu.id } })).liveHash).toBe(hashBefore);
});
it('serves no upsell rules, pairings or bundles without smart selling', async () => { /* seedAtelier, plan BASIC → getCatalog: [] ×3 */ });
// tests/studio/preview.test.ts
it('previews the draft as guests on the restaurant’s plan would see it', async () => { /* … */ });
// tests/api/routes.test.ts
it('quotes a cart whose bundle smart selling no longer offers, with the line marked', async () => { /* UNKNOWN_BUNDLE issue, 200 */ });
```

- [ ] **Step 2: Run them.** Expected: FAIL.
- [ ] **Step 3: Implement**, server first, then the three layouts and the four UI files.
- [ ] **Step 4: Run `npm test`, then `npx playwright test tests/e2e/explore.spec.ts tests/e2e/menu.spec.ts`** (ATELIER stays Premium, so they pass unchanged). Expected: PASS.
- [ ] **Step 5: Commit** (`feat(plans): guests get only what the restaurant's plan includes, with no republish`).

---

### Task 8: The upgrade hint, the Plan tab and plans on the restaurant screens

**Files:**
- Create: `src/studio/plans/whatsapp.ts`, `src/studio/plans/UpgradeHint.tsx`, `src/app/studio/(studio)/(app)/restaurants/[id]/plan/page.tsx`, `src/app/studio/(studio)/(app)/restaurants/[id]/plan/PlanEditor.tsx`, `tests/studio/plans-ui.test.ts`
- Modify: `src/app/studio/(studio)/(app)/restaurants/[id]/layout.tsx` (a Plan tab for everyone), `[id]/load.ts` (`tabMetadata` 'plan'), `restaurants/RestaurantForm.tsx` (plan choice on the new-restaurant form, shown to the platform owner only), `restaurants/RestaurantsTable.tsx` (Plan column), `restaurants/RestaurantFilters.tsx` (plan filter), `src/studio/messages/{en,ar,ckb}.ts`

**Interfaces:**
- Consumes: `PlanTabView`, `UpgradeInfo`, `setRestaurantPlan` (Task 5); `featuresLost` (Task 1).
- Produces:
  - `upgradeLink(digits: string, text: string): string` → `https://wa.me/${digits}?text=${encodeURIComponent(text)}`; `upgradeMessage(t, info: UpgradeInfo, feature: FeatureKey): string` ("Hello, I'd like {feature} for {restaurant}: it's in the {plan} plan.").
  - `<UpgradeHint feature={FeatureKey} info={UpgradeInfo} compact?={boolean} />`: a lock, "Part of {plan}"; for the owner a "Change plan" link to `info.planTabHref`; for everyone else the WhatsApp button when `info.whatsapp` is set (opens in a new tab), else the text alone.
  - The Plan tab: the plan's name; the live features by area with a tick or a lock and "In {plan}"; the hint; for the owner, the plan (three cards), each feature's extra (As the plan / On / Off), the note, Save; before a save where `featuresLost` is not empty, a `ConfirmDialog` listing what guests will stop seeing.

- [ ] **Step 1: Write the failing tests** (`tests/studio/plans-ui.test.ts`, pure)

```ts
it('builds the WhatsApp link with the message encoded', () => {
  expect(upgradeLink('9647501234567', 'Hi & bye')).toBe('https://wa.me/9647501234567?text=Hi%20%26%20bye');
});
it('names the restaurant, the feature and the plan in the message, in the reader’s language', () => { /* en and ar */ });
```

- [ ] **Step 2: Run them.** Expected: FAIL.
- [ ] **Step 3: Build the components and pages** (`impeccable`, then `21st-ui-build`, in the Studio's components; RTL checked in Arabic).
- [ ] **Step 4: Run `npm test && npm run lint && npm run typecheck`, then open the dev server** (`preview_start`), sign in as `admin@buzzify.test`, open ATELIER → Plan, switch to Basic, confirm, check the guest menu, switch back. Check the tab as `owner@buzzify.test` (read-only with the WhatsApp button once a number is set). Screenshot both.
- [ ] **Step 5: Commit** (`feat(plans): the Plan tab, the upgrade hint and plans on the restaurant list`).

---

### Task 9: Settings → Plans

**Files:**
- Create: `src/app/studio/(studio)/(app)/settings/plans/page.tsx`, `src/app/studio/(studio)/(app)/settings/plans/PlansEditor.tsx`
- Modify: `src/app/studio/(studio)/(app)/settings/page.tsx` (tabs General / Plans with `RouteTabs`), `src/studio/messages/{en,ar,ckb}.ts`

**Interfaces:**
- Consumes: `getPlans`, `updatePlans` (Task 5).
- Produces: the three plans side by side, names in three languages, every live feature as a switch per plan, the reserved ones under "Coming later" with "Not built yet" and their project number, the WhatsApp number; read-only for Super Admins who are not the owner.

- [ ] **Step 1: Build the page** (`impeccable`, then `21st-ui-build`).
- [ ] **Step 2: Run `npm test && npm run lint && npm run typecheck`; on the dev server, as the owner, give Basic `immersive.explore`, save, check ATELIER-on-Basic's guest menu shows Explore, undo.** Screenshot the page in Arabic.
- [ ] **Step 3: Commit** (`feat(plans): the platform owner edits the plans and the WhatsApp number in Settings`).

---

### Task 10: Locks where the features are

**Files:**
- Modify: `src/studio/workspace/brand/BrandForm.tsx`, `src/studio/workspace/brand/FontPairPicker.tsx` (and the rail and motion pickers inside `BrandForm`), `src/studio/workspace/QrCodes.tsx`, `src/studio/workspace/ScheduleDialog.tsx`, `src/app/studio/(studio)/(app)/menus/[id]/MenuActions.tsx` (the Schedule entry), `src/studio/workspace/RevisionsTable.tsx`, `src/studio/workspace/PreviewFrames.tsx`, `src/server/studio/queries/preview.ts` (`hidden: FeatureKey[]`, `upgrade`), `src/studio/messages/{en,ar,ckb}.ts`

**Interfaces:**
- Consumes: `brand.get`'s `plan`, `qr.list`'s `upgrade`/`branded`, `revisions.list`'s `canSchedule`/`upgrade` (Task 6), `UpgradeHint` (Task 8).
- Produces:
  - Brand: a pair, rail or motion level the plan lacks shows a lock and the hint instead of being chosen; a stored one guests do not see is marked "Guests see {fallback} until the plan includes {choice}".
  - QR codes: colours and the logo switch locked with the hint; frame text open.
  - Schedule: the entry shows the hint instead of the dialog when `!canSchedule`.
  - Preview: a note listing `hidden` with the hint.
  - Any action answer with `UPGRADE_REQUIRED` that reaches a generic error display shows `error.UPGRADE_REQUIRED` with the plan's name.

- [ ] **Step 1: Build** (`impeccable`, then `21st-ui-build`).
- [ ] **Step 2: Run `npm test && npm run lint && npm run typecheck`; on the dev server, with ATELIER on Basic, check each lock as a designer and as the owner** (`designer@buzzify.test`, `owner@buzzify.test`), in English and Arabic. Screenshot the Brand tab locks.
- [ ] **Step 3: Commit** (`feat(plans): locked choices show the upgrade hint in the Brand, QR, Revisions and Preview tabs`).

---

### Task 11: Demo plans, the end-to-end flow and the docs

**Files:**
- Modify: `prisma/seed.ts` (plans on create only: ATELIER `PREMIUM`, Riverlight `PRO`, Hot Brick `BASIC`), `prisma/seed-load.ts` (the i-th restaurant on `PLAN_TIERS[i % 3]`), `tests/seed/demo-menus.test.ts`, `README.md` (plans and the platform owner), `docs/deploy/hostinger.md` (after this deploy: set the WhatsApp number in Settings → Plans; `npm run studio:set-platform-owner` for a handover)
- Create: `tests/e2e/plans.spec.ts`

- [ ] **Step 1: Write the failing tests**

```ts
// tests/seed/demo-menus.test.ts
it('puts the three demos on the three plans, and leaves a demo that exists on its plan', async () => { /* … */ });
// tests/e2e/plans.spec.ts
test('a downgrade hides Explore, the 3D dish and the animated rail, and an upgrade brings them back', async ({ page }) => {
  // sign in as the dev owner, ATELIER → Plan → Basic → confirm
  // guest /atelier/en: no Explore link; /atelier/en/explore → /atelier/en; the rail is plain ([data-rail="plain"] or the rail's own marker)
  // Studio ATELIER menu → Brand: the drum rail shows a lock
  // back to Premium: the guest menu shows Explore again
});
```

- [ ] **Step 2: Run them.** Expected: FAIL.
- [ ] **Step 3: Implement the seed changes and write the docs.**
- [ ] **Step 4: Run `npm test`, `npm run test:load`, `npx playwright test`.** Expected: PASS.
- [ ] **Step 5: Commit** (`feat(plans): demo restaurants on the three plans, the end-to-end flow and the deployment notes`).

---

### Task 12: Verify, review and open the pull request

- [ ] **Step 1: Run `npm run lint && npm run typecheck && npm test && npx playwright test`, then `BUILD_TARGET=standalone npx next build --webpack`.** Expected: all pass.
- [ ] **Step 2: Check the public menu's weight did not grow** (`npm run perf` on `/atelier/en` and `/atelier/en/t/04` against `main`; the features object is a few bytes).
- [ ] **Step 3: Whole-branch review** by a fresh reviewer on the most capable model against the spec and this plan; fix what it finds, with tests.
- [ ] **Step 4: Open the pull request to `main`** with the spec refinements, the machine-drafted strings flagged, and the after-deploy step (set the WhatsApp number). Tell the user in Arabic what changed, how to merge, and the click-by-click step to set their number after the deploy.
