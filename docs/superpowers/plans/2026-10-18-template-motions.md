# Template Motions Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Template menus draw the Motion tab's motions, each preset places suggested motions when it is applied, and
the Template Studio shows them.

**Architecture:** A pure module (`src/lib/templates/motions.ts`) holds each preset's suggestions and the category
classifier and turns them into `SnapshotMotion`s. The design service's apply replaces template-placed `MenuMotion` rows
(new `fromTemplate` column) in the same draft transaction. `TemplateMenu` draws the hero motion as a veiled backdrop
and category bands through the existing `MotionSlot`; the Studio preview swaps suggestions for a template not yet applied.

**Tech Stack:** as the menu-motions plan. **Spec:** `docs/superpowers/specs/2026-10-18-template-motions-design.md`

## Global Constraints

- Hero backdrop veil: page colour at `max(scene.overlay, 0.4)`; no added height. Category band as the classic menu's.
- At most 3 suggested category motions, first matches in menu order; one hero suggestion per preset, all offered motions.
- Suggestions only with `design.menuMotions`; never over a designer's own motion; `fromTemplate` not in the snapshot.
- Messages in en, ar, ckb. Tests with `BUZZIFY_DB_PORT=54347`.

## Review Focus

1. A designer's own motion at the top when a template is applied: it stays, the suggestion is skipped (Task 2 test).
2. Switching template A → B → Classic: A's suggestions leave, B's arrive, Classic leaves none (Task 2 test).
3. A category named only in Arabic or Sorani ("قهوة", "قاوە"): still classified (Task 1 test).
4. A static-scene template with a placed motion: the pause button shows and pauses it (Task 3 check).
5. Previewing an unapplied template keeps the designer's motions and shows that preset's suggestions (Task 4 test).

---

### Task 1: Suggestions as data

**Files:** Create `src/lib/templates/motions.ts`; test `tests/lib/template-motions.test.ts`.

**Produces:**
```ts
export type CategoryKind = 'coffee' | 'dessert' | 'icecream' | 'drinks' | 'grill';
export function categoryKind(category: { slug: string; names: readonly string[] }): CategoryKind | null;
export const PRESET_HERO_MOTIONS: Record<TemplateId, { motionId: string; tint?: boolean }>;
export function suggestedMotions(templateId: TemplateId, input: {
  categories: ReadonlyArray<{ id: string; slug: string; names: readonly string[] }>;
  palette: { bg: string; accent: string }; locales: readonly Locale[]; logoText: string;
}): SnapshotMotion[]; // hero first, then up to 3 categories
```
- [ ] Tests: every preset's hero motion `isOffered`; `categoryKind` for `espresso-bar`, `{ names: ['قهوة'] }`,
  `{ names: ['قاوە'] }` → coffee, `gelato` → icecream, `iced-coffee` → coffee (coffee before drinks), `starters` → null;
  `suggestedMotions('obsidian-gold', …)` → hero golden-particles with `background` = palette.bg and `color` = accent,
  categories capped at 3 in order. Run, see FAIL; implement; PASS; commit.

### Task 2: Applying a template places its suggestions

**Files:** `prisma/schema.prisma` (+`fromTemplate String?`, migration), `src/server/studio/services/design.ts`
(`applyDesign`), `src/server/studio/services/menu-motions.ts` (save clears `fromTemplate`; view gains `templateId`,
place `suggestedBy`); test `tests/studio/template-motions.test.ts`.
- [ ] Tests (DB): apply obsidian-gold → hero row `fromTemplate: 'obsidian-gold'`; a coffee category gets coffee-steam;
  a designer's hero motion stays and no suggestion is added there; apply copper-roast after → obsidian's rows gone,
  copper's placed; apply classic → template rows gone, designer's kept; BASIC plan → none placed; saving a suggested
  motion in `motions.save` sets `fromTemplate` null; the draft snapshot has no `fromTemplate`. FAIL → implement → PASS.

### Task 3: Template menus draw the motions

**Files:** `src/ui/menu/MotionSlot.tsx` (+`backdrop` place, `paused` prop), `MotionSlotBody.tsx`,
`src/ui/template/TemplateMenu.tsx`.
- [ ] Hero backdrop wraps `TemplateHeader` and `Hero` (relative; slot absolute behind; veil div; content `z-[1]`);
  category bands before each heading; footer toggle shows when the scene animates or a motion is placed; pausing
  pauses both. Typecheck, lint, browser check on `maison-demo` with a motion placed by script; commit.

### Task 4: The Template Studio shows them

**Files:** `src/ui/template/PreviewDesign.tsx`, the preview page (`src/app/studio/(preview)/preview/[menuId]/[locale]/page.tsx`),
`src/studio/workspace/design/Gallery.tsx`, `src/studio/workspace/motion/MotionPlaces.tsx`, messages; test
`tests/lib/template-motions.test.ts` (swap).
- [ ] `previewMotions(kept, suggestions, locale, …)`: for a template other than the draft's, the preview's
  `view.motions` = designer's own + that preset's suggestions in empty places; Classic = designer's own. Gallery card:
  "Motion: {name}". Motion tab: "Suggested by {template}", template notes. FAIL → implement → PASS; messages parity.

### Task 5: End to end and checks

- [ ] e2e `tests/e2e/studio-template-motions.spec.ts` (@desktop): on a temporary menu with a coffee category, apply a
  preset in the Design tab, see "Suggested by" in the Motion tab, publish, the guest's template menu has
  `[data-motion-slot="backdrop"] [data-motion="…"]` playing. Full unit suite, typecheck, lint; related e2e; commit; PR.
