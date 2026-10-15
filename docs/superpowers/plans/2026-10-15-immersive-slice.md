# Immersive Slice Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give the menu a designed look, a lit 3D burger stage with option-driven changes, and a purposeful motion language, on the signature hero and the product sheet.

**Architecture:** The engine, data and tenant layers stay. A pure module decides which burger layers exist from the selected options; a lazy-loaded React Three Fiber scene draws exactly that list; the server-rendered SVG art is the poster and the fallback. One nullable column lets an option declare its visual effect. The rest is presentation.

**Tech Stack:** three, @react-three/fiber 9 (React 19), Motion for React, Tailwind 4, Vitest, Playwright (software WebGL).

**Spec:** `docs/superpowers/specs/2026-10-15-immersive-slice-design.md`

## Global Constraints

- No push. Work on `main`. The stash `wip: LCP session edits` stays untouched.
- Money, pricing, cart, i18n, tenant isolation behave exactly as before; their tests are not edited except to add cases.
- Colours come from the existing tokens; new values are derived with `color-mix` only.
- DOM motion uses transform and opacity only; respect `prefers-reduced-motion`.
- The menu route's initial JavaScript does not import `three` or `@react-three/fiber`.
- `npm run typecheck`, `npm run lint`, `npx vitest run`, `npx playwright test` are green at the end of every task that touches code.

## Review Focus

- WebGL context creation fails or is lost: the poster must stay and nothing throws.
- Toggling options rapidly (on, off, on) must end in the state of the last toggle with no stale layer.
- Repeated open and close of the sheet must dispose geometries, textures and the renderer.
- RTL (`/ar`, `/ckb`): hero text and rail mirror; the 3D object is not mirrored.
- Hidden tab or offscreen hero: the render loop stops.

---

### Task 1: Dependencies and the option `visualKey`

**Files:**
- Modify: `package.json`, `prisma/schema.prisma`, `src/server/domain/types.ts`, `src/server/data/catalog-loader.ts`, `src/server/data/menu-view.ts`, `prisma/seed/validate.ts`, `prisma/seed/apply.ts`, `prisma/seed/atelier.ts`
- Create: `prisma/migrations/<timestamp>_option_visual_key/migration.sql` (by `prisma migrate dev`)
- Test: `tests/seed/validate.test.ts`, `tests/data/menu-view.test.ts`

**Interfaces:**
- Produces: `type VisualKey = 'cheese' | 'patty' | 'bacon'` and `VISUAL_KEYS` exported from `src/server/domain/types.ts`; `CatalogOption.visualKey: VisualKey | null`; `MenuOptionView.visualKey: VisualKey | null`.

- [ ] **Step 1:** Install: `npm install three @react-three/fiber` and `npm install -D @types/three`. Expected: exit 0; `package.json` lists the three packages.
- [ ] **Step 2:** Write failing tests: seed validation rejects `visualKey: 'sparkles'` and accepts `'cheese'`; `buildMenuView` maps an option's `visualKey` through and defaults to `null`. Run them. Expected: FAIL (property missing).
- [ ] **Step 3:** Add `visualKey String?` to `ModifierOption`; run `npx prisma migrate dev --name option_visual_key`; add the domain type, loader mapping, view field, seed validation and apply; set `visualKey` on Premium cheese (`cheese`), Double patty (`patty`), Bacon (`bacon`) in the ATELIER seed.
- [ ] **Step 4:** Run the two test files, then `npm run typecheck`. Expected: PASS, no type errors. Re-seed the dev database: `npm run db:seed`.
- [ ] **Step 5:** Commit: `feat(data): options can declare a visual effect (visualKey)`.

### Task 2: Stage model logic (pure)

**Files:**
- Create: `src/lib/stage.ts`, `tests/lib/stage.test.ts`

**Interfaces:**
- Produces:
  - `type LayerKind = 'bun-bottom' | 'lettuce' | 'tomato' | 'patty' | 'patty-2' | 'bacon' | 'cheese' | 'pickles' | 'bun-top'`
  - `interface Layer { key: LayerKind; y: number; height: number }` (`y` is the layer's centre above the disc)
  - `interface BurgerSelection { cheese: boolean; patty: boolean; bacon: boolean }`
  - `burgerLayers(selection: BurgerSelection): Layer[]` bottom to top
  - `selectionFromOptions(options: Array<{ id: string; visualKey: string | null }>, selectedIds: string[]): BurgerSelection`
  - `qualifiesFor3D(env: { webgl: boolean; saveData: boolean; deviceMemory?: number; cores?: number; forced?: 'on' | 'off' }): boolean`
  - `isStageArt(art: string): art is 'burger'`

- [ ] **Step 1:** Write the failing tests:

```ts
import { describe, expect, it } from 'vitest';
import { burgerLayers, qualifiesFor3D, selectionFromOptions } from '@/lib/stage';

const none = { cheese: false, patty: false, bacon: false };

describe('burgerLayers', () => {
  it('stacks the plain burger bottom to top', () => {
    expect(burgerLayers(none).map((l) => l.key)).toEqual(['bun-bottom', 'lettuce', 'tomato', 'patty', 'pickles', 'bun-top']);
  });
  it('adds a second patty directly above the first and raises everything above it', () => {
    const plain = burgerLayers(none);
    const double = burgerLayers({ ...none, patty: true });
    expect(double.map((l) => l.key)).toEqual(['bun-bottom', 'lettuce', 'tomato', 'patty', 'patty-2', 'pickles', 'bun-top']);
    const top = (layers: typeof plain) => layers[layers.length - 1]!.y;
    expect(top(double)).toBeGreaterThan(top(plain));
  });
  it('puts cheese above the top patty and bacon below the cheese', () => {
    const keys = burgerLayers({ cheese: true, patty: true, bacon: true }).map((l) => l.key);
    expect(keys.indexOf('bacon')).toBeLessThan(keys.indexOf('cheese'));
    expect(keys.indexOf('patty-2')).toBeLessThan(keys.indexOf('bacon'));
    expect(keys.indexOf('cheese')).toBeLessThan(keys.indexOf('pickles'));
  });
  it('never overlaps layers and has unique keys', () => {
    const layers = burgerLayers({ cheese: true, patty: true, bacon: true });
    expect(new Set(layers.map((l) => l.key)).size).toBe(layers.length);
    for (let i = 1; i < layers.length; i++) {
      const below = layers[i - 1]!;
      const here = layers[i]!;
      expect(here.y - here.height / 2).toBeGreaterThanOrEqual(below.y + below.height / 2 - 1e-9);
    }
  });
});

describe('selectionFromOptions', () => {
  const options = [
    { id: 'a', visualKey: 'cheese' },
    { id: 'b', visualKey: 'patty' },
    { id: 'c', visualKey: null },
  ];
  it('turns selected option ids into visual flags', () => {
    expect(selectionFromOptions(options, ['b', 'c'])).toEqual({ cheese: false, patty: true, bacon: false });
  });
  it('ignores unknown ids', () => {
    expect(selectionFromOptions(options, ['zzz'])).toEqual(none);
  });
});

describe('qualifiesFor3D', () => {
  const ok = { webgl: true, saveData: false };
  it('accepts a capable device', () => expect(qualifiesFor3D({ ...ok, deviceMemory: 8, cores: 8 })).toBe(true));
  it('accepts when memory and cores are not exposed', () => expect(qualifiesFor3D(ok)).toBe(true));
  it('refuses without WebGL, on data saver, on low memory or few cores', () => {
    expect(qualifiesFor3D({ ...ok, webgl: false })).toBe(false);
    expect(qualifiesFor3D({ ...ok, saveData: true })).toBe(false);
    expect(qualifiesFor3D({ ...ok, deviceMemory: 2 })).toBe(false);
    expect(qualifiesFor3D({ ...ok, cores: 2 })).toBe(false);
  });
  it('lets the user force it off or on', () => {
    expect(qualifiesFor3D({ ...ok, forced: 'off' })).toBe(false);
    expect(qualifiesFor3D({ webgl: true, saveData: true, deviceMemory: 2, forced: 'on' })).toBe(true);
    expect(qualifiesFor3D({ webgl: false, saveData: false, forced: 'on' })).toBe(false);
  });
});
```

- [ ] **Step 2:** `npx vitest run tests/lib/stage.test.ts`. Expected: FAIL (module not found).
- [ ] **Step 3:** Implement `src/lib/stage.ts`. Layer heights: bun-bottom 0.34, lettuce 0.10, tomato 0.09, patty 0.26, patty-2 0.26, bacon 0.06, cheese 0.05, pickles 0.06, bun-top 0.52. `y` is the running sum plus half the layer's height. Order as in the tests.
- [ ] **Step 4:** Run the test file again. Expected: PASS.
- [ ] **Step 5:** Commit: `feat(stage): pure burger layer model and 3D device rule`.

### Task 3: The 3D renderer

**Files:**
- Create: `src/ui/stage/burger-parts.ts`, `src/ui/stage/BurgerCanvas.tsx`, `tests/ui/burger-parts.test.ts`

**Interfaces:**
- Consumes: `Layer`, `burgerLayers`, `BurgerSelection` from Task 2.
- Produces: `makeBun(kind: 'bottom' | 'top'): BufferGeometry`, `makePatty(): BufferGeometry`, `makeCheese(): BufferGeometry`, `makeLettuce(): BufferGeometry`, `makeDisc(kind: 'tomato' | 'pickles'): BufferGeometry`; `BurgerCanvas` default-export-compatible named export `BurgerCanvas({ selection, tone, variant, reveal, paused, onReady })` where `onReady()` is called once after the first rendered frame.

Geometry parameters (radius 1.0 is the burger's outer radius):

| Part | Construction |
|---|---|
| Bun bottom | Lathe, profile from (0.0, 0.0) to (0.96, 0.06) to (1.0, 0.18) to (0.94, 0.34); 48 segments |
| Bun top | Lathe, dome profile to height 0.52 at centre; 48 segments; 40 sesame ellipsoids as one `InstancedMesh` |
| Patty | Lathe, rounded edge, radius 1.04, height 0.26; bump from a 256 px canvas noise texture |
| Cheese | Plane 2.3 by 2.3, 24 by 24 segments, corners drooped by `-0.22 * smoothstep(0.7, 1.15, r)` |
| Lettuce | Ring of radius 1.1 with `0.05 * sin(7 * theta)` ruffle in height, 64 segments |
| Tomato, pickles | Cylinders radius 0.82 and 0.62, 32 segments |

- [ ] **Step 1:** Write failing tests in Node (no WebGL needed): every geometry has a non-empty position attribute; bun-bottom height is within 0.34 plus or minus 0.02; patty radius within 1.0 to 1.1; cheese's lowest vertex is below its centre height and its widest extent exceeds the patty radius; geometries contain no NaN.
- [ ] **Step 2:** `npx vitest run tests/ui/burger-parts.test.ts`. Expected: FAIL (module not found).
- [ ] **Step 3:** Implement `burger-parts.ts`. Then `BurgerCanvas.tsx`: `Canvas` with `dpr={[1, 2]}`, `gl={{ antialias: true, alpha: true, powerPreference: 'high-performance' }}`, `frameloop` driven by `paused`, `RoomEnvironment` via `PMREMGenerator` set as `scene.environment`, one warm key light, a champagne metal disc (metalness 1, roughness 0.28), a baked radial contact shadow plane, pointer-drag rotation with inertia and arrow-key rotation, idle turn of 8 degrees per second, layers keyed by `Layer.key` with spring-in on mount and spring-out on removal, camera eased on stack height change. Dispose geometries, textures and the PMREM target on unmount.
- [ ] **Step 4:** Run the test file and `npm run typecheck && npm run lint`. Expected: PASS, clean.
- [ ] **Step 5:** Commit: `feat(stage): procedural burger scene`.

### Task 4: Stage component, poster and wiring

**Files:**
- Create: `src/ui/stage/ProductStage.tsx`, `tests/e2e/stage.spec.ts`
- Modify: `src/ui/menu/SignatureFeature.tsx`, `src/ui/product/ProductDetail.tsx`, `src/lib/messages/{en,ar,ckb}.ts` (stage labels), `src/lib/messages/index.ts` if keys are typed

**Interfaces:**
- Consumes: Task 1 and 2 outputs; `ProductVisual` as the poster.
- Produces: `ProductStage({ product, selectedIds, variant, className, priority })`. Wrapper attributes: `data-stage-state` (`poster` | `loading` | `ready` | `unavailable`) and `data-stage-layers` (comma-joined layer keys). Wrapper is `role="img"` with `aria-label` naming the product and selected extras.

- [ ] **Step 1:** Write failing e2e: (a) menu loads, hero stage reaches `data-stage-state="ready"` and `data-stage-layers` equals the plain stack; (b) opening the Atelier Burger sheet and choosing Premium cheese adds `cheese`, then Double patty adds `patty-2`, unchecking removes it; (c) `/atelier/en?stage=off` keeps `data-stage-state="unavailable"` and the SVG poster visible; (d) the stage label mentions the selected extras. Run. Expected: FAIL.
- [ ] **Step 2:** Implement `ProductStage`: renders `ProductVisual` as poster; after `requestIdleCallback` (fallback `setTimeout`) evaluates `qualifiesFor3D` using `navigator.deviceMemory`, `hardwareConcurrency`, `connection.saveData`, a throwaway `canvas.getContext('webgl2' | 'webgl')` probe and the `stage` query value; dynamic-imports `BurgerCanvas` with `ssr: false`; crossfades on `onReady`. Wrap the canvas in an error boundary that sets `unavailable`. Pause the canvas when offscreen (IntersectionObserver) or `document.hidden`.
- [ ] **Step 3:** Use `ProductStage` in `SignatureFeature` (variant `hero`) and in `ProductDetail` (variant `sheet`, `selectedIds={selected}`) for products whose first media item is `art: 'burger'`; other products keep `ProductVisual`.
- [ ] **Step 4:** Run `npx playwright test tests/e2e/stage.spec.ts` then the whole suite. Expected: PASS; existing 62 still pass.
- [ ] **Step 5:** Commit: `feat(stage): 3D burger on the hero and the product sheet`.

### Task 5: New visual identity

**Files:**
- Modify: `src/app/globals.css`, `src/ui/menu/Header.tsx`, `src/ui/menu/MenuApp.tsx` (search field), `src/ui/menu/SignatureFeature.tsx`, `src/ui/menu/ProductRow.tsx`, `src/ui/menu/CategoryRail.tsx`, `src/ui/Sheet.tsx`, `src/ui/product/ProductDetail.tsx`
- Test: existing e2e suite plus `tests/e2e/a11y.spec.ts` additions if new landmarks appear

**Interfaces:** consumes the tokens in `globals.css`; produces new utility classes `.stage-light` (light pool and vignette), `.plate` (ringed circular thumbnail).

- [ ] **Step 1:** Add failing assertions to the e2e suite: the hero name is a heading whose computed font size is at least 44 px at a 390 px viewport; the search field is still found by role `searchbox`; the active category indicator exists exactly once; no horizontal scroll at 390 px in `en` and `ar`.
- [ ] **Step 2:** Run them. Expected: FAIL on the new assertions only.
- [ ] **Step 3:** Implement the look from spec section 3 using logical CSS properties (RTL safe). No new colours except `color-mix` derivations.
- [ ] **Step 4:** Run the whole e2e suite, axe included. Expected: PASS.
- [ ] **Step 5:** Commit: `feat(ui): designed look for header, hero, rows, rail and sheet`.

### Task 6: Motion language, verification and report

**Files:**
- Create: `src/ui/motion.ts` (easing and spring constants), `src/ui/RollingMoney.tsx`
- Modify: `src/ui/menu/SignatureFeature.tsx` (scroll drift), `src/ui/product/ProductDetail.tsx` (rolling price), `src/ui/menu/ProductRow.tsx`, `src/ui/cart/CartBar.tsx` (press feedback), `tests/e2e/motion.spec.ts`, `README.md`

**Interfaces:** produces `EASE_OUT = [0.23, 1, 0.32, 1]`, `SPRING = { type: 'spring', duration: 0.4, bounce: 0.12 }`, and `RollingMoney({ value })` that renders `money(value)` and tweens between values.

- [ ] **Step 1:** Write failing e2e: with reduced motion, the stage never gains an idle rotation (`data-stage-turning="false"`), layers are present immediately, and the hero has no scroll drift transform; without reduced motion, scrolling 300 px changes the hero's transform; the add button's text equals the formatted total once the roll settles.
- [ ] **Step 2:** Run. Expected: FAIL.
- [ ] **Step 3:** Implement `motion.ts`, `RollingMoney`, hero scroll drift with `useScroll` and `useTransform` (transform and opacity only), press scale on pressable rows and buttons.
- [ ] **Step 4:** Run `npm run typecheck`, `npm run lint`, `npx vitest run`, `npx playwright test`. Expected: all green. Then `npm run perf` and record the new baseline in `docs/perf/`.
- [ ] **Step 5:** Update the README (3D stage, `?stage=off`, device rule, fallback). Commit: `feat(motion): motion language, rolling price, scroll drift; docs and perf baseline`.
