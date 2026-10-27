# Menu Styles in Templates Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a browse-shape setting (`body`) to templates. Ship three shape templates on it: The Book, The Magazine and Taste Airport. Show all 35 picked styles in a menu's Design → Templates gallery, and remove the separate Menu Styles area.

**Architecture:** `DesignLayout.body` (`scroll | book | magazine | board`) flows through the existing preset → overrides → `resolveDesign` → snapshot → `TemplateMenu` pipeline. `TemplateMenu` keeps its shared frame and swaps only the body. New bodies read `TemplateContext` and reuse `SectionHeading`, `ProductList` and `Nav` where the shape allows. The gallery gets a Styles filter backed by the menu-styles catalog.

**Tech Stack:** Next.js 16, React 19, TypeScript, Tailwind and plain CSS (`src/ui/template/skins.css` pattern), zod, vitest, Playwright.

**Spec:** `docs/superpowers/specs/2026-10-26-menu-styles-in-templates-design.md` (and `docs/superpowers/specs/2026-10-18-template-studio-design.md` for the shared template rules)

## Global Constraints

- `BODY_KINDS = ['scroll', 'book', 'magazine', 'board'] as const`, with default `scroll`. Old snapshots without `body` must parse as `scroll`, with no `SNAPSHOT_SCHEMA_VERSION` bump.
- New presets:

  | Number | Id | Name | Body |
  |---|---|---|---|
  | 31 | `the-book` | The Book | `book` |
  | 32 | `the-magazine` | The Magazine | `magazine` |
  | 33 | `taste-airport` | Taste Airport | `board` |

  All three are business `restaurant`, so there are 13 restaurant presets and the list runs 1–33.
- Catalog → template mapping: `themed-book → the-book`, `layout-mag → the-magazine`, `layout-2-dep → taste-airport`. The other 32 catalog styles are "coming soon".
- First screen of every body: categories, products with photos, and prices. Every section is one tap away. No intro or cover.
- Everything in Customize stays editable on the new templates. Only the knobs a shape sets are hidden, with the line "Set by the <shape> shape" in en, ar and ckb:
  - book sets `hero` and `nav`
  - magazine sets `hero`
  - board sets `hero`, `nav`, `card` and `heading`
- RTL with logical CSS, and page turns mirrored in RTL. Numerals come from `useApp().price`. Reduced motion means no turns or flaps.
- Contrast is 4.5:1 for text and 3:1 for buttons. No new runtime dependency, and no GSAP.
- `/studio/styles` and `/studio/styles/[id]` redirect to `/studio/menus`. The `styles` nav item is removed. `src/studio/styles/catalog.ts`, the posters, `/studio/style-files/*` and the `styles.*` messages stay.
- **Do not break the current menu or its motion (the user).** For `body: 'scroll'`, `TemplateMenu` renders exactly what it renders today. Wrap the existing hero/nav/sections block in the branch without editing it. Shared motion is unchanged: scene layer, hero, nav indicator, card entrances, detail sheet and cart bar. Do not edit an existing CSS file, skin, token or shared component's behaviour. New CSS is scoped under `[data-body="<kind>"]`. Existing tests stay as they are, except for the counts Task 5 names.
- Skills: TDD on every task. `impeccable` then `21st-ui-build` on Tasks 2–4 and 6. `superpowers:verification-before-completion` and `code-review` at the end.

## Review Focus

1. **A menu with one category, or a category with one dish:** the book's index and spread, the magazine's lead dish and the board still render without empty gaps or crashes. Pinned in Tasks 2–4.
2. **Search or filters that empty a category:** that chapter, section or gate disappears from the index, strip or tabs, as on the scroll body. Pinned in Tasks 2–4.
3. **A deep link `/p/<slug>` on a shape template:** it opens the product sheet over the body. Pinned in Task 5 (e2e).
4. **Switching body in Customize on an existing template:** the preview swaps live, hidden knobs come back on `scroll`, and publish stores the body. Pinned in Task 6.
5. **Arabic and Sorani:** the book turns mirrored, and the gate codes and prices use the tenant's numerals. Pinned in Tasks 2–4 (RTL render) and Task 8.

---

### Task 1: The `body` setting through the pipeline

**Files:**
- Modify:
  - `src/lib/templates/types.ts`: `BODY_KINDS`, `BodyKind`, `DesignLayout.body`
  - `src/lib/templates/resolve.ts`: `LAYOUT_RULES.body`
  - `src/server/domain/design-schema.ts`: `body: z.enum(BODY_KINDS).default('scroll')`
  - all four `presets/*.ts`: `body: 'scroll'` on the 30
  - `src/studio/workspace/design/Customizer.tsx`: a body select in `LAYOUT_CHOICES`, and hiding per the shape table with the "Set by…" line
  - `src/studio/messages/{en,ar,ckb}.ts`: `design.layout.body`, `design.body.<kind>`, `design.setByShape`
- Test: `tests/lib/templates.test.ts` and the existing design-schema / resolve tests (find with `graphify query "menuDesignSchema test"`)

**Interfaces:**
- Produces:
  - `BODY_KINDS`, `BodyKind`, and `DesignLayout.body: BodyKind`
  - `SHAPE_SETS: Record<BodyKind, ReadonlyArray<keyof DesignLayout>>`, exported from `src/lib/templates/types.ts` with values `{ scroll: [], book: ['hero','nav'], magazine: ['hero'], board: ['hero','nav','card','heading'] }`

- [ ] **Step 1: Failing tests.**
  - Every preset has a `body`.
  - `menuDesignSchema.parse(designWithoutBody).layout.body === 'scroll'`.
  - `parseOverrides({ layout: { body: 'nope' } })` drops it.
  - `menuDesignSchema` rejects `body: 'nope'`.
  - `SHAPE_SETS.board` equals `['hero','nav','card','heading']`.
  - The messages exist in all three languages.
- [ ] **Step 2:** Run them and see them fail.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** Run `npx vitest run tests/lib tests/studio/messages.test.ts` plus the schema test. They should pass. Also run `npx eslint src tests` and `npm run typecheck`.
- [ ] **Step 5:** Commit `feat(templates): a browse shape (body) on every template, scroll by default`.

### Task 2: `TemplateMenu` branch and the Book body

**Files:**
- Modify: `src/ui/template/TemplateMenu.tsx` (branch on `design.layout.body` around the hero/nav/sections block; keep everything else)
- Create: `src/ui/template/bodies/BookBody.tsx`, `src/ui/template/bodies/book.css`
- Test: `tests/e2e/template-bodies.spec.ts` (new, on the studio preview with a temporary template-menu, following `tests/e2e/template-menus.spec.ts`)

**Interfaces:**
- Consumes: `TemplateContext` (`categories`, `byCategory`, `openProduct`, `quickAdd`, `canOrder`, `activeId`, `jumpTo`, `reduced`, `design`), `SectionHeading kind={layout.heading}`, `ProductList kind={layout.card}`, and `useApp().price`.
- Produces: `BookBody(): JSX.Element`.
- Behaviour:
  - The index page is the first screen. It lists every non-empty category with its name, its dish count, and up to three dish photos with prices.
  - Tapping a chapter turns to its spread (CSS transform ≤ 300 ms, mirrored in RTL, instant with reduced motion) and sets the active category.
  - A ribbon tab returns to the index.
  - Spreads keep the `cat-<slug>` ids so `jumpTo` and deep links work.
- Visual reference: the `book` style in `src/studio/styles/pages/themed.html`.

- [ ] **Step 1:** Invoke `impeccable`, then `21st-ui-build` (if 21st is not signed in, build from project components and say so).
- [ ] **Step 2: Failing e2e** (book template on a menu with ≥ 3 categories):
  - The index shows every category name and at least one price.
  - Clicking chapter 2 shows its products.
  - Clicking a product opens the detail sheet.
  - Quick add raises the cart count (ordering `list`).
  - The ribbon returns to the index.
  - In `ar`, `dir=rtl` and the index renders.
  - A one-dish category renders.
- [ ] **Step 3:** Run and see it fail. **Step 4:** Implement. **Step 5:** Run and see it pass. Also run lint and typecheck.
- [ ] **Step 6:** Commit `feat(templates): the Book body: an index page that turns to each chapter`.

### Task 3: The Magazine body

**Files:** Create `src/ui/template/bodies/MagazineBody.tsx` and `magazine.css`; modify the `TemplateMenu` branch; extend `tests/e2e/template-bodies.spec.ts`.

**Interfaces:**
- Consumes: the same as Task 2, plus `Nav kind={layout.nav}` for the section strip.
- Produces: `MagazineBody()`.
- Behaviour:
  - A masthead with the restaurant name and the issue line.
  - A section strip (the `Nav` kind).
  - Each section is a spread with its first product as a large lead photo, and the rest in a `ProductList kind={layout.card}`.
  - The `cat-<slug>` ids are kept.
- Visual reference: `mag` in `src/studio/styles/pages/layout.html`.

- [ ] Steps as in Task 2. The e2e checks:
  - The first screen shows the lead dish photo and a price.
  - The strip jumps.
  - Changing `nav` or `card` in overrides changes the strip or cards (assert the `data-nav` / `data-card` attribute).
  - The detail sheet opens.
  - RTL works.
  - A one-dish section works.
- Commit `feat(templates): the Magazine body`.

### Task 4: The Board body

**Files:** Create `src/ui/template/bodies/BoardBody.tsx` and `board.css`; modify the branch; extend the e2e spec.

**Interfaces:**
- Produces: `BoardBody()`.
- Behaviour:
  - Gate tabs with letters A, B, C… per non-empty category; they jump and stay sticky.
  - Each product is a row with its photo (image-ratio aware), name, a short description line, a gate code (`<letter><n>`, with digits in the tenant's numerals), the price, and an add button when `canOrder`.
  - Row height follows density.
  - With motion allowed, rows flap in on first view (a CSS animation, staggered ≤ 30 ms). Reduced motion means no flap.
  - The `cat-<slug>` ids are kept.
- Visual reference: `dep` in `src/studio/styles/pages/layout-2.html`.

- [ ] Steps as in Task 2. The e2e checks:
  - The first screen shows ≥ 5 rows with prices.
  - Gate C jumps to the third category.
  - Add updates the cart.
  - Arabic numerals show in gate codes when the tenant uses them.
  - The detail sheet opens.
- Commit `feat(templates): the departures Board body`.

### Task 5: The three presets

**Files:**
- Create: `src/lib/templates/presets/styles.ts`
- Modify: `src/lib/templates/index.ts` (include it), `types.ts` (`TEMPLATE_IDS` + 3), `tests/lib/templates.test.ts` (1–33, restaurant 13), and `tests/e2e/template-thumbnails.gen.ts` (if it needs a demo for them)
- Create: `public/templates/{the-book,the-magazine,taste-airport}.webp` via `npm run studio:thumbnails`
- Test: `tests/lib/templates.test.ts`; extend `tests/e2e/template-bodies.spec.ts` with the deep link `/p/<slug>` on `the-book`

**Interfaces:**
- Produces: the presets `the-book` (31, body `book`), `the-magazine` (32, body `magazine`) and `taste-airport` (33, body `board`).
- Each has at least three alternatives, palettes that pass the existing contrast tests, tags that include its theme, and fonts from `src/lib/font-pairs.ts`:
  - the book: paper and ink, light
  - the magazine: editorial, light
  - the airport: black and yellow, dark

- [ ] **Step 1: Failing tests.**
  - There are 33 presets, and the ids equal `TEMPLATE_IDS`.
  - Each new preset has the expected body.
  - There are 13 restaurant presets.
  - The existing contrast and distinctness tests still pass.
  - The deep link opens the sheet on the book.
- [ ] **Steps 2–5:** Implement, generate the thumbnails, and look at them by eye. Commit `feat(templates): The Book, The Magazine and Taste Airport`.

### Task 6: Styles filter in the Templates gallery

**Files:**
- Modify: `src/studio/workspace/design/Gallery.tsx` and `DesignStudio.tsx` (the preview pane shows the mockup for a coming-soon pick)
- Create: `src/studio/styles/template-map.ts`
- Modify: the messages (`design.filter.styles`, `design.comingSoon`, `design.comingSoonPreview`) in en, ar and ckb
- Test: a unit test for the map in `tests/studio/styles.test.ts`, and `tests/e2e/studio-design-styles.spec.ts` (new)

**Interfaces:**
- Produces:
  - `TEMPLATE_FOR_STYLE: Partial<Record<string, TemplateId>>`
  - `templateForStyle(styleId): TemplateId | null`
- Behaviour:
  - A "Styles" filter chip shows the 35 catalog styles in catalog order.
  - A mapped style renders as that template's normal card: select, preview with the menu's products, and Customize and apply as today.
  - An unmapped style renders its poster (`/studio/style-files/poster/<id>`) with a "Coming soon" badge. Selecting it shows `/studio/style-files/page/<page>?style=<key>` in the preview frame, labelled "Coming soon with your products", and disables Customize and apply.

- [ ] **Step 1:** Invoke `impeccable`, then `21st-ui-build`.
- [ ] **Step 2: Failing tests.**
  - Unit: every mapped id is in `TEMPLATE_IDS`, every catalog id is either mapped or coming soon, and exactly 3 are mapped.
  - E2e (Super Admin, a menu's Design tab):
    - Styles shows 35 cards.
    - The Book previews the menu's own product names and can be applied.
    - A coming-soon card shows its mockup and offers no apply.
    - Switching body in Customize swaps the preview, and the hidden knobs show the "Set by" line.
- [ ] **Steps 3–5:** Implement, then run and see it pass. Commit `feat(studio): all 35 menu styles in the Templates gallery`.

### Task 7: Remove the separate Menu Styles area

**Files:**
- Delete:
  - `src/app/studio/(studio)/(app)/styles/page.tsx` and `[id]/page.tsx` (replace both with redirects to `/studio/menus`)
  - `src/studio/styles/StyleLibrary.tsx`, `StyleCard.tsx` and `StyleDetail.tsx`
  - `tests/e2e/studio-styles.spec.ts` (replace it with a redirect test)
- Modify:
  - `src/studio/nav.ts` and `src/studio/shell/Sidebar.tsx`: drop `styles`
  - `tests/studio/nav.test.ts`
  - messages: drop the keys no longer used (`styles.library.*`, `styles.detail.*`, `nav.styles`), keep `styles.<id>.*` and `styles.group.*`

- [ ] **Step 1: Failing tests.**
  - The nav lists no `styles`.
  - `/studio/styles` and `/studio/styles/themed-book` redirect to `/studio/menus` (e2e).
  - No stale message keys remain (the existing stale-key test in `tests/studio/styles.test.ts`, adjusted).
- [ ] **Steps 2–5:** Implement, then run `npx vitest run` and the e2e. Commit `refactor(studio): menu styles live in the Templates gallery only`.

### Task 8: Verify and review

- [ ] Run `npm run lint`, `npm run typecheck` and `npm test`, then run the e2e specs `template-bodies`, `studio-design-styles`, `template-menus`, `template-stage` and `shell`.
- [ ] Regression check on the current menu:
  1. `git diff main -- src/ui/template` shows only the branch wrapper in `TemplateMenu.tsx` and new files under `bodies/`.
  2. Regenerate the 30 existing thumbnails and compare them pixel by pixel against `main` (a sharp diff script in the scratchpad). Any visible difference fails the task.
  3. In the browser, scroll a classic template and one cinematic template and confirm the scene, hero and card motion still run.
- [ ] Browser check (`superpowers:verification-before-completion`):
  1. On a real menu's Design tab, pick each of the three new templates in phone and desktop, in en and ar.
  2. Customize the palette, fonts, scene and density on each.
  3. Publish one to a temporary menu and open the public URL.
  4. Take screenshots.
- [ ] Run `graphify update .`, then the final `code-review`, then open the PR.
