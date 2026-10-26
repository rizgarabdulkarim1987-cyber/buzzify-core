# Menu styles, batches 2 to 9: plan

Spec: `docs/superpowers/specs/2026-10-26-menu-styles-in-templates-design.md` (batch table, rules, "current menu stays as is").
Pattern: batch 1 (`src/ui/template/bodies/{Book,Magazine,Board}Body.tsx` + css, `presets/styles.ts`, `template-map.ts`,
`tests/e2e/template-bodies.spec.ts`). One task per style (a body kind, or a preset on a shared kind), one commit per task.

## Task 0: foundation (registry)
Make "add a shape" a small, uniform change so 32 tasks do not fight over shared files: a body registry
(`BODIES: Record<BodyKind, ComponentType>` in one file consumed by `TemplateMenu`), `SHAPE_SETS` entry, `design.body.<kind>` and
"set by shape" messages x3 locales, unit-test pins derived from lists rather than literals where possible. No behaviour change
for scroll/book/magazine/board. Also a shared e2e helper for the "first screen at 390x844" body test.

## Per-style task contract (every task)
1. `impeccable` (shape the structure first), `21st-ui-build` (not signed in -> say so, build from project components).
2. TDD: failing unit/e2e first. Add `BodyKind`, `SHAPE_SETS`, body component + css scoped under `[data-body="<kind>"]`,
   preset (number 34+, appended to `TEMPLATE_IDS`, `STYLE_PRESETS`), `TEMPLATE_FOR_STYLE` line, i18n en/ar/ckb (+plurals),
   thumbnail (webp from `npm run studio:thumbnails`, only the new one committed), e2e for the body at 390x844 (first screen:
   categories + dishes with photos + prices; section jump; openProduct; quick add; Arabic RTL).
3. Rules (user's hard rules): scroll body byte-identical; presets 1-30 untouched; every section one tap away, many dishes on
   the first screen; tap target covers the card; effects must not refire on `categories` identity change; search/filter never
   steal focus or scroll; closed/hidden pages take no layout and load no photos; text over photos >= 4.5:1 and survives long
   names at 390px; `formatCount`/`localDigits`; locale plurals; reduced motion; RTL; hover only in `@media (hover:hover)`;
   keep `<main id="menu">`; compact hero via `SHAPE_SETS` `hero`.
4. Commit only own files (check `git diff --stat` for CRLF churn).

## Shapes (structural decision per style; the task may refine, and records any ruling in the ledger)
| # | Style | Kind | Structure |
|---|---|---|---|
| 2a | layout-elv | `elevator` | floor-button rail pinned at the inline edge (1..n, tenant numerals), sections stacked as floors, current floor lit |
| 2b | layout-per | `periodic` | whole menu as a tile grid: each dish a photo "element" with symbol, number, price; sections as coloured groups |
| 2c | layout-met | `metro` | a vertical line with a station per section (own colour), dishes hang off the line as stops |
| 2d | layout-cab | `cabinet` | each section a drawer front with handle; drawers are accordions (several can be open), first open |
| 3a | layout-shf | `shelves` | each section a shelf plank, dishes standing on it with hanging price tags, wraps to rows |
| 3b | layout-tkt | `tickets` | sections as ticket columns, horizontal snap with next column peeking, plus a ticket-number index |
| 3c | layout-top | `tabletop` | round plates grid on a wood-toned surface, price on a plate rim chip, cutlery as ornament |
| 3d | layout-2-cmc | `comics` | comic panel grid of varied spans, name in a speech bubble, price in a burst |
| 4a | layout-2-hom | `homescreen` | dishes as app icons in a grid, sections as folders/pages with a dock that jumps |
| 4b | layout-2-map | `treasure` | sections as islands on parchment, dishes as pins with photo flags |
| 4c | layout-2-lvl | `levels` | worlds and round level nodes along a winding path |
| 4d | layout-2-frg | `fridge` | glass shelves of tubs and jars per section, door-style section toggles |
| 5a | layout-2-bnt | `bento` | compartment grid per section with paper flag labels |
| 5b | layout-2-box | `mailboxes` | brass mailbox wall, dish behind a glass window |
| 5c | motion-dep | `depth` | big framed photos that parallax inside their frames while scrolling |
| 5d | motion-kin | `kinetic` | typographic list: huge words, price spin on enter |
| 6a | motion-thr | `theatre` | stage-framed sections, spotlight follows the section in view |
| 6b | motion-stk | `stacked` | sections as sticky sheets sliding over each other |
| 6c | motion-mor | `morph` | photo grid; tapped photo grows into the detail |
| 6d | motion-fly | `fly` | dense photo grid, add button flies a thumbnail to the cart bar |
| 7a | motion-ink | `ink` | each section a full-colour band flooding in |
| 7b | motion-stm | `steam` | dishes with temperature (hot steam / cold dew) as a list |
| 7c | kurd-arab-cit | `citadel` | citadel skyline index, sections as lit windows/terraces |
| 7d | kurd-arab-ram | `lanterns` | hanging lanterns as section nav, dishes under crescent arches |
| 8a | kurd-arab-lyl | `carpet` | night sky with carpet-borne dish rails per section |
| 8b | themed-kurd | `rugs` | woven rug bands as section frames, dish tiles as rug medallions |
| 8c | themed-shn | `lattice` | lattice-window grid, turquoise arches per dish |
| 8d | themed-bab | `gate` | glazed-brick gate per section that opens to its dishes |
| 9a | themed-spc | `station` | porthole grid, planet for the featured dish |
| 9b | themed-win | `frost` | frosted-glass panels you wipe, dishes on frost cards |
| 9c | themed-sum | `beach` | wave-banded sections, dishes as beach-towel tiles |
| 9d | themed-prn | `printer` | layer-by-layer print list (rows reveal with layers) |

Each batch ends with a batch review (code-review on the batch diff) and fix round. After batch 9: final review on the most
capable model, a fix wave, verification-before-completion (lint `npx eslint src`, typecheck, `npm test`, e2e, thumbnails
pixel-compare of the 30 originals, scroll-motion browser check), one PR.
