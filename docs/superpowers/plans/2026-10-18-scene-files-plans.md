# Scene files and plans Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** a template menu's background file (GLB, MP4, Lottie) follows the restaurant's plan. Guests on a plan without
the file's feature see the template's own scene, and a save that newly chooses a locked file is refused.

**Architecture:** the pure functions live in `src/server/domain/plan-choices.ts`, beside the brand ones:

- the feature for each kind;
- the kinds a plan allows;
- the save lock;
- the guest clamp, inside `clampBrandView`;
- the Preview tab's note.

The design service calls them on save, apply and duplicate. `design.get` hands the Design tab a plan view, which the
picker and the panel read.

**Tech Stack:** Next.js 16, Prisma, Vitest, Playwright.

**Spec:** `docs/superpowers/specs/2026-10-18-scene-files-plans-design.md`

## Global Constraints

- Feature keys:
  - `MODEL`/`model` uses `immersive.models3d` (Premium).
  - `VIDEO`/`video` uses `design.backgroundVideo` (Premium).
  - `LOTTIE`/`lottie` uses `design.backgroundAnimation` (new; area `design`, project 2, starts in `PRO`).
- The three keys are `live`, in this order after `design.menuMotions`: `design.backgroundAnimation`,
  `design.backgroundVideo`, `immersive.models3d`. `immersive.models3d` moves to project 2.
- A locked choice may be kept, never newly made. "New" means the chosen `assetId` differs from the stored one.
- Nothing stored is rewritten by a plan, and revisions and their hashes never change.
- Uploads stay open to every plan.
- `NOT_FOUND` for a file the restaurant may not use comes before any plan check.
- The Studio's English, Arabic and Sorani messages keep the same keys (`tests/studio/messages.test.ts`).
- Worktree:
  - Run `npm ci` first. Start the worktree's own database with `BUZZIFY_DB_PORT=54351 npm run db:up`.
  - Pass the same port to `npm test`.
  - Run Playwright with `E2E_PORT=3121 BUZZIFY_DB_PORT=54351`.
  - Never use the shared port 54329.
- Lint with `npx eslint src tests scripts prisma eslint.config.mjs`.
- Commits: the user asked to be asked before committing. Each task's commit message is kept, and nothing is committed
  until the user agrees.

## Review Focus

1. **Re-picking the stored file.** A business removes a kept locked file in the editor, does not save, then picks the
   same file again. The picker must allow it, because the file is still the stored one. Owned by Task 4: a locked tile
   is enabled when its id is the stored `assetId`.
2. **A plan extra.** A Basic restaurant with the extra `design.backgroundVideo: true` may choose and show a video.
   Owned by Task 2.
3. **Duplicating within one restaurant.** A copy is a new menu, so a kept locked file is dropped from the copy even
   when the copy stays in the same restaurant. Owned by Task 3.
4. **A downgrade after publishing.** A menu published with a video, whose restaurant then moves to Pro, serves guests
   without `design.media`. The revision is not republished and its hash does not change. Owned by Task 3.
5. **A Lottie file in a shared design on Basic.** Applying the design drops the file, and the next save of the
   design is accepted. Owned by Task 3.

---

### Task 1: The catalog

**Files:**
- Modify: `src/server/domain/entitlements.ts:27-57`
- Modify: `src/studio/messages/{en,ar,ckb}.ts` (beside `plans.feature.design.backgroundVideo`)
- Modify: `docs/superpowers/specs/2026-10-18-plans-and-entitlements-design.md` (section 4: the three keys are live;
  `design.backgroundAnimation` is added)
- Modify: `docs/superpowers/specs/2026-10-18-template-studio-stage-2-scene-files-design.md` (a pointer to the new spec)
- Test: `tests/domain/entitlements.test.ts`

**Interfaces:**
- Produces: `FeatureKey` gains `'design.backgroundAnimation'`. `FEATURE_KEYS.slice(0, 12)` are the live keys.

- [ ] **Step 1: Update the catalog tests.**
  - The live list is `FEATURE_KEYS.slice(0, 12)`: the nine of today, then `design.backgroundAnimation`,
    `design.backgroundVideo`, `immersive.models3d`.
  - There are 12 live features and 17 reserved ones.
  - `live('PRO')` gains `design.backgroundAnimation` after `design.menuMotions`. `live('PREMIUM')` has 12.
  - `featuresLost(premium, basic)` equals `FEATURE_KEYS.slice(0, 12)`.
  - New check: `design.backgroundAnimation` is in PRO and PREMIUM by default, and not in BASIC.
- [ ] **Step 2: Run the tests and check that they fail.**
  `BUZZIFY_DB_PORT=54351 npx vitest run tests/domain/entitlements.test.ts`. They fail on the counts.
- [ ] **Step 3: Change the catalog.**
  - Move the two keys into the live block and set them `live`.
  - Add `design.backgroundAnimation`.
  - Move `immersive.models3d` to project 2.
  - Add `plans.feature.design.backgroundAnimation`:
    - en: `Background animation (Lottie)`
    - ar: `حركة خلفية (Lottie)`
    - ckb: `جووڵەی باکگراوند (Lottie)`
  - Update the two spec documents.
- [ ] **Step 4: Run the tests and check that they pass.**
  Run the catalog test and `tests/studio/messages.test.ts`. Both pass.
- [ ] **Step 5: Commit** with the message `feat(plans): scene files are plan features; Lottie gets its own`.

### Task 2: Pure plan functions for scene files

**Files:**
- Modify: `src/server/media/kinds.ts`
- Modify: `src/server/domain/plan-choices.ts`
- Test: `tests/domain/plan-choices.test.ts`

**Interfaces:**
- Consumes: Task 1's keys.
- Produces:
  - `SCENE_MEDIA_KIND: Record<SceneKind, SceneMedia['kind']>` in `kinds.ts`
    (`MODEL→model`, `VIDEO→video`, `LOTTIE→lottie`).
  - In `plan-choices.ts`:
    - `type SceneFileKind = SceneMedia['kind']`
    - `sceneFeature(kind: SceneFileKind): FeatureKey`
    - `allowedSceneKinds(e: Entitlements): SceneFileKind[]`, in the order `model`, `video`, `lottie`.
    - `sceneChoiceLock(next: { assetId: string; kind: SceneFileKind } | null, storedAssetId: string | null, e): FeatureKey | null`
    - `clampBrandView` also drops a locked `design.media`.
    - `hiddenFromGuests` puts the media's feature right after `hiddenChoices`.

- [ ] **Step 1: Write the failing tests** in a new `describe('scene files')`. Use
  `media = { model: {kind:'model',…}, video: {…}, lottie: {…} }` with valid `SceneMedia` shapes. `DESIGNED` is a
  `BrandView` whose `design` is `resolveDesign(TEMPLATES['obsidian-gold'], {}, { details: null, poweredBy: true })`.
  - `sceneFeature('model') === 'immersive.models3d'`, `('video') === 'design.backgroundVideo'`,
    `('lottie') === 'design.backgroundAnimation'`.
  - `allowedSceneKinds(BASIC)` is `[]`, `(PRO)` is `['lottie']`, `(PREMIUM)` is `['model','video','lottie']`.
  - `allowedSceneKinds(on('BASIC', { 'design.backgroundVideo': true }))` is `['video']`.
  - `sceneChoiceLock` returns:
    - `null` for `({assetId:'v1',kind:'video'}, 'v1', BASIC)`;
    - `'design.backgroundVideo'` for `({assetId:'v2',kind:'video'}, 'v1', PRO)`;
    - `null` for `({assetId:'l1',kind:'lottie'}, null, PRO)`;
    - `'design.backgroundAnimation'` for the same on BASIC;
    - `null` for `(null, 'v1', BASIC)`.
  - `clampBrandView` with `design.media` set to each kind:
    - on PRO, the video and the model are gone (`design.media` is undefined) and the Lottie stays;
    - on BASIC, all three are gone;
    - on PREMIUM, the result `toEqual`s the input;
    - the input's `design.media` is still there afterwards.
  - With `catalog = { ...noSelling, products: [] }`:
    - `hiddenFromGuests({...DESIGNED with video}, catalog, PRO)` equals
      `['design.backgroundVideo', 'immersive.explore']`;
    - with the Lottie on PRO, it equals `['immersive.explore']`.
- [ ] **Step 2: Run** `npx vitest run tests/domain/plan-choices.test.ts`. The tests fail because the functions are
  not exported yet.
- [ ] **Step 3: Implement** the functions as their signatures say.
  - `clampBrandView` copies `design` before deleting `media`. A view without `design` or without `media` passes
    through unchanged.
  - `hiddenFromGuests` reads `brand.design?.media`.
- [ ] **Step 4: Run** `npx vitest run tests/domain`. Everything passes.
- [ ] **Step 5: Commit** with the message `feat(plans): guests see a template's own scene when the plan lacks the file's feature`.

### Task 3: The design service, duplicating, and what the Design tab reads

**Files:**
- Modify: `src/server/studio/services/design.ts` (`DesignView`, `designState`, `applyDesign`, `updateDesign`)
- Modify: `src/server/studio/queries/design.ts`
- Modify: `src/server/studio/actions/menus.ts:322-329` (duplicate)
- Test: `tests/studio/scene-files.test.ts`

**Interfaces:**
- Consumes: Task 2's `sceneFeature`, `allowedSceneKinds`, `sceneChoiceLock`, `SCENE_MEDIA_KIND`, and
  `requireFeature(plan, key)` from `src/server/studio/framework/plan.ts`.
- Produces:
  - `DesignView.plan: DesignPlanView`, where
    `interface DesignPlanView { sceneKinds: SceneFileKind[]; lockedScene: FeatureKey | null; upgrade: UpgradeInfo }`.
  - `designState(db, menuId, restaurantId, superAdmin, plan: { entitlements: Entitlements; upgrade: UpgradeInfo })`.
  - `lockedScene` is the stored file's feature when the plan lacks it, else `null`.

- [ ] **Step 1: Write the failing tests** in a new `describe('a plan without the file’s feature')`. Add
  `const onPlan = (plan: PlanTier) => prisma().restaurant.update({ where: { id: a.restaurant.id }, data: { plan } })`.
  1. On PRO, choosing a video is refused with
     `toMatchObject({ code: 'UPGRADE_REQUIRED', upgrade: { feature: 'design.backgroundVideo', plan: 'PREMIUM' } })`.
     Choosing a model gives `immersive.models3d`. Choosing a Lottie file is accepted.
  2. On BASIC, choosing a Lottie file is refused with `design.backgroundAnimation` / `PRO`.
  3. On PRO, another restaurant's video still answers `NOT_FOUND`.
  4. Kept files:
     - Store a video on PREMIUM, then move to PRO. `update({ ...stored, paletteId: 'smoke' })` is accepted. Choosing a
       second video is refused.
     - Store a model on PREMIUM, then move to PRO. A framing change of that model is accepted.
  5. `state()` on PRO with a stored video returns
     `plan: { sceneKinds: ['lottie'], lockedScene: 'design.backgroundVideo', upgrade: expect.objectContaining({ restaurantId: a.restaurant.id }) }`.
     On PREMIUM, `lockedScene` is `null`.
  6. `preview.planNote` on PRO with a stored video has `hidden` containing `'design.backgroundVideo'`.
  7. Applying designs:
     - On PRO, applying a shared saved design that names a shared video leaves `(await overrides()).sceneAsset`
       undefined.
     - On BASIC, a shared design with a shared Lottie is applied without the file, and the next
       `update({ paletteId: 'smoke' })` is accepted.
  8. Duplicating:
     - a menu with a video into a PRO restaurant `b` gives the copy no `sceneAsset`, and the file is still copied to
       `b`'s library;
     - duplicating within `a` after a move to PRO drops it too.
  9. The published menu after a downgrade:
     - publish with a video on PREMIUM, then move to PRO;
     - `tenantInfo(menu, revisionId, parseSnapshot(revision.snapshot), entitlementsFor PRO).brand.design?.media` is
       undefined;
     - on PREMIUM it is defined;
     - `revision.snapshotHash` is unchanged.
- [ ] **Step 2: Run** `BUZZIFY_DB_PORT=54351 npx vitest run tests/studio/scene-files.test.ts`. The new tests fail.
- [ ] **Step 3: `updateDesign`.**
  - After the `NOT_FOUND` check, keep the loaded asset.
  - Inside the transaction, compare it with `parseOverrides(row.design).sceneAsset?.assetId` through
    `sceneChoiceLock`, and call `requireFeature(ctx.plan, key)` when it returns a key.
  - Throw if `ctx.plan` is null, as `requireChoices` in `services/brand.ts` does.
- [ ] **Step 4: `applyDesign`.** A saved look's `sceneAsset` is deleted when the plan lacks its kind's feature, as it
  is today for a file the restaurant may not use.
- [ ] **Step 5: `designState`.**
  - Take `plan: { entitlements; upgrade }` and return `plan`.
  - `queries/design.ts` passes `ctx.plan.entitlements` and `await upgradeInfo(ctx.db, ctx)`. It throws when
    `ctx.plan` is null, as `brand.get` does.
- [ ] **Step 6: Duplicating.** After `clampBrandChoices` in `duplicateMenu`, read `copied.design`. When its
  `sceneAsset` names a file whose kind `destination` lacks (the kind comes from
  `source.snapshot.brand.design?.media?.kind`), write the design back without `sceneAsset`.
- [ ] **Step 7: Run** `BUZZIFY_DB_PORT=54351 npx vitest run tests/studio`. Everything passes, including
  `cross-tenant`, `plan-locks` and `design`.
- [ ] **Step 8: Commit** with the message `feat(design): a scene file the plan lacks is refused on save, dropped on apply and copy`.

### Task 4: The Studio shows what is locked

**Files:**
- Modify: `src/studio/workspace/design/ScenePicker.tsx`
- Modify: `src/studio/workspace/design/Customizer.tsx` (`SceneFile`, `MotionPanel`, `Customizer`)
- Modify: `src/studio/messages/{en,ar,ckb}.ts`

**Interfaces:**
- Consumes: `DesignView.plan` (Task 3), `UpgradeHint` / `LockMark` from `@/studio/plans/UpgradeHint`, and
  `sceneFeature` (Task 2).
- Produces: `ScenePicker` props gain `allowed: SceneFileKind[]` and `upgrade: UpgradeInfo`. `current` stays the stored
  id.

- [ ] **Step 1: The picker.**
  - A row is locked when `row.scene` exists, its kind is not in `allowed`, and `row.id !== current`. Its button is
    `disabled`, dimmed (`opacity-50`), and shows a `LockMark` at `start-1.5 top-1.5`.
  - The filter chip of a locked kind shows a `LockMark` too.
  - Under the grid, there is one `<UpgradeHint feature={…} info={upgrade} />` for each locked kind's feature. Iterate
    in the order `lottie`, `video`, `model`, which is catalog order: `design.backgroundAnimation`,
    `design.backgroundVideo`, `immersive.models3d`.
  - Upload is unchanged.
- [ ] **Step 2: The panel.**
  - `SceneFile` gets `lockedScene` and `upgrade` (threaded from `Customizer` through `MotionPanel`).
  - When the chosen file's feature equals `lockedScene`, it shows
    `t('brand.lockedChoice', { fallback: t('design.motion.fileNone'), choice: t('plans.feature.<key>') })`, then
    `<UpgradeHint feature={lockedScene} info={upgrade} />`.
  - Change, Remove and the framing sliders stay as they are.
  - `DesignStudio` passes `state.plan` to `Customizer`.
  - The live preview message is unchanged: it already plays the file.
- [ ] **Step 3: Typecheck and lint.** Run `npm run typecheck` and
  `npx eslint src tests scripts prisma eslint.config.mjs`. Both are clean.
- [ ] **Step 4: Check it in the browser.**
  - Seed the worktree database and run the dev server on 3121.
  - Move a demo restaurant on Pro, or a throwaway one, to the state needed.
  - In the Design tab's Motion panel:
    - the picker shows video and model tiles locked and the two Premium hints;
    - a Lottie file can be chosen;
    - a stored video on Pro shows the line and the hint, and the live preview plays it.
  - Take a screenshot.
- [ ] **Step 5: Commit** with the message `feat(studio): the background file picker and panel show what the plan locks`.

### Task 5: Guests on a lower plan, in the browser

**Files:**
- Modify: `tests/e2e/helpers/scene-menus.ts`
- Modify: `tests/e2e/scene-files-stage.spec.ts`

**Interfaces:**
- Produces: `SceneMenus.slugs` gains `lockedVideo`. This is the recorded video under a second throwaway restaurant
  created with `plan: 'PRO'`. `remove()` deletes both restaurants and their files.

- [ ] **Step 1: Write the test.** In `describe('a video')`, add the test
  `on a plan without background video, guests get the template’s scene`:
  - `goto(menu('lockedVideo'))`;
  - `data-plan` is not `video` or `videoStill` after `IDLE`;
  - `page.locator('video')` has count 0;
  - `layer(page).locator('[data-file="video"]')` has count 0.
- [ ] **Step 2: Run it before the helper changes.** It fails on the missing slug.
- [ ] **Step 3: Extend `createSceneMenus`.** Factor `sceneMenu` so that it takes the restaurant id. Store the video
  again under the Pro restaurant.
- [ ] **Step 4: Run the scene files suite.**
  `E2E_PORT=3121 BUZZIFY_DB_PORT=54351 npx playwright test tests/e2e/scene-files-stage.spec.ts`. Every test passes.
- [ ] **Step 5: Commit** with the message `test(e2e): guests on Pro get the template's scene instead of a background video`.

### Task 6: Verification

- [ ] Run `npm run typecheck`. It is clean.
- [ ] Run `npx eslint src tests scripts prisma eslint.config.mjs`. It is clean.
- [ ] Run `BUZZIFY_DB_PORT=54351 npm test`. Everything passes.
- [ ] Run the affected Playwright suites:
  `E2E_PORT=3121 BUZZIFY_DB_PORT=54351 npx playwright test tests/e2e/scene-files-stage.spec.ts tests/e2e/plans.spec.ts`,
  plus the Design tab's suite, if one exists (`tests/e2e/*design*`). Everything passes.
- [ ] Check `git diff --stat` for whole-file CRLF churn.
- [ ] Ask the user before pushing.
