# Template Studio, Stage 1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Thirty selectable menu presets with distinct layouts and a static, motion and real 3D background each, chosen
and customized per business in a new Studio Design tab, without changing menu content or URLs.

**Architecture:** Presets are code in `src/lib/templates`; a business stores only its template id and overrides on
`BrandConfig`; publishing resolves both into `BrandView.design` in the immutable snapshot. The public page renders
`TemplateMenu` when a design is present and the unchanged `MenuApp` otherwise. One fixed background `SceneLayer` per
menu picks static, motion or 3D and loads only the selected preset's scene.

**Tech Stack:** Next.js 16 (App Router), React 19, Prisma 7 on PostgreSQL, Zod 4, Tailwind 4, three 0.186 with
@react-three/fiber 9, Vitest 5, Playwright 1.64.

**Spec:** `docs/superpowers/specs/2026-10-18-template-studio-design.md`

## Global Constraints

- A menu without `templateId` renders exactly as today and its draft and live hashes do not change.
- Every preset and curated palette passes the blocking contrast rules (text and muted on bg, surface, card ≥ 4.5:1; onButton on button ≥ 3:1).
- Studio code never reaches public menu routes (existing ESLint fence); `framer-motion` stays out of the menu's initial chunk; three.js only in lazily loaded scene chunks.
- Every Studio operation uses `defineAction` or `defineQuery` (existing static test).
- All new interface text exists in `en`, `ar` and `ckb` (existing message tests); Arabic and Sorani are machine-drafted and flagged for review.
- Layout uses logical properties; RTL pages mirror navigation, details, option selectors and forms.
- Touch targets ≥ 44 px; no hover-only actions; visible focus; dialogs use native `<dialog>`.
- No invented dietary, allergen, popularity or discount claims: badges and tags render only from the data.
- Demo restaurants are named "(Demo)" and seeded only through `prisma/seed`; real menus are never written by the seed.

## Review Focus

1. A menu with one category or one product, or none with a photo: every hero and card kind still lays out (no empty frames, no broken grid). Test: render every preset with a one-product catalog in `tests/ui/template-menu.test.tsx`.
2. Long Arabic and Sorani names at 375 px: no horizontal overflow on any preset. Test: e2e `template-presets.spec.ts` checks `scrollWidth <= innerWidth` for all 30 in `ckb`.
3. Switching template after customizing: overrides survive a switch back, and Reset clears only overrides. Test: `tests/studio/design.test.ts`.
4. WebGL unavailable or throwing: the menu still shows the static poster and everything works. Test: e2e with `?stage=off` and a forced scene error flag `?scene=fail` (preview-only switch that throws inside the scene).
5. Restore and duplicate of a template menu keep the template, overrides and featured items. Test: `tests/publish/draft.test.ts`.

---

### Task 1: Template core (pure)

**Files:**
- Create: `src/lib/templates/types.ts`, `src/lib/templates/palette.ts`, `src/lib/templates/presets/{restaurant,cafe,bakery,icecream}.ts`, `src/lib/templates/index.ts`, `src/lib/templates/resolve.ts`
- Modify: `src/lib/palette.ts` (export `contrastRatio`, add `designPaletteProblems`)
- Test: `tests/lib/templates.test.ts`

**Interfaces:**
- Produces: `TEMPLATE_IDS`, `TemplateId`, `isTemplateId(v)`, `TEMPLATES: Record<TemplateId, TemplatePreset>`, `templateList(): TemplatePreset[]` (by number), `DesignPalette`, `DesignOverrides`, `MenuDesign`, `parseOverrides(json: unknown): DesignOverrides` (drops anything invalid), `resolveDesign(preset, overrides, extras: { info, poweredBy }): MenuDesign`, `designPaletteProblems(p: DesignPalette): PaletteProblem[]`.

- [ ] Tests: 30 presets numbered 1–30 with unique ids; each business has its presets (10 restaurant, 8 café, 7 bakery, 5 ice cream); every palette and every curated alternative (≥ 3 per preset) has no blocking problem; at least 20 distinct (hero, nav, card) triples; `resolveDesign` with `{}` returns the preset's values; overrides win field by field; an unknown palette id is ignored; `parseOverrides` drops bad colours, unknown kinds and out-of-range numbers.
- [ ] Implement; run `npx vitest run tests/lib/templates.test.ts` → PASS.
- [ ] Commit `feat(templates): thirty presets as data, overrides and the resolved design`.

### Task 2: Font pairs

**Files:** `src/lib/font-pairs.ts`, `src/app/fonts.ts`, `src/app/globals.css`, `package.json`; Test: `tests/lib/font-pairs.test.ts`, `tests/studio/fonts.test.ts`

- [ ] Add the pairs the presets name (fontsource 400 Latin files; Arabic faces only from those with full Sorani coverage, checked by the existing coverage test).
- [ ] Run `npx vitest run tests/lib/font-pairs.test.ts tests/studio/fonts.test.ts` → PASS. Commit.

### Task 3: Database

**Files:** `prisma/schema.prisma`, `prisma/migrations/20261018120000_template_studio/migration.sql`, `src/server/data/tenant-db.ts`; Test: `tests/data/tenant-registry.test.ts`

- [ ] Add the fields and `DesignTemplate` (spec 4.3), classify `DesignTemplate` in `RESTAURANT_OR_SHARED_MODELS`.
- [ ] `npm run db:migrate` applies; `npx vitest run tests/data` → PASS. Commit.

### Task 4: Snapshot

**Files:** `src/server/data/tenant.ts` (`BrandView.design?: MenuDesign`), `src/server/domain/snapshot.ts` (schema), `src/server/publish/draft.ts` (`brandView` resolves the design from `templateId`, `design` and the restaurant; `brandRowFromSnapshot` writes `templateId`, `design`, `customTemplateId` back); Test: `tests/publish/draft.test.ts`, `tests/domain/snapshot.test.ts`

- [ ] Tests: a menu without a template hashes as before (existing fixture `atelier-snapshot-2a.json`); with a template the snapshot carries `design` with the restaurant's details only when enabled; restore and duplicate round-trip `templateId` and overrides; `parseSnapshot` accepts old snapshots and rejects an unsafe URL in the design.
- [ ] Implement; run the two files → PASS. Commit.

### Task 5: Public renderer

**Files:** Create `src/ui/template/` (`TemplateMenu.tsx`, `design-style.ts`, `heroes/*.tsx`, `navs/*.tsx`, `cards/*.tsx`, `DetailSurface.tsx`, `OptionChoices.tsx`, `InfoSection.tsx`, `Filters.tsx`, `favorites.ts`, `skins.css`); Modify `src/app/[tenant]/[locale]/page.tsx`, `.../p/[slug]/page.tsx`, `.../cart/page.tsx`, preview pages, `src/ui/AppProviders.tsx` (`ordering`), `src/ui/cart/CartBar.tsx`, `src/lib/messages/*`; Test: `tests/ui/template-menu.test.tsx`, `tests/lib/messages.test.ts`

**Interfaces:** `TemplateMenu({ view: MenuView, design: MenuDesign })`; `designStyle(design): React.CSSProperties`.

- [ ] Tests (jsdom render): every preset renders categories, product names and prices; a one-product catalog renders for every preset; ordering `none` renders no add buttons and no cart bar; RTL root has `dir` inherited and navigation order mirrors.
- [ ] Implement; run tests → PASS; check `/atelier/en` unchanged in the browser. Commit.

### Task 6: Scenes

**Files:** Create `src/ui/scenes/` (`SceneLayer.tsx`, `signal.ts`, `posters.tsx`, `motion.tsx`, `three/SceneCanvas.tsx`, `three/kit/*.tsx`, `three/scenes/{id}.tsx`, `three/index.ts`); Test: `tests/ui/scene-signal.test.ts`, e2e `template-scenes.spec.ts`

**Interfaces:** `SceneLayer({ design })`; `createSceneSignal(): SceneSignal` (`progress`, `tap`, `pointer`); `loadScene(id): Promise<SceneComponent>`; `effectiveMode(requested, env): VisualMode`.

- [ ] Tests: `effectiveMode` (reduced motion → static; 3D without WebGL → motion; save-data → static for 3D and motion video); scroll progress clamps 0–1 and is symmetric; taps on interactive targets are ignored.
- [ ] Implement posters and motion for all 30, then 3D scenes in batches of ten, checking each batch in the browser.
- [ ] E2E: one canvas at most; `?stage=off` gives no canvas; `?scene=fail` (preview only) falls back to the poster. Commit per batch.

### Task 7: Studio Design tab

**Files:** Create `src/server/studio/services/design.ts`, `src/server/studio/actions/design.ts`, `src/server/studio/queries/design.ts`, `src/app/studio/_actions/design.ts`, `src/app/studio/(studio)/(app)/menus/[id]/design/page.tsx`, `src/studio/workspace/design/*`; Modify `src/studio/workspace/tabs.ts`, `src/studio/messages/*`, `src/studio/workspace/brand/BrandForm.tsx`, preview route (`?template=` and live messages); Test: `tests/studio/design.test.ts`, `tests/studio/workspace-tabs.test.ts`, e2e `studio-design.spec.ts`

**Interfaces:** actions `design.apply({ menuId, version, templateId | customTemplateId })`, `design.update({ menuId, version, overrides })`, `design.reset({ menuId, version })`, `design.saveCustom({ menuId, name, shared })`, `design.duplicatePreset({ menuId, presetId, name })`, `design.deleteCustom({ menuId, id })`, `design.poweredBy({ restaurantId, show })` (Super Admin only); query `design.get({ menuId })`.

- [ ] Tests: apply keeps content and slug; update refuses blocking palettes and stale versions; reset clears overrides only; owners without `brand.edit` are refused; another restaurant's custom template is not found; only Super Admins save shared templates or change Powered by.
- [ ] Implement; run tests → PASS; drive the tab in the browser. Commit.

### Task 8: Demo menus, art and thumbnails

**Files:** `prisma/seed/{maison,gelateria,table}.ts`, `prisma/seed.ts`, `src/lib/media.ts` and `src/ui/art/ProductArt.tsx` (`scoop`, `cake`, `bread`), `scripts/template-thumbnails.ts`, `public/templates/*.webp`; Test: `tests/seed/demo-menus.test.ts`

- [ ] Seed three demo restaurants with options that exercise café, bakery and ice cream presets; run `npm run db:seed`; generate thumbnails; commit.

### Task 9: Verification and docs

- [ ] `npm run typecheck`, `npm run lint`, `npm test`, the new e2e files and the existing menu e2e files pass.
- [ ] README: the Design tab, presets, modes, and what stages 2–5 will add.

## Status (2026-10-18)

Built and checked in the worktree `buzzify-menu-templates` (branch `template-studio`), not yet committed:

- Tasks 1–4 done as planned (`tests/lib/templates.test.ts`, `tests/publish/draft.test.ts`, `tests/domain/snapshot.test.ts`).
- Task 5: the renderer is checked in the browser for all 30 presets at phone width and by `tests/e2e/template-menus.spec.ts`
  (three demo menus × three languages: layout direction, no horizontal scroll, axe with no serious problem, product
  dialog open and close). The jsdom render test was replaced by those browser checks.
- Task 6: posters, motion and a 3D scene for all 30, each rendered with software WebGL and looked at;
  `tests/ui/scene-signal.test.ts` and `tests/e2e/template-stage.spec.ts` (one canvas, reduced motion, `?scene=fail`).
- Task 7: `tests/studio/design.test.ts` (14 cases), the workspace tabs test, and the design actions in the
  cross-tenant sweep.
- Task 8: `maison-demo`, `onda-demo` and `noor-demo` seeded and published; thumbnails by `npm run studio:thumbnails`
  (`tests/e2e/template-thumbnails.gen.ts`), not by a separate script.
- Task 9: `typecheck`, `lint` and the whole Vitest suite pass; the README has the Template Studio section. The rest of
  the e2e suite was not run against this branch yet. ATELIER, drawn with a template by an earlier check, was put back to
  classic (revision 5, `npm run studio:template -- atelier classic --apply`).
