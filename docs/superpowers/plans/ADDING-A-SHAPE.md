# Adding a shape (a browse body and its style preset)

One shape = one new `BodyKind`, its component, and the preset that starts on it. `<kind>` is the body (e.g. `elevator`),
`<id>` the preset id (e.g. `the-elevator`), `<style>` the catalog style id (e.g. `layout-elv`).

## Files a new shape must touch

| # | File | Change |
|---|---|---|
| 1 | `src/ui/template/bodies/<Kind>Body.tsx` + `<kind>.css` | New. Reads `useTemplate()`, renders `<div className="tpl-body" data-body="<kind>">` with `<main id="menu">` inside; all CSS under `[data-body='<kind>']`. |
| 2 | `src/ui/template/bodies/index.ts` | One line in `BODIES`: `<kind>: <Kind>Body`. `TemplateMenu.tsx` is not touched. |
| 3 | `src/lib/templates/types.ts` | Append `'<kind>'` to `BODY_KINDS`; add `<kind>: ['hero', ...]` to `SHAPE_SETS` (`hero` is required: shapes set the compact hero); append `'<id>'` to the end of `TEMPLATE_IDS`. |
| 4 | `src/lib/templates/presets/styles.ts` | New `definePreset({ id: '<id>', number: <next>, layout: { body: '<kind>', hero: 'compact', ... }, scene: { mode: 'static' } })`, appended to `STYLE_PRESETS`. Number = previous last + 1. |
| 5 | `src/studio/styles/template-map.ts` | One line in `TEMPLATE_FOR_STYLE`: `'<style>': '<id>'`. |
| 6 | `src/studio/messages/{en,ar,ckb}.ts` | `design.body.<kind>` in all three (the Customizer's shape name and the "Set by the … shape" line). |
| 7 | `src/lib/messages/{en,ar,ckb}.ts` | Any guest-facing strings the body uses (with `_one/_other`, and Arabic `_zero/_one/_two/_few/_many/_other`). |
| 8 | `public/templates/<id>.webp` | Run `npm run studio:thumbnails` (needs the dev server and seeded demos); commit only the new file. |
| 9 | `tests/e2e/<kind>-body.spec.ts` (or a describe in `template-bodies.spec.ts`) | Use `tests/e2e/helpers/body-menu.ts`: `bodyMenus().create(slug, label, { templateId: '<id>' })`, `openMenu`, `expectFirstScreen`, `expectEverySectionReachable`, `expectJumpsTo`, `expectOpensProduct`, `expectQuickAdd`, `expectArabicRtl`. |
| 10 | `tests/lib/templates.test.ts` | Optional: pin the new preset's number/body/theme next to the 31-33 block. Nothing else needs editing. |

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
