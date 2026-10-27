# Adding a shape (a browse body and its style preset)

One shape = one new `BodyKind`, its component, and the preset that starts on it. `<kind>` is the body (e.g. `elevator`),
`<id>` the preset id (e.g. `the-elevator`), `<style>` the catalog style id (e.g. `layout-elv`).

## Files a new shape must touch

| # | File | Change |
|---|---|---|
| 1 | `src/ui/template/bodies/<Kind>Body.tsx` + `<kind>.css` | New. Reads `useTemplate()`, renders `<div className="tpl-body" data-body="<kind>">` with `<main id="menu">` inside; all CSS under `[data-body='<kind>']`. |
| 2 | `src/ui/template/bodies/index.ts` | One line in `BODIES`: `<kind>: dynamic(() => import('./<Kind>Body').then((m) => m.<Kind>Body)),` (keep the `import()` literal inside `dynamic()`: Next preloads the chunk and its CSS only in that form). Each shape loads on its own, so the scroll menu ships no shape code or CSS. `TemplateMenu.tsx` is not touched. |
| 3 | `src/lib/templates/types.ts` | Append `'<kind>'` to `BODY_KINDS`; add `<kind>: ['hero', ...]` to `SHAPE_SETS` (`hero` is required: shapes set the compact hero); append `'<id>'` to the end of `TEMPLATE_IDS`. |
| 4 | `src/lib/templates/presets/styles.ts` | New `definePreset({ id: '<id>', number: <next>, layout: { body: '<kind>', hero: 'compact', ... }, scene: { mode: 'static' } })`, appended to `STYLE_PRESETS`. Number = previous last + 1. |
| 5 | `src/studio/styles/template-map.ts` | One line in `TEMPLATE_FOR_STYLE`: `'<style>': '<id>'`. |
| 6 | `src/studio/messages/{en,ar,ckb}.ts` | `design.body.<kind>` in all three (the Customizer's shape name and the "Set by the … shape" line). |
| 7 | `src/lib/messages/{en,ar,ckb}.ts` | Any guest-facing strings the body uses (with `_one/_other`, and Arabic `_zero/_one/_two/_few/_many/_other`). |
| 8 | `public/templates/<id>.webp` | Run `npm run studio:thumbnails` (needs the dev server and seeded demos); commit only the new file. |
| 9 | `tests/e2e/<kind>-body.spec.ts` (or a describe in `template-bodies.spec.ts`) | Use `tests/e2e/helpers/body-menu.ts`: `bodyMenus().create(slug, label, { templateId: '<id>' })`, `openMenu`, `expectFirstScreen`, `expectEverySectionReachable`, `expectJumpsTo`, `expectOpensProduct`, `expectQuickAdd`, `expectArabicRtl`. |
| 10 | `tests/lib/templates.test.ts` | Optional: pin the new preset's number/body/theme next to the 31-33 block. Nothing else needs editing. |

## Shared pieces to reuse (`src/ui/template/bodies/shared/`)

Do not copy these from an older body; import them. Each keeps a shape's look: the shape adds only its own decoration.

| Piece | What it does | Used by |
|---|---|---|
| `useKeepInView(ref, activeId, 'x' \| 'y', reduced, margin = 16)` (`useKeepInView.ts`) | Keeps the lit `[data-category]` entry of a section strip in view, scrolling only the strip, never the page. Keyed on `activeId`, so search/filter never move it. `keepInViewDelta` is the pure maths (unit-tested). | board (margin 24), elevator (`y`), metro, periodic (`y`, margin 4), shelves |
| `<RowDish prefix="xx" suffix sizes priority order? description? />` (`RowDish.tsx` + `rows.css`) | The row card: square photo, name button (`tpl-open`, whole-card tap area), price + badges, optional one-line description, quick add. Elements carry `rd-*` (shared layout, at `:where([data-body])` specificity) and `xx-*` (your CSS: gaps, padding, borders, fonts, wider-screen sizes). | elevator (`el`), metro (`mt`), cabinet (`cb`) |
| `hueAt(hues, index)` (`hue.ts`) | Picks a colour from a shape's hue list, wrapping both ways. | metro `stationHue`, periodic `groupHue` |
| `.tpl-strip-sticky` (`shapes.css`) | Pins a shape's own section strip (route, legend, signs) to the top of the viewport (`top: 0`, the header does not stick) with a 92% `--bg` backing. Also set `--nav-room` on your `[data-body]` to the strip's height so a jumped-to section lands below it; cap a wrapping strip at about two rows. | metro, periodic, shelves (board uses `.tpl-nav`, which is already sticky) |
| `.tpl-tall-last` (`shapes.css`) | On each section: the last one gets `min-block-size: var(--tall-last, 60dvh)`, so the lit-section tracking (a band 30-40% down the viewport) reaches it at the end of the page. Set `--tall-last` on your `[data-body]` to change it. | elevator (70dvh), metro, periodic |

Import `./shared/shapes.css` in the body that uses a class from it (the CSS is imported once per module; duplicates are fine).
A shape's CSS loads only with the shape (after skins.css), so import every shared sheet whose classes the body writes, in
the order photo-card, rows, shapes, arch-chip, name-chip, before the body's own sheet (`tests/ui/template-bodies.test.ts`
checks both). A rule of yours that ties a skins.css rule (same specificity) now wins it: skins.css used to come last.
A strip that claims to "stay at the top" must be sticky: add an `expectStripStays(page, strip, button, slug)` e2e
(`tests/e2e/helpers/body-menu.ts`). A body that hides sections (accordions, pages) must open the ones holding search
or filter results when the results change (see `withResults` in `CabinetBody.tsx`), without moving scroll or focus.

## Files a new shape does NOT need to touch (they follow the lists)

- `src/ui/template/TemplateMenu.tsx`: draws `BODIES[body]`; the `scroll` branch is unchanged.
- `src/ui/scenes/three/registry.ts`: a preset with no 3D scene of its own borrows one by background (`borrowedArt`: dark
  borrows Neon Noir, light borrows Gallery Blanc). Only add a line if the style gets a real scene.
- `src/ui/scenes/posters.tsx`: same fallback for the static poster. Add an entry only to draw a poster of its own.
- `src/ui/template/skins.css`: per-template skins (`.tpl-<id>`) are optional.
- `src/server/domain/design-schema.ts`, `src/studio/workspace/design/Customizer.tsx`, `scripts/set-template.ts`,
  `tests/e2e/template-thumbnails.gen.ts`, `src/lib/templates/index.ts`: all read `BODY_KINDS` / `TEMPLATE_IDS` /
  `templateList()`.
- Test pins derive from the lists: `tests/lib/templates.test.ts` (counts from `TEMPLATE_IDS`/`STYLE_PRESETS`, first 33
  pinned), `tests/studio/styles.test.ts` (`TEMPLATE_FOR_STYLE` targets = `STYLE_PRESETS`), `tests/studio/messages.test.ts`
  (`design.body.<kind>` for every `BODY_KINDS`), `tests/ui/template-bodies.test.ts` (`BODIES` = `BODY_KINDS` minus
  scroll, each with a preset), `tests/e2e/studio-design-styles.spec.ts` (coming-soon count).

## The tests that fail until the checklist is complete

- Missing `BODIES` entry: typecheck (`Record<Exclude<BodyKind,'scroll'>, …>`) and `tests/ui/template-bodies.test.ts`.
- Missing `SHAPE_SETS` entry: typecheck. Missing `hero` in it: `tests/lib/templates.test.ts`.
- Missing preset for a body: `tests/ui/template-bodies.test.ts`. Preset not in `TEMPLATE_IDS`: typecheck.
- Preset with no `TEMPLATE_FOR_STYLE` line: `tests/studio/styles.test.ts`.
- Missing `design.body.<kind>`: `tests/studio/messages.test.ts`.

Hard rules still apply (see `.superpowers/sdd/common.md`): never add `body` to presets 1-30, scroll output unchanged.
