# Menu Motions Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A designer places motions from the library at three places of a client's menu (top, behind the signature
dish, over a category heading), tunes them, publishes, and guests see them play.

**Architecture:** A pure module (`src/server/domain/menu-motions.ts`) decides which motions a place offers and cleans
what is saved. Placements are draft rows (`MenuMotion`) written by Studio actions through `editDraft`; publishing
copies them into the snapshot's optional `motions`, which `tenantInfo` gates by the plan and `buildMenuView` resolves
for the guest's language. The menu renders each placement through a `next/dynamic` slot, so `@/motion` and the
animation library never enter the menu route's first JavaScript.

**Tech Stack:** Next.js 16, React 19, Prisma 7 (PostgreSQL), Zod 4, Vitest, Playwright, the motion library in
`src/motion`.

**Spec:** `docs/superpowers/specs/2026-10-18-menu-motions-design.md`

## Global Constraints

- Places: `hero`, `signature`, `category`; one motion per place (one per category). Slots are `hero`, `signature`,
  `category:<categoryId>`.
- Offered motion groups: `three-d`, `luxury`, `food`, `background`, `type`, `effects` (90 motions). Never `scroll`,
  `interactive`, `micro`, `transition`.
- Feature key `design.menuMotions`: live, area `design`, project 2, starts in `PRO`. Permission `brand.edit`.
- A menu with no motion: the snapshot has no `motions` key, so its hash is unchanged.
- Text fallback: the guest's language, then the menu's default language, then the brand's logo text.
- Guest slots: `aria-hidden`, `inert`, `pointer-events: none`; `respectReducedMotion` on; `playing` false when the
  brand's motion level is `none`; boxes reserved by CSS (hero 2:1 max 280 px; category 3:1 max 160 px; signature the
  stage's 5:4).
- `@/motion` is imported by one guest file only (`src/ui/menu/MotionSlotBody.tsx`), loaded with `next/dynamic`.
- No new dependencies. Messages in en, ar, ckb (parity test). Arabic explanations to the user; code stays English.
- Tests need `BUZZIFY_DB_PORT=54347` in this worktree (`npm run db:up` with it first).

## Review Focus

1. A category deleted after a motion was placed on it: the row goes with it, and an old revision whose motion names a
   missing category drops that motion when parsed. Tests in Tasks 3 and 4.
2. A language removed from the menu: its texts are dropped at the next save and ignored by guests; a guest whose
   language has no text reads the default language's, then the logo text. Tests in Tasks 1 and 5.
3. A plan downgrade after publishing: guests get exactly the no-motion menu (no empty band), with no publish. Test in
   Task 5.
4. Two designers filling the same empty place at once, or saving over each other: the second gets `CONFLICT`, never a
   second row. Test in Task 4.
5. A snapshot holding a motion id that is unknown or no longer offered, or params of the wrong type: dropped or
   resolved, never passed to a motion's code. Test in Task 1 (parse) and Task 3 (round trip).

---

## File Structure

```
prisma/schema.prisma                          + model MenuMotion, relations on Menu and Category
prisma/migrations/<ts>_menu_motions/          the migration
src/server/domain/menu-motions.ts             places, offered motions, cleaning, guest params, starting values
src/server/domain/entitlements.ts             + design.menuMotions
src/server/domain/plan-choices.ts             GuestFeatures.motions; hiddenFromGuests(…, motions)
src/server/domain/snapshot.ts                 MenuSnapshot.motions?, parse
src/server/data/tenant-db.ts                  MENU_SCOPED_MODELS + 'MenuMotion'
src/server/publish/draft.ts                   load, write back (duplicate), restore
src/server/data/tenant.ts, public-menu.ts     TenantInfo.motions, gated
src/server/data/cache.ts                      slug key '3'
src/server/data/menu-view.ts                  MenuView.motions
src/server/studio/services/menu-motions.ts    saveMotion, removeMotion, motionPlaces
src/server/studio/actions/motions.ts          motions.save, motions.remove
src/server/studio/queries/motions.ts          motions.list
src/server/studio/actions/menus.ts            duplicate drops motions outside the plan
src/server/studio/queries/preview.ts          planNote passes motions
src/app/studio/_actions/motions.ts            server actions
src/app/studio/(studio)/(app)/menus/[id]/motion/page.tsx
src/studio/workspace/tabs.ts                  + 'motion' tab
src/studio/workspace/motion/MotionPlaces.tsx  the tab: places, choose, remove
src/studio/workspace/motion/MotionPicker.tsx  dialog: offered motions, search, groups
src/studio/workspace/motion/MotionTuner.tsx   preview in the place's shape, controls, texts per language, save
src/studio/motion/MotionCard.tsx              split out MotionPreview; card can select
src/studio/messages/menu-motions/{en,ar,ckb}.ts, spread into the catalogs
src/ui/menu/MotionSlot.tsx                    the reserved box and the dynamic import
src/ui/menu/MotionSlotBody.tsx                mounts <Motion> when near and idle
src/ui/menu/MenuApp.tsx, SignatureFeature.tsx the places
eslint.config.mjs                             @/motion fenced from guest code except MotionSlotBody
tests/domain/menu-motions.test.ts, tests/publish/menu-motions.test.ts, tests/studio/menu-motions.test.ts,
tests/data/menu-motions-view.test.ts, tests/e2e/studio-menu-motions.spec.ts
```

## Interfaces

```ts
// src/server/domain/menu-motions.ts
export const MOTION_PLACES = ['hero', 'signature', 'category'] as const;
export type MotionPlace = (typeof MOTION_PLACES)[number];
export const PLACEABLE_CATEGORIES: readonly MotionCategory[]; // three-d, luxury, food, background, type, effects
export function placeMotions(place: MotionPlace): MotionMeta[];
export function isOffered(place: MotionPlace, motionId: string): boolean;
export function slotOf(place: MotionPlace, categoryId?: string | null): string;
/** Text parameter → language → text. */
export type MotionTexts = Record<string, Partial<Record<Locale, string>>>;
export interface SnapshotMotion { place: MotionPlace; categoryId?: string; motionId: string; params: MotionParams; texts: MotionTexts }
/** Null when the place, the motion or the category is not valid; params resolved without text keys; texts trimmed. */
export function cleanMotion(raw: unknown, ctx: { locales: readonly Locale[]; categoryIds: ReadonlySet<string> }): SnapshotMotion | null;
export function guestParams(motion: SnapshotMotion, locale: Locale, defaultLocale: Locale, logoText: string): MotionParams;
export function startingParams(meta: MotionMeta, pageBackground: string): MotionParams; // text keys left out
export function startingTexts(meta: MotionMeta, locales: readonly Locale[], logoText: string): MotionTexts;

// src/server/data/menu-view.ts
export interface PlacedMotion { motionId: string; params: MotionParams; playing: boolean }
MenuView.motions: { hero?: PlacedMotion; signature?: PlacedMotion; categories: Record<string, PlacedMotion> };

// src/server/studio/actions/motions.ts
save:   { menuId, place, categoryId?: string, motionId, params, texts, version: number | null } → { version: number }
remove: { menuId, place, categoryId?: string, version: number } → { removed: true }
// src/server/studio/queries/motions.ts
list:   { menuId } → MotionPlacesView (Task 4)
```

---

### Task 1: The places and what they offer

**Files:**
- Create: `src/server/domain/menu-motions.ts`
- Test: `tests/domain/menu-motions.test.ts`

**Interfaces:** Produces everything under `menu-motions.ts` in Interfaces. Consumes `MOTIONS`, `motionById`,
`resolveParams` from `@/motion/catalog` and `@/motion/params` (not `@/motion`, which carries the client component).

- [ ] **Step 1: Write the failing tests**

```ts
it('offers the 90 picture motions at every place and none of the demonstrations', () => {
  for (const place of MOTION_PLACES) {
    const offered = placeMotions(place);
    expect(offered).toHaveLength(90);
    expect(new Set(offered.map((m) => m.category))).toEqual(new Set(['three-d', 'luxury', 'food', 'background', 'type', 'effects']));
  }
  expect(isOffered('hero', 'golden-particles')).toBe(true);
  expect(isOffered('hero', 'add-to-cart')).toBe(false);        // micro
  expect(isOffered('category', 'scroll-zoom')).toBe(false);    // scroll
  expect(isOffered('hero', 'no-such-motion')).toBe(false);
});
it('names slots', () => {
  expect(slotOf('hero')).toBe('hero');
  expect(slotOf('category', 'c1')).toBe('category:c1');
  expect(() => slotOf('category')).toThrow();
  expect(() => slotOf('hero', 'c1')).toThrow();
});
it('cleans a placement: resolved params without text, texts trimmed to known params, languages and length', () => {
  const ctx = { locales: ['en', 'ar'] as const, categoryIds: new Set(['c1']) };
  const clean = cleanMotion({ place: 'hero', motionId: 'golden-particles', params: { count: 999, color: '#ABCDEF', made: 1 }, texts: {} }, ctx);
  expect(clean).toEqual({ place: 'hero', motionId: 'golden-particles', params: { color: '#abcdef', background: '#0d0b09', count: 400 }, texts: {} });
  const text = cleanMotion({ place: 'hero', motionId: 'text-reveal', params: {}, texts: { text: { en: ' Hi ', ar: 'أ'.repeat(500), ckb: 'x' }, nope: { en: 'y' } } }, ctx);
  expect(Object.keys(text!.params)).not.toContain('text');
  expect(text!.texts.text!.en).toBe('Hi');
  expect(Array.from(text!.texts.text!.ar!)).toHaveLength(/* the param's maxLength */ motionById('text-reveal')!.params.text!.type === 'text' ? (motionById('text-reveal')!.params.text as { maxLength: number }).maxLength : 0);
  expect(text!.texts.text).not.toHaveProperty('ckb');
  expect(text!.texts).not.toHaveProperty('nope');
});
it('refuses what cannot be placed', () => {
  const ctx = { locales: ['en'] as const, categoryIds: new Set(['c1']) };
  expect(cleanMotion({ place: 'hero', motionId: 'add-to-cart', params: {}, texts: {} }, ctx)).toBeNull();
  expect(cleanMotion({ place: 'category', categoryId: 'gone', motionId: 'coffee-steam', params: {}, texts: {} }, ctx)).toBeNull();
  expect(cleanMotion({ place: 'category', motionId: 'coffee-steam', params: {}, texts: {} }, ctx)).toBeNull();
  expect(cleanMotion({ place: 'hero', categoryId: 'c1', motionId: 'coffee-steam', params: {}, texts: {} }, ctx)).toBeNull();
  expect(cleanMotion({ place: 'roof', motionId: 'coffee-steam', params: {}, texts: {} }, ctx)).toBeNull();
  expect(cleanMotion('junk', ctx)).toBeNull();
});
it('gives guests their language, then the default, then the logo text', () => {
  const m = { place: 'hero', motionId: 'text-reveal', params: {}, texts: { text: { en: 'Fresh', ar: 'طازج' } } } as SnapshotMotion;
  expect(guestParams(m, 'ar', 'en', 'Zhamitos').text).toBe('طازج');
  expect(guestParams(m, 'ckb', 'en', 'Zhamitos').text).toBe('Fresh');
  expect(guestParams({ ...m, texts: {} }, 'ckb', 'en', 'Zhamitos').text).toBe('Zhamitos');
});
it('starts a picked motion on the page colour, and brand texts on the logo text', () => {
  expect(startingParams(motionById('golden-particles')!, '#101010').background).toBe('#101010');
  expect(startingParams(motionById('liquid-gold')!, '#101010')).not.toHaveProperty('background');
  expect(startingTexts(motionById('premium-logo-reveal')!, ['en', 'ar'], 'Zhamitos')).toEqual({ text: { en: 'Zhamitos', ar: 'Zhamitos' } });
  expect(startingTexts(motionById('text-reveal')!, ['en'], 'Zhamitos')).toEqual({});
});
```

- [ ] **Step 2: Run** `npx vitest run tests/domain/menu-motions.test.ts` — FAIL (module missing).
- [ ] **Step 3: Implement `src/server/domain/menu-motions.ts`.** `cleanMotion` reads `raw` defensively (object with
  string fields); params: `resolveParams(meta, params)` then delete text-spec keys; texts: only text-spec keys, only
  `ctx.locales`, `trim()`, `Array.from(...).slice(0, maxLength)`, empty dropped, a param with no language left dropped.
  `guestParams`: `resolveParams(meta, { ...params, [key]: texts[key]?.[locale] || texts[key]?.[defaultLocale] || logoText })`
  for each text param. Fix the test's length assertion to the real `maxLength` once read.
- [ ] **Step 4: Run** the test — PASS.
- [ ] **Step 5: Commit** `feat(motion): the places on a menu that take a motion, and what each offers`.

### Task 2: The plan feature

**Files:**
- Modify: `src/server/domain/entitlements.ts` (FEATURES), `src/server/domain/plan-choices.ts` (`GuestFeatures`,
  `guestFeatures`, `hiddenFromGuests`), `src/studio/messages/{en,ar,ckb}.ts` (`plans.feature.design.menuMotions`)
- Test: `tests/domain/entitlements.test.ts`, `tests/domain/plan-choices.test.ts`

**Interfaces:** Produces `'design.menuMotions'` as a `FeatureKey`; `GuestFeatures.motions: boolean`;
`hiddenFromGuests(brand, catalog, entitlements, motions: readonly unknown[] = [])`.

- [ ] **Step 1: Update tests.** Live features become nine, `design.menuMotions` ninth; PRO's live list ends with it;
  PREMIUM has 9. New: `guestFeatures(BASIC).motions === false`, PRO true; `hiddenFromGuests(brand, catalog, BASIC, [{}])`
  contains `design.menuMotions`, and with `[]` does not.
- [ ] **Step 2: Run** `npx vitest run tests/domain/entitlements.test.ts tests/domain/plan-choices.test.ts` — FAIL.
- [ ] **Step 3: Implement.** Insert `{ key: 'design.menuMotions', area: 'design', status: 'live', project: 2, startsIn: 'PRO' }`
  after `immersive.stage`. Messages: en "Motions on the menu", ar "حركات على المنيو", ckb "جووڵەکان لەسەر مێنیو".
  Check that no other test lists every feature (`grep -rn "immersive.stage'" tests`) and update those lists.
- [ ] **Step 4: Run** the two tests and `npx vitest run tests/studio/messages.test.ts tests/studio/plans*.test.ts tests/studio/plan-locks.test.ts` — PASS.
- [ ] **Step 5: Commit** `feat(plans): motions on the menu are a plan feature, from Pro`.

### Task 3: Draft rows and the snapshot

**Files:**
- Modify: `prisma/schema.prisma`; create the migration with `npx prisma migrate dev --name menu_motions` (with
  `BUZZIFY_DB_PORT=54347` and this worktree's `.env`); `src/server/data/tenant-db.ts`; `src/server/domain/snapshot.ts`;
  `src/server/publish/draft.ts`
- Test: `tests/publish/menu-motions.test.ts`, `tests/data/tenant-registry.test.ts` (passes once registered)

**Interfaces:** Consumes `cleanMotion`, `slotOf`, `SnapshotMotion` (Task 1). Produces `MenuSnapshot.motions?:
SnapshotMotion[]`; the Prisma delegate `menuMotion`; `motionRowsFromSnapshot(motions, categoryMap?)` in `draft.ts`.

- [ ] **Step 1: Write the failing tests** (DB, `createMenuFixture`, rows written with `prisma.menuMotion.create`):
  - `a menu without motions has no motions key and keeps its hash`: `loadDraftSnapshot` has no `motions`;
    `snapshotHash` equals the fixture's live revision's `snapshotHash`.
  - `publishing carries the menu's motions, sorted by slot`: rows for `signature` and `category:<id>` (params
    `{ count: 999 }`) → the published revision's `motions` is `[{ place: 'category', categoryId, ... count: 400 }, { place: 'signature', ... }]`.
  - `parsing drops motions it cannot place`: `parseSnapshot({ ...valid, motions: [bad id, missing category, good] })`
    keeps only the good one.
  - `restore to draft brings back the revision's motions`: publish with a hero row, delete it, restore → a hero row
    with the same motion, params and texts.
  - `duplicating maps a category motion onto the copy's category` (call `writeDraftFromSnapshot` into a second
    fixture menu): the new row's `categoryId` is the copy's category and its `slot` is `category:<that id>`.
  - `deleting a category deletes its motion`.
- [ ] **Step 2: Run** `npx vitest run tests/publish/menu-motions.test.ts` — FAIL.
- [ ] **Step 3: Implement.**
  - Schema as the spec's section 6, with `motions MenuMotion[]` on `Menu` and `Category`. Register `'MenuMotion'` in
    `MENU_SCOPED_MODELS`.
  - `snapshot.ts`: `motions?: SnapshotMotion[]` on `MenuSnapshot`; the Zod schema takes `motions: z.array(z.unknown()).optional()`
    and `parseSnapshot` maps it through `cleanMotion` with the snapshot's locales and category ids, removing the key
    when nothing is left. `buildSnapshot` takes optional `motions` and sets the key only when non-empty, sorted by
    `slotOf`.
  - `loadDraftSnapshot`: read `menuMotion` rows after the catalog, clean each, pass to `buildSnapshot`.
  - `writeDraftFromSnapshot`: `menuMotion.deleteMany({ where })` first; after categories, create rows from
    `snapshot.motions` with categories mapped through `categoryIds` (skip unmapped). `restoreDraftFromSnapshot`: same,
    with the snapshot's own ids.
- [ ] **Step 4: Run** the new test, `tests/data/tenant-registry.test.ts`, `tests/publish`, `tests/domain/snapshot*` — PASS.
- [ ] **Step 5: Commit** `feat(motion): a menu's motions are draft rows, published with the revision`.

### Task 4: Studio actions and the query

**Files:**
- Create: `src/server/studio/services/menu-motions.ts`, `src/server/studio/actions/motions.ts`,
  `src/server/studio/queries/motions.ts`, `src/app/studio/_actions/motions.ts`
- Modify: `src/server/studio/actions/menus.ts` (duplicate), `src/server/studio/queries/preview.ts` (planNote)
- Test: `tests/studio/menu-motions.test.ts`

**Interfaces:** Consumes Task 1 and Task 3. Produces the actions and query of Interfaces, and

```ts
export interface MotionPlaceView { place: MotionPlace; categoryId?: string; name: string; motion: { motionId: string; params: MotionParams; texts: MotionTexts; version: number } | null }
export interface MotionPlacesView {
  locales: Locale[]; defaultLocale: Locale; logoText: string; pageBackground: string; motionIntensity: Motion;
  hasSignature: boolean; places: MotionPlaceView[]; allowed: boolean; upgrade: UpgradeInfo | null;
}
```

`places` is hero, signature, then categories by `sortOrder`, each named in the menu's default language.

- [ ] **Step 1: Write the failing tests** (the brand test's setup: a designer of restaurant A, `runAction`):
  - `places a motion, moves the draft hash, and audits it`: save hero `golden-particles` with `version: null` →
    `{ version: 1 }`; row exists; `menu.draftHash` changed; audit `motion.placed` with `after.motionId`.
  - `refuses a motion the place does not offer` (`add-to-cart`) and `an unknown place` → `INVALID`.
  - `refuses another menu's category` → `NOT_FOUND`.
  - `refuses a stale save, and a second fill of an empty place` → `CONFLICT` both times; one row.
  - `removes at the version`: then the row is gone; stale remove → `CONFLICT`.
  - `an owner without brand.edit is refused` → `FORBIDDEN`.
  - Plan (restaurant set to `BASIC`): new place → `UPGRADE_REQUIRED` with `fields.feature`/plan as `requireFeature`
    gives; the same motion at its place with new params → accepted; another motion there → `UPGRADE_REQUIRED`; remove → accepted.
  - `list` returns the places in order with names, the page colour of the brand's theme, `allowed`, and `upgrade` on BASIC.
  - `duplicating into a restaurant without the feature drops the motions` (Super Admin duplicate into a BASIC restaurant).
- [ ] **Step 2: Run** `npx vitest run tests/studio/menu-motions.test.ts` — FAIL.
- [ ] **Step 3: Implement.** Actions: `permission: 'brand.edit'`, `target: menu`, no definition-level `feature` (kept
  choices must pass); the service calls `requireFeature(ctx.plan, 'design.menuMotions')` unless the stored row at the
  slot has the same `motionId`. Save validates with `cleanMotion` (locales and category ids read through `tx`), then
  inside `editDraft`: `version === null` → `create` (a unique violation on `[menuId, slot]` becomes `CONFLICT`; an
  existing row also `CONFLICT`); else `updateWithVersion(tx.menuMotion, { entityType: 'MenuMotion' })`. Remove uses
  `deleteWithVersion`. Audit `motion.placed` / `motion.removed`, entityType `MenuMotion`, changes `{ motionId, params,
  texts }` before and after. Duplicate: after the brand clamp, `if (!allows(destination, 'design.menuMotions'))` delete
  the copy's rows and refresh the hash. `planNote` passes `snapshot.motions ?? []` to `hiddenFromGuests`.
- [ ] **Step 4: Run** the new test and `tests/studio/enforcement.test.ts` (every action is registered and checked) — PASS.
- [ ] **Step 5: Commit** `feat(studio): actions to place, tune and remove a menu's motions`.

### Task 5: What guests are served

**Files:**
- Modify: `src/server/data/tenant.ts`, `src/server/data/public-menu.ts`, `src/server/data/cache.ts`,
  `src/server/data/menu-view.ts`
- Test: `tests/data/menu-motions-view.test.ts`

**Interfaces:** Produces `TenantInfo.motions: SnapshotMotion[]` and `MenuView.motions` (Interfaces).

- [ ] **Step 1: Write the failing tests** (pure: `tenantInfo` and `buildMenuView` on a built snapshot):
  - `a plan without the feature serves no motions`: BASIC → `tenant.motions` `[]` and `view.motions` `{ categories: {} }`.
  - `guests get params in their language`: a hero `text-reveal` with en/ar texts → `view.motions.hero.params.text` is
    the Arabic one for `ar`, the English for `ckb`.
  - `a menu whose motion is off shows them still`: brand `motionIntensity: 'none'` → `playing: false`; `subtle` → true.
  - `category motions are keyed by category id`.
- [ ] **Step 2: Run** — FAIL.
- [ ] **Step 3: Implement.** `tenantInfo`: `motions: allows(entitlements, 'design.menuMotions') ? (snapshot.motions ?? []) : []`.
  `buildMenuView`: build `motions` with `guestParams(…, tenant.brand.logoText)` and
  `playing = tenant.brand.motionIntensity !== 'none'`. Move the slug cache key to `['slug', '3', slug]` with the
  comment's list extended ("3: the menu's motions").
- [ ] **Step 4: Run** the test, `tests/data`, `tests/server` — PASS.
- [ ] **Step 5: Commit** `feat(menu): guests are served the menu's motions their plan allows`.

### Task 6: The motions on the guest menu

**Files:**
- Create: `src/ui/menu/MotionSlot.tsx`, `src/ui/menu/MotionSlotBody.tsx`
- Modify: `src/ui/menu/MenuApp.tsx`, `src/ui/menu/SignatureFeature.tsx`, `eslint.config.mjs`

**Interfaces:** `<MotionSlot place="hero" | "signature" | "category" motion={PlacedMotion} className? />`.
`MotionSlotBody` default-exports `({ motion, dir }) => JSX`.

- [ ] **Step 1: Lint fence.** Add to the public menu block a pattern `{ group: ['@/motion', '@/motion/*'], message: … }`
  and a later block for `src/ui/menu/MotionSlotBody.tsx` allowing it (keeping the Studio and library fences). Run
  `npx eslint src/ui` — PASS (nothing imports it yet).
- [ ] **Step 2: Implement `MotionSlot`.** A `div` with `aria-hidden`, `inert`, `pointer-events-none`, the place's
  reserved box (`hero`: `aspect-[2/1] max-h-[280px] w-full`; `category`: `aspect-[3/1] max-h-40 w-full`; `signature`:
  `absolute inset-0 -z-10`), the edge mask (`[mask-image:linear-gradient(to_bottom,transparent,#000_18%,#000_62%,transparent)]`),
  `data-motion-slot={place}`, and `dynamic(() => import('./MotionSlotBody'), { ssr: false })` inside.
- [ ] **Step 3: Implement `MotionSlotBody`.** Mounts `<Motion id params playing dir />` from `@/motion/Motion` once an
  IntersectionObserver (`rootMargin: '100% 0px'`) reports the box near and `requestIdleCallback` (fallback
  `setTimeout(…, 200)`) has fired; stays mounted after. `dir` from `useApp().locale` via `direction()`.
- [ ] **Step 4: Place them.** `MenuApp`: hero slot right after `<Header />` when `view.motions.hero`; for each
  category with a motion, the slot before its `h2`, the heading pulled up `-mt-10` over the faded edge (`relative`).
  `SignatureFeature` takes `motion?: PlacedMotion`; the slot inside the masked stage container, behind the stage.
- [ ] **Step 5: Verify.** `npm run typecheck`; `npx eslint src tests scripts prisma eslint.config.mjs`; start the dev
  server (`.claude/launch.json`, port 3107) on a seeded menu with a hero row inserted by script; check in the browser
  pane that `[data-motion="golden-particles"]` plays, the page has no console errors, and the menu route's first
  scripts do not contain `golden-particles`/`@/motion` (network list before scrolling). Remove the row afterwards.
- [ ] **Step 6: Commit** `feat(menu): guests see the menu's motions at the top, behind the signature and over headings`.

### Task 7: The Motion tab

**Files:**
- Create: `src/app/studio/(studio)/(app)/menus/[id]/motion/page.tsx`, `src/studio/workspace/motion/MotionPlaces.tsx`,
  `MotionPicker.tsx`, `MotionTuner.tsx`, `src/studio/messages/menu-motions/{en,ar,ckb}.ts`
- Modify: `src/studio/workspace/tabs.ts`, `src/studio/motion/MotionCard.tsx`, `src/studio/messages/{en,ar,ckb}.ts`
  (spread), the workspace tab test (`grep -rln "WORKSPACE_TABS\|visibleTabs" tests`)
- Test: the tab test, `tests/studio/messages.test.ts`

**Interfaces:** Consumes `motions.list`, the server actions `saveMotion`, `removeMotion` from
`src/app/studio/_actions/motions.ts`, `placeMotions`, `startingParams`, `startingTexts`, `MotionPreview` (below),
`ParamControls`, `filterMotions`.

- [ ] **Step 1: Tab test.** `motion` after `brand`, path `/motion`, needs `['brand.edit']`; designers see it, owners do
  not. Run — FAIL; add the tab and `workspace.tab.motion` (en "Motion", ar "الحركة", ckb "جووڵە"); run — PASS.
- [ ] **Step 2: Split `MotionCard`.** Export `MotionPreview({ meta, params, playing, className })` (the near-mounted,
  inert box) and use it in the card; the card itself is unchanged for the gallery. Run `tests/e2e/studio-motions.spec.ts`
  later in Task 8 to confirm the gallery still works.
- [ ] **Step 3: Build the tab.** `MotionPlaces`: a list of the places (`name`, a still `MotionPreview` of the stored
  motion on `pageBackground`, its name `t('motion.<id>.name')`, Choose/Change, Remove with a confirm); the signature row
  notes `menuMotions.signatureMissing` when `hasSignature` is false; when `allowed` is false, `UpgradeHint` replaces
  Choose (Change stays for a stored motion); a note `menuMotions.stillNote` when `motionIntensity` is `none`.
  `MotionPicker`: a dialog with search and group chips (only `PLACEABLE_CATEGORIES`) over `placeMotions(place)`, each
  a selectable card (button, `aria-pressed`) with `MotionPreview`. `MotionTuner`: the preview in the place's shape on
  `pageBackground`, `ParamControls` over the non-text specs, a text field per menu language for each text param
  (`dir` of that language), Save and Cancel; errors through the Studio's usual error text; on save, `router.refresh()`.
- [ ] **Step 4: Messages.** Every new key in en, ar and ckb (`menuMotions.*`): title, intro, place names
  (`menuMotions.place.hero` "Top of the menu" / "أعلى المنيو" / "سەرەوەی مێنیو", `.signature` "Behind the signature
  dish" / "خلف الطبق المميز" / "لە پشت خواردنی تایبەت", `.category` "Over “{name}”" / "فوق «{name}»" / "لەسەر «{name}»"),
  none, choose, change, remove, removeConfirm, saved, removed, pickTitle, tuneTitle, textIn "{param} in {language}",
  signatureMissing, stillNote. Run `npx vitest run tests/studio/messages.test.ts` — PASS.
- [ ] **Step 5: Verify** typecheck and lint; open the tab in the browser pane as the seeded designer, place a motion,
  see "unpublished changes".
- [ ] **Step 6: Commit** `feat(studio): a Motion tab where designers place library motions on a menu`.

### Task 8: End to end and verification

**Files:**
- Create: `tests/e2e/studio-menu-motions.spec.ts`

- [ ] **Step 1: Write the test** (@desktop, `createTemporaryMenu`, Super Admin storage state as `studio-brand.spec.ts`):
  open `/studio/menus/{id}/motion`, Choose at "Top of the menu", search "golden", pick Golden particles, change its
  colour field to `#ff0000`, Save, see `menuMotions.saved` and `menus.unpublished`, Publish; a guest page
  `/{slug}/en` has `[data-motion-slot="hero"] [data-motion="golden-particles"]` with `data-playing="true"`; a guest
  context with `reducedMotion: 'reduce'` has `data-playing="false"`; remove the menu after.
- [ ] **Step 2: Run** `npx playwright test tests/e2e/studio-menu-motions.spec.ts tests/e2e/studio-motions.spec.ts tests/e2e/menu.spec.ts tests/e2e/studio-brand.spec.ts`
  (dev server on this worktree's port with `BUZZIFY_DB_PORT=54347`, `E2E_PORT` set) — PASS.
- [ ] **Step 3: Full checks.** `npm run typecheck`; `npx eslint src tests scripts prisma eslint.config.mjs`;
  `npx vitest run` — all PASS.
- [ ] **Step 4: Commit** `test(e2e): a designer places a motion and guests see it play`.
