# Motion Studio Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A library of 150 reusable motions (the "Buzzify Menu — Complete Motion Graphics & Animation Library" list) and a
Motion area in the Studio where designers watch every motion live, tune it, and copy the code that reuses it.

**Architecture:** `src/motion/` is a self-contained library: a light catalog (ids, numbers, categories, parameters), one
file per motion loaded on demand, and three engines (DOM with CSS and `motion`, Canvas 2D, and WebGL through one shared
three.js renderer that draws into each motion's own 2D canvas, so 150 previews never exhaust the browser's WebGL
contexts). The Studio adds `/studio/motion` (gallery) and `/studio/motion/[id]` (stage, controls, usage snippet).

**Tech Stack:** Next.js 16 App Router, React 19 (`<style href precedence>` for each motion's own keyframes), `motion`
14, `three` 0.186 (procedural dish parts from `src/ui/stage/stage-parts.ts`), Tailwind 4 in the Studio only, Vitest,
Playwright.

**Spec:** the user's motion list (150 items in 10 groups of 15), given in chat on 2026-10-18. The user opted out of
questions ("start, and don't ask a lot"); the decisions below are the builder's calls.

## Global Constraints

- No new dependencies. Motion is built from `motion`, `three`, CSS, Canvas 2D and SVG.
- Numbers and names follow the user's list exactly: #1 to #150, groups of 15 in the list's order.
- Motion files use no Tailwind classes (the Studio and the menu have separate Tailwind builds); styles are inline or a
  React 19 `<style href="bzm-…" precedence="motion">` block in the motion's own file.
- Studio text exists in English, Arabic and Sorani (the messages test enforces parity).
- Arabic-script text is never split into single letters: split with `meltPieces` from `src/lib/joining.ts`, and never
  animate `letter-spacing` on it.
- Every motion pauses off screen, honours `prefers-reduced-motion` (a still frame) unless the viewer asks to play, and
  keeps working when WebGL is missing (a still fallback, no crash).
- The Motion area is for Super Admins and designers; an owner-only person is sent to `/studio`, as on Media.

## Review Focus

1. Arabic or Sorani text typed into a typography motion keeps its joined letters (pieces from `meltPieces`).
2. Scrolling the gallery fast through 150 cards never loses WebGL (one shared renderer; previews unmount off screen).
3. A device without WebGL shows each 3D card's still fallback, and the rest of the gallery keeps running.
4. A parameter outside its range (a hand-edited snippet, an old saved value) is clamped, not passed through.
5. Reduced motion: previews stay still until the viewer turns "Play previews" on.

---

## File Structure

```
src/motion/
  types.ts            MotionMeta, ParamSpec, MotionProps, categories, engines, drives
  params.ts           resolveParams(meta, partial) — defaults, clamping, type checks
  progress.ts         pingPong(t, travel, hold) — the auto-demo progress curve
  catalog/<group>.ts  15 MotionMeta per group; catalog/index.ts joins them (MOTIONS, motionById)
  loaders.ts          id → () => import('./<group>/<id>') for all 150
  Motion.tsx          <Motion id params playing speed progress dir/> — lazy load, defaults, error boundary
  engine/
    ticker.ts         one requestAnimationFrame loop for every motion
    visible.ts        useVisible(ref) — IntersectionObserver
    dom.tsx           <DomStage> — the box, --m-speed, paused state, base CSS; useSequence()
    pointer.ts        usePointerOrGhost(ref, playing, speed) — real pointer, else a gentle synthetic one
    canvas.tsx        <CanvasMotion create={(…) => Sketch}/> — DPR, resize, frame loop, still frame
    gl.ts             shared WebGLRenderer, renderView(view, ctx2d)
    GLMotion.tsx      <GLMotion create={(renderer) => GLSketch}/>
    shader.ts         shaderMotion({ fragment, uniforms }) — full-screen fragment shader motions
    dish.ts           dish meshes from stage-parts with materials matching the stage's
    goo.tsx           SVG goo filter for liquid motions on a canvas
    color.ts, math.ts small helpers (hex → rgb, lerp, easing, seeded random)
  three-d/ scroll/ luxury/ food/ interactive/ background/ micro/ type/ transition/ effects/
                      one file per motion, default export: ComponentType<MotionProps>
  index.ts            public API: Motion, MOTIONS, motionById, MOTION_CATEGORIES, resolveParams
src/studio/motion/
  MotionLibrary.tsx   gallery: search, category chips, play switch, sections of cards
  MotionCard.tsx      one card: number, name, preview mounted only in view (inert)
  MotionDetail.tsx    stage, play/pause, replay, speed, progress mode, controls, snippet, prev/next
  ParamControls.tsx   a control per ParamSpec
  search.ts           filterMotions(motions, { q, category }, nameOf)
  snippet.ts          usageSnippet(meta, params)
src/studio/messages/motion/{en,ar,ckb}.ts   names and one-line descriptions, spread into the main catalogs
src/app/studio/(studio)/(app)/motion/page.tsx, [id]/page.tsx
src/studio/nav.ts (+ 'motion' item), src/studio/shell/Sidebar.tsx (+ icon)
tests/motion/catalog.test.ts, params.test.ts, progress.test.ts
tests/studio/motion.test.ts (messages, search, snippet), tests/studio/nav.test.ts (updated)
tests/e2e/studio-motions.spec.ts
```

## Interfaces

```ts
export type MotionCategory = 'three-d' | 'scroll' | 'luxury' | 'food' | 'interactive' | 'background' | 'micro' | 'type' | 'transition' | 'effects';
export type MotionEngine = 'dom' | 'canvas' | 'webgl';
export type MotionDrive = 'time' | 'progress' | 'pointer';
export type ParamSpec =
  | { type: 'color'; default: string }
  | { type: 'range'; default: number; min: number; max: number; step: number }
  | { type: 'toggle'; default: boolean }
  | { type: 'choice'; default: string; options: readonly string[] }
  | { type: 'text'; default: string; maxLength: number; sample?: 'headline' | 'word' | 'brand' | 'words' };
export type MotionParams = Record<string, string | number | boolean>;
export interface MotionMeta { id: string; number: number; category: MotionCategory; engine: MotionEngine; drive: MotionDrive; params: Record<string, ParamSpec> }
export interface MotionProps { params: MotionParams; playing: boolean; speed: number; progress: MotionValue<number>; replay: number; dir: 'ltr' | 'rtl' }
export function resolveParams(meta: MotionMeta, given?: Partial<MotionParams>): MotionParams;
export function pingPong(seconds: number, travel: number, hold: number): number; // 0→1, hold, 1→0, hold, repeat; eased
export interface Frame { t: number; dt: number; width: number; height: number; progress: number; pointer: { x: number; y: number; inside: boolean; down: boolean }; params: MotionParams }
export interface Sketch { resize?(width: number, height: number): void; draw(ctx: CanvasRenderingContext2D, frame: Frame): void; pointerDown?(x: number, y: number): void }
export interface GLSketch { scene: Scene; camera: Camera; resize?(width: number, height: number): void; update(frame: Frame): void; pointerDown?(x: number, y: number): void; dispose(): void }
export function usageSnippet(meta: MotionMeta, params: MotionParams): string;
export function filterMotions(motions: readonly MotionMeta[], filter: { q: string; category: MotionCategory | 'all' }, nameOf: (id: string) => string): MotionMeta[];
```

Messages: `nav.motion`; `motion.<id>.name`, `motion.<id>.desc`; `motion.category.<category>`; `motion.param.<key>`;
`motion.option.<value>`; `motion.engine.<engine>`; `motion.drive.<drive>`; `motion.sample.<sample>`; page chrome under
`motion.library.*` and `motion.detail.*`.

## The 150 motions

Engine: D = DOM, C = Canvas 2D, G = WebGL. Drive: T = time, P = progress (scroll or transition), I = pointer.

| # | id | E | D | What it shows |
|---|---|---|---|---|
| 1 | product-rotation | G | T | a dish turning slowly on a plinth |
| 2 | product-spin-360 | G | T | a full eased 360° turn, a pause, again |
| 3 | product-reveal-3d | G | T | the dish rises out of darkness as the key light comes up |
| 4 | product-assembly | G | T | a mille-feuille's layers drop in one by one and settle |
| 5 | product-disassembly | G | T | a burger's layers lift apart, hold, and close |
| 6 | floating-objects | G | T | croissant, cup, lemon and ice drifting and turning |
| 7 | object-morphing | G | T | a gold sphere flowing into a ring and back |
| 8 | camera-flythrough | G | T | the camera glides along a row of dishes |
| 9 | camera-orbit | G | T | the camera circles a dish, rising and falling |
| 10 | depth-animation | G | T | dishes at depth in fog, the camera dollies in and out |
| 11 | layered-parallax-3d | G | I | layered cards shift in depth with the pointer |
| 12 | object-explosion | G | T | a faceted gem bursts into shards and reforms |
| 13 | physics-simulation | G | T | cherries fall into a bowl and bounce to rest |
| 14 | perspective-shift | G | T | a dolly zoom: the dish holds while the room stretches |
| 15 | scene-transition-3d | G | P | the camera pans from a warm scene to a cool one |
| 16 | scroll-scrub | D | P | a latte builds layer by layer with the scroll |
| 17 | scroll-triggered | D | P | menu rows spring in as the scroll passes them |
| 18 | scroll-rotation-3d | G | P | the dish turns with the scroll |
| 19 | scroll-product-reveal | D | P | a mask opens over the dish as the scroll goes on |
| 20 | scroll-storytelling | D | P | bean, roast, brew, cup: four chapters by scroll |
| 21 | scroll-parallax | D | P | layers of a plated scene at different speeds |
| 22 | scroll-zoom | D | P | a card grows to fill the frame |
| 23 | scroll-depth-transition | D | P | cards fly toward the viewer through depth |
| 24 | scroll-horizontal-gallery | D | P | a pinned row of dishes travels sideways |
| 25 | scroll-image-sequence | C | P | pre-drawn frames of a turning cup, picked by scroll |
| 26 | scroll-camera-movement | G | P | the camera travels over a table of dishes by scroll |
| 27 | scroll-object-morphing | C | P | bean → cup → heart outlines morph by scroll |
| 28 | scroll-synced-video | C | P | a film (or any video `src`) seeks with the scroll |
| 29 | scroll-color-transition | D | P | morning to evening palettes by scroll |
| 30 | scroll-particles | C | P | scattered grains gather into a word by scroll |
| 31 | cinematic-cgi | G | T | a cup on black glass, slow push, rim light, letterbox |
| 32 | luxury-product-reveal | G | T | a spotlight opens on the dish with a gold edge light |
| 33 | slow-motion | C | T | a bean falls into coffee, the crown splash in slow motion |
| 34 | golden-particles | C | T | gold dust drifting and glinting |
| 35 | metallic-reflection | D | T | brushed metal plate with a moving highlight |
| 36 | liquid-gold | G | T | a flowing liquid gold surface |
| 37 | glass-reflection | D | T | a glass panel over the dish with a reflection streak |
| 38 | holographic | D | I | an iridescent VIP card that shifts with the pointer |
| 39 | satin-silk | G | T | satin folds rolling with a soft sheen |
| 40 | cinematic-light-sweep | D | T | a beam sweeps across a dark title |
| 41 | soft-glow | D | T | a breathing glow behind the dish |
| 42 | volumetric-lighting | G | T | light shafts through floating dust |
| 43 | lens-flare | C | I | a light source with flare ghosts across the frame |
| 44 | depth-of-field | D | T | focus racks between foreground and background |
| 45 | premium-logo-reveal | D | T | a wordmark drawn in line, filled with gold, shine |
| 46 | coffee-pouring | C | T | a stream from the pot fills the cup |
| 47 | espresso-extraction | C | T | twin streams, crema building in the glass |
| 48 | coffee-beans-falling | C | T | beans tumbling and settling |
| 49 | coffee-steam | C | T | soft steam curling up from a cup |
| 50 | milk-splash | C | T | a milk crown splash |
| 51 | latte-art | C | T | a heart poured into crema |
| 52 | chocolate-dripping | C | T | chocolate drips running down |
| 53 | honey-flow | C | T | honey ribbon from a dipper, coiling into a pool |
| 54 | ice-cream-melting | C | T | a scoop melting down its cone |
| 55 | ice-cream-swirl | C | T | soft serve spiralling up |
| 56 | burger-layer-assembly | G | T | a burger built from the bun up, each layer squashing |
| 57 | pizza-cheese-stretch | C | T | a slice lifts away with cheese strings |
| 58 | ingredient-explosion | G | T | burger ingredients burst out and return |
| 59 | beverage-splash | C | T | a lemon slice drops into a glass with a splash |
| 60 | food-levitation | G | T | a croissant floating over its shadow, crumbs drifting |
| 61 | hover-scale | D | I | a card lifts and grows on hover |
| 62 | hover-3d-tilt | D | I | a card tilts toward the pointer with glare |
| 63 | interactive-product-rotation | G | I | the pointer turns the dish |
| 64 | cursor-follow | D | I | a ring trails the cursor and grows over targets |
| 65 | magnetic-button | D | I | a button pulled toward the pointer |
| 66 | interactive-product-zoom | D | I | a lens magnifies the dish under the pointer |
| 67 | click-to-expand | D | I | a menu row expands into its details |
| 68 | interactive-ingredient-reveal | D | I | a burger's layers part to name each ingredient |
| 69 | interactive-3d-menu | D | I | a ring of menu cards turned by drag |
| 70 | drag-to-rotate | G | I | drag turns the dish, with inertia |
| 71 | swipe-product-transition | D | I | swipe a stack of dish cards |
| 72 | touch-ripple | D | I | ripples from where you tap |
| 73 | interactive-liquid-distortion | G | I | the pointer leaves a liquid ripple on a picture |
| 74 | interactive-card-flip | D | I | a card flips to show ingredients and price |
| 75 | interactive-product-customization | D | I | size and milk change the drink and its price |
| 76 | animated-gradient | D | T | a slow moving gradient |
| 77 | mesh-gradient | G | T | four colour points drifting into each other |
| 78 | fluid-background | G | T | domain-warped flowing colour |
| 79 | liquid-background | C | T | glossy liquid layers rolling |
| 80 | abstract-particle-background | C | T | a drifting constellation of points |
| 81 | floating-geometric-shapes | D | T | outlined shapes floating and turning |
| 82 | ambient-light | D | T | soft pools of coloured light drifting |
| 83 | animated-noise | C | T | moving film grain |
| 84 | aurora-background | G | T | aurora curtains |
| 85 | slow-smoke | C | T | slow drifting smoke |
| 86 | animated-bokeh | C | T | out-of-focus lights floating |
| 87 | procedural-waves | C | T | contour lines of moving waves |
| 88 | organic-blob | D | T | a blob that never holds one shape |
| 89 | glass-refraction | G | T | colour seen through fluted glass |
| 90 | interactive-shader | G | I | a shader field that bends around the pointer |
| 91 | button-press | D | I | a button that presses in and springs back |
| 92 | add-to-cart | D | T | Add → working → added, with a count bump |
| 93 | cart-item-fly-in | D | T | a dish flies along an arc into the cart |
| 94 | quantity-selector | D | I | − and + with rolling digits |
| 95 | price-change | D | T | a price rolling to its new value |
| 96 | product-card-expansion | D | I | a card opens into a sheet |
| 97 | category-tab-transition | D | I | tabs with a sliding pill and direction-aware content |
| 98 | favorite-heart | D | I | a heart that bursts when liked |
| 99 | order-confirmation | D | T | a tick drawn in a circle, a burst |
| 100 | loading-skeleton | D | T | skeleton cards with a shimmer |
| 101 | progress-indicator | D | T | a ring and bar filling in steps |
| 102 | notification-slide-in | D | T | notices slide in and stack |
| 103 | menu-accordion | D | I | menu sections opening and closing |
| 104 | checkout-success | D | T | the card turns to success and a receipt slides out |
| 105 | order-status-progress | D | T | received → preparing → ready → served |
| 106 | kinetic-typography | D | T | words punched in rhythm |
| 107 | text-reveal | D | T | lines rise out of a mask |
| 108 | split-text | D | T | words fly in from different sides |
| 109 | letter-by-letter | D | T | letters (joined runs in Arabic) appear in turn |
| 110 | word-morphing | D | T | one word melts into the next |
| 111 | text-mask-reveal | D | T | moving colour seen through the letters |
| 112 | text-tracking | D | T | tracking closes from wide to tight (word spacing in Arabic) |
| 113 | text-blur-reveal | D | T | words come into focus |
| 114 | text-fade-up | D | T | lines fade up in turn |
| 115 | typography-3d | D | T | extruded letters turning in 3D |
| 116 | liquid-text | D | T | letters rippling like liquid |
| 117 | metallic-text-reveal | D | T | gold letters with a passing shine |
| 118 | gradient-text | D | T | a gradient flowing through the letters |
| 119 | character-stagger | D | T | letters riding a wave |
| 120 | text-path | D | T | text travelling around a cup's rim |
| 121 | cinematic-fade-transition | D | P | fade through black with a slight scale |
| 122 | liquid-wipe-transition | D | P | a wavy liquid edge wipes the page |
| 123 | morphing-page-transition | D | P | a card morphs into the next page |
| 124 | cube-3d-transition | D | P | the pages are faces of a cube |
| 125 | depth-zoom-transition | D | P | the page zooms past, the next comes from depth |
| 126 | mask-reveal-transition | D | P | a diagonal mask opens the next page |
| 127 | circular-reveal-transition | D | P | a circle grows from a point |
| 128 | card-stack-transition | D | P | the top card slides off the stack |
| 129 | horizontal-slide-transition | D | P | pages slide sideways (mirrored in RTL) |
| 130 | vertical-slide-transition | D | P | pages slide up |
| 131 | blur-dissolve-transition | D | P | a blurred cross-dissolve |
| 132 | camera-push-transition | D | P | the page rushes at the camera |
| 133 | perspective-flip-transition | D | P | a page turns over in perspective |
| 134 | seamless-scene-transition | D | P | the dish glides into its place in the next scene |
| 135 | shared-element-transition | D | P | a list picture grows into the detail hero |
| 136 | particle-dissolve | C | T | a word dissolves into particles and reforms |
| 137 | fluid-simulation | C | I | a stable-fluids dye simulation |
| 138 | smoke-simulation | C | T | buoyant smoke from the same solver |
| 139 | fire-simulation | C | T | grill flames from a cellular fire |
| 140 | water-ripple-simulation | C | I | a wave equation rippling a picture |
| 141 | cloth-simulation | C | I | a pinned napkin in the wind |
| 142 | soft-body-simulation | C | T | a jelly that wobbles as it lands |
| 143 | rigid-body-simulation | C | T | macarons tumbling and rolling to rest |
| 144 | procedural-noise-distortion | G | T | a picture warped by moving noise |
| 145 | motion-blur-trails | C | T | orbiting dishes with blur trails |
| 146 | chromatic-aberration | D | T | colour fringes split and rejoin |
| 147 | refraction-distortion | G | I | a droplet lens bending what is behind it |
| 148 | caustic-light | G | T | water caustics playing on a surface |
| 149 | glass-shatter | C | T | a pane shatters into shards and reforms |
| 150 | physics-particle-interaction | C | I | particles pushed by the pointer spring home |

---

### Task 1: Catalog, parameters, progress

**Files:** Create `src/motion/types.ts`, `params.ts`, `progress.ts`, `catalog/*.ts`, `loaders.ts` (stubs allowed
until Tasks 5–9 add the files), `index.ts`. Test: `tests/motion/catalog.test.ts`, `params.test.ts`, `progress.test.ts`.

- [ ] Tests: `MOTIONS` has 150 entries numbered 1–150 in order; ids unique and kebab-case; each category holds exactly
  the numbers of its group (three-d 1–15 … effects 136–150); every id has a loader and no loader lacks a motion; every
  `range` default lies in `[min, max]` on its step, every `choice` default is an option, every `color` is `#rrggbb`.
- [ ] Tests: `resolveParams` fills defaults, clamps ranges (`size: 999` → max), drops unknown keys, replaces a wrong
  type with the default, trims text to `maxLength`.
- [ ] Tests: `pingPong(0, 2, 1) === 0`, `pingPong(2, 2, 1) === 1`, `pingPong(2.5, 2, 1) === 1` (hold), `pingPong(4, 2, 1)`
  is 0.5, `pingPong(6, 2, 1) === 0`, periodic with period `2 * (travel + hold)`.
- [ ] Implement; run `npx vitest run tests/motion`; commit.

### Task 2: Engines

**Files:** `src/motion/engine/*`, `src/motion/Motion.tsx`.

- [ ] Ticker: one rAF loop; subscribers get `(dt seconds, now)`; the loop stops when nobody listens.
- [ ] `CanvasMotion`: DPR capped at 2, `ResizeObserver`, pointer in CSS pixels, still frame at `t = 1.5` when not
  playing, redraw on params change while still, ghost pointer when the real one is outside.
- [ ] Shared GL: one `WebGLRenderer` (alpha, antialias, ACES tone mapping, sRGB), its canvas grown to the largest view
  (cap 2048), each view rendered at the canvas's bottom-left with scissor and copied with `drawImage`. Creation failure
  marks GL unavailable; `GLMotion` then shows the still fallback.
- [ ] `Motion`: resolves params, picks the loader, `React.lazy` per id (cached), Suspense fallback, error boundary
  with the same fallback, auto progress (`pingPong`) when the motion is progress-driven and no `progress` is given,
  pauses when off screen, still when reduced motion (unless `playing` is forced).
- [ ] Typecheck; commit.

### Task 3: Studio Motion area

**Files:** nav, Sidebar icon, pages, `src/studio/motion/*`, messages, `tests/studio/motion.test.ts`, nav test.

- [ ] Tests: every motion has `motion.<id>.name` and `.desc` in English; every param key, option, category, engine,
  drive and sample has its message; `filterMotions` by category, by name, by number (`31`, `#31`); `usageSnippet`
  lists only changed params, quotes text with `JSON.stringify`, and is `<Motion id="…" />` with none changed.
- [ ] Nav: `motion` after `media`, `/studio/motion`, icon `Sparkles`; designers and Super Admins see it, owners do not.
- [ ] Gallery: header, search, category chips with counts, "Play previews" switch (off by default under reduced
  motion), sections per category, 4:3 dark preview per card mounted only within 200 px of the viewport, `inert`.
- [ ] Detail: stage (16:10), play/pause, replay, speed (0.25–2), progress mode for progress motions (auto, scrub, scroll),
  controls per param, reset, usage snippet with copy, previous and next.
- [ ] Run the Studio tests; commit.

### Tasks 4–8: The motions, two groups per task

Each motion file default-exports a `ComponentType<MotionProps>`; the table above is its brief. Each task: write the
files, typecheck, open every motion of the task on its detail page and see it run with no console errors, commit.

- Task 4: three-d (1–15), scroll (16–30)
- Task 5: luxury (31–45), food (46–60)
- Task 6: interactive (61–75), background (76–90)
- Task 7: micro (91–105), type (106–120)
- Task 8: transition (121–135), effects (136–150)

### Task 9: End-to-end and verification

**Files:** `tests/e2e/studio-motions.spec.ts`.

- [ ] @desktop: a designer opens Motion from the sidebar, sees 150 cards, Food shows 15, searching "latte" finds #51,
  opening #34 and changing its colour changes the snippet; walking all 150 detail pages with "Next" raises no page error.
- [ ] `npm run typecheck`, `npm run lint`, `npm test`, the new e2e suite; screenshots of the gallery and a detail page.
