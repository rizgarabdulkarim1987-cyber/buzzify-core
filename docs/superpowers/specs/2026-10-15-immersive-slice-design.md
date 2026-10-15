# Immersive slice: new look, 3D burger stage, motion

Status: approved by the user in chat ("Slice first: write a short spec, then build ...").
Builds on: `2026-10-15-foundation-menu-revenue-engine-design.md` (engine, data and tenant layers stay as they are).
Part of: Luxury 3D Smart Restaurant Menu and Revenue Platform, brief sections 3A (visual identity) and 3B (interactive 3D menu).

## 1. Why this exists

The user reviewed the sub-project 1 menu and rejected it: "didn't like the appearance, no 3D
motion, no creativity at all". The cause was scope. Sub-project 1 deferred 3D and Explore mode
to sub-project 3 and limited motion to "only in response to taps". The result was correct and
plain. This slice puts the part of the brief the user actually wants to see in front of them,
on two screens, so they can judge it live before it is rolled out.

Success means: the user opens the menu, sees a lit, three-dimensional burger they can turn with
a finger, toggles "Premium cheese" or "Double patty" and watches the model change, and the menu
around it feels designed rather than listed. The user says whether this direction is right.

## 2. Scope

In (the slice):

- A new visual language applied to: header, signature hero, category rail, product rows, product sheet.
- A real-time 3D stage (three.js through React Three Fiber) used by the signature hero and the
  product sheet for products whose media is `art: 'burger'`.
- Option-driven model changes: Premium cheese adds a draped cheese slice, Double patty adds a
  second patty and lifts the stack.
- A motion language (section 5) and its reduced-motion behaviour.
- One schema addition so options can declare what they do to the model (section 6).

Out (rolled out only after the user reviews the slice):

- 3D for cups, plates, pastry, bowls and glasses; real `.glb` loading; Explore mode; light theme switch.
- The cart, search and category data flow, pricing, revenue engine, i18n and tenant isolation are untouched.

## 3. Visual direction

Concept: a dark room with one pool of warm light. The product stands on a polished champagne
disc; everything else is quiet type on basalt. The brief pins black, champagne gold, editorial
typography, cinematic light, glass and metal, so those are followed exactly. Where the brief is
silent the defaults are avoided: no tracked all-caps eyebrows, no numbering, no arrows on
links, no identical rounded-card grid, no decorative glow without a light source.

| Element | Treatment |
|---|---|
| Colour | Existing brand tokens (basalt, charcoal, champagne, bone). New derived values by `color-mix` only: `--pool` (champagne at 22% for the light pool), `--vignette`. Tenant colours still come from `BrandConfig`. |
| Type | Bodoni Moda display at a larger scale (hero name `clamp(2.75rem, 11vw, 4.75rem)`, tight leading, slightly negative tracking); Hanken Grotesk text. Prices tabular. Arabic and Sorani keep Noto Naskh. |
| Header | Wordmark as the display face, table label as plain text, language switch as three quiet text options. Search becomes an underline field, not a pill. |
| Hero | Full-bleed stage of about 70dvh. Radial light pool from above, soft vignette, the 3D object on a champagne disc, name overlapping the stage's lower edge, start-aligned. The whole hero opens the product. |
| Rows | Circular "plate" thumbnails with a champagne hairline ring, name in display face, tabular price at the end, description clamped to two lines. No boxed cards. |
| Category rail | A single champagne underline that slides between categories. |
| Sheet | The stage replaces the top image; the same pool of light; the add button shows a price that rolls. |

## 4. The 3D stage

- Libraries: `three` and `@react-three/fiber` only (no drei). Lighting uses three's
  `RoomEnvironment` through `PMREMGenerator`, so there are no network fetches and no HDR files.
- The burger is built from code: lathe-turned bun halves with sesame instances, a lathe patty
  with a noise bump texture, a draped cheese plane, a ruffled lettuce ring, tomato and pickle
  discs. Stylized product render, not a photograph. Real photography or `.glb` files replace it
  later through the existing `media` list with no code change to the menu.
- `burgerLayers(selection)` is a pure function from "which options are selected" to an ordered
  list of layers with heights. The renderer only draws that list, and tests exercise the list.
- Interaction: drag or swipe turns the object with inertia; vertical swipes still scroll the
  page (`touch-action: pan-y`); arrow keys turn it when the stage is focused; double tap resets.
- Contact shadow is a baked radial texture on a plane under the disc, not a shadow map.

## 5. Motion

The memorable moment is the stack assembling. Everything else stays quiet.

| Moment | Behaviour |
|---|---|
| First reveal | Layers drop onto the disc one after another, bottom bun first, with a settle; the light pool fades up. Once per page load. |
| Option on | The new layer falls in from above with a small squash; layers above it rise to make room. |
| Option off | The layer lifts and fades; layers above settle. |
| Idle | Slow turn of about 8 degrees per second, paused while the user touches it or the tab or hero is hidden. |
| Scroll | The hero stage drifts and fades with scroll (transform and opacity only). |
| Sheet | Springs open as before; the stage settles in. Price changes roll digit by digit. |
| Press | Pressable controls scale to 0.97 on press. |

Rules: transform and opacity only for DOM motion; springs interruptible; nothing animates from
`scale(0)`; no animation on keyboard actions; UI durations under 300 ms except the one reveal.
`prefers-reduced-motion`: layers appear in place, no idle turn, no scroll drift; dragging still
works because the user starts it.

## 6. Data change

`ModifierOption` gains a nullable `visualKey` (`'cheese' | 'patty' | 'bacon'`), validated in the
seed, carried through the catalog loader and menu view as `MenuOptionView.visualKey`. The seed
sets it on Premium cheese, Double patty and Bacon. Options without a key do nothing visually.
Migration is additive and nullable, so existing data stays valid.

## 7. Fallback, performance, accessibility

- The page renders server-side with the existing SVG art as the poster. The 3D chunk is loaded
  only after the page is idle and only when the device qualifies: WebGL available, not
  `saveData`, `deviceMemory` not under 4 GB and at least 4 logical cores when those values are
  exposed. The poster crossfades to the canvas on the first rendered frame. Anywhere the stage
  cannot run, the SVG art stays and everything else works.
- The 3D chunk is not part of the menu route's initial JavaScript. The hero poster stays the
  LCP element. The Lighthouse run is repeated and reported as met or not met, as before.
- The render loop stops when the stage is offscreen or the tab is hidden. Pixel ratio is capped at 2.
- The stage is `role="img"` with a label naming the product and the selected extras, updated as
  options change. The change is announced through the existing live region. Contrast and focus
  rules from sub-project 1 hold; axe must stay clean.

## 8. Tests

- Vitest: `burgerLayers` (order, count, heights, stable keys, bacon), device qualification rule,
  `visualKey` validation in the seed, `visualKey` reaching `MenuOptionView`, number rolling steps.
- Playwright: hero poster then canvas (`data-stage-state` reaches `ready`), option toggle changes
  `data-stage-layers`, fallback keeps the poster when 3D is disabled, reduced motion renders
  without idle turn, axe clean on menu and open sheet, all 62 existing tests still pass.
- Manual: the user reviews the live slice on a phone-sized viewport. Low-end device behaviour
  cannot be proven in this environment and will be reported as unverified.

## 9. Risks

| Risk | Handling |
|---|---|
| 3D library weight | Lazy chunk after idle; measured and reported; poster is LCP. |
| Software WebGL in CI is slow | Tests wait on state attributes, not on timing; DPR capped. |
| Procedural food looks toy-like | Honest in the spec; lighting, materials and motion carry the quality; real assets plug in later. |
| Taste mismatch again | The slice is small on purpose; the user reviews it before any roll-out. |
