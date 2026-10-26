# Menu Styles Library Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A signed-in Studio area, `/studio/styles`, showing the 35 menu styles the user picked. Each style opens full height in a phone frame and can be tried.

**Architecture:** The five brainstorm mockup pages are copied into `src/studio/styles/pages/`, with the brainstorm parts and the unpicked styles taken out and a solo mode added (`?style=<key>`). A Studio route handler serves those pages and the card posters to Super Admins and designers only. A typed catalog drives a gallery and a detail page built from the Motion library's parts.

**Tech Stack:** Next.js 16 App Router, React 19, TypeScript, Tailwind, vitest, Playwright, sharp.

**Spec:** `docs/superpowers/specs/2026-10-26-menu-styles-library-design.md`

## Global Constraints

- Only Super Admins and designers see the area. An owner is redirected to `/studio`, and a signed-out visitor goes to `SIGN_IN_PATH`, the same as `src/app/studio/(studio)/(app)/motion/page.tsx`.
- The page and poster files are never served from `public/`, and never to an owner or a signed-out visitor (404).
- Exactly 35 styles, in four groups: `themes` (8), `heritage` (3), `motion` (8), `shapes` (16).
- Ids are `<page>-<key>`, where page is one of `themed`, `kurd-arab`, `motion`, `layout`, `layout-2`.
- Every name and line is in `en`, `ar` and `ckb`.
- No schema change, no customer-menu change, no wheel of fortune.
- Arabic text is never split per letter. Reduced motion stays as the mockups have it.
- Skills used at each step: TDD for every task; `impeccable` then `21st-ui-build` for Tasks 5–6; `superpowers:verification-before-completion` and `code-review` at the end.

## Review Focus

1. **A style id that is not in the catalog** (`/studio/styles/nope`, or a removed style such as `themed-par`) → `notFound()`, never an empty frame. Pinned in Task 6.
2. **A file name that tries to leave the folder** (`..%2Fpackage.json`, `layout-2.html`, upper case) → 404. Pinned in Task 2.
3. **Search typed in Arabic or Sorani, or with Arabic-Indic digits** (`مطار`, `٣`) → finds the style by its name in the Studio language, or by its number. Pinned in Task 1.
4. **A short laptop screen (700px tall)** → the phone frame scales down, and the style still scrolls inside it with no page scroll trapped. Checked in Task 7.
5. **The iframe page in solo mode with no `?style=`, or with a removed key** → shows the copy's own gallery of picked styles only, not a blank page or a removed style. Pinned in Task 2.

---

### Task 1: Catalog, messages and search

**Files:**
- Create: `src/studio/styles/catalog.ts`, `src/studio/styles/search.ts`
- Create: `src/studio/messages/styles/en.ts`, `ar.ts`, `ckb.ts`
- Modify: `src/studio/messages/en.ts`, `ar.ts`, `ckb.ts` (spread the styles messages next to `...motion`)
- Test: `tests/studio/styles.test.ts`

**Interfaces:**
- Produces:
  - `type StylePage = 'themed' | 'kurd-arab' | 'motion' | 'layout' | 'layout-2'`
  - `const STYLE_GROUPS = ['themes', 'heritage', 'motion', 'shapes'] as const`, and `type StyleGroup`
  - `interface MenuStyle { id: string; number: number; group: StyleGroup; page: StylePage; key: string }`
  - `const MENU_STYLES: readonly MenuStyle[]`, numbered 1–35 in the spec table's order
  - `menuStyleById(id: string): MenuStyle | undefined`
  - `const STYLE_PAGES: readonly StylePage[]`
  - `filterStyles(styles, { q, group: StyleGroup | 'all' }, nameOf: (id) => string): MenuStyle[]`, which behaves like `filterMotions` in `src/studio/motion/search.ts` (reuse its `latinDigits` idea; number search on `number`)
  - Message keys:
    - per style: `styles.<id>.name` and `styles.<id>.line`
    - per group: `styles.group.<group>`
    - page copy: `styles.library.title`, `.intro`, `.search`, `.searchPlaceholder`, `.groups`, `.all`, `.showing`, `.empty`
    - detail: `styles.detail.back`, `.number`, `.frame`, `.open`
    - nav: `nav.styles`
  - The Arabic names and lines are taken verbatim from the mockups' `name` and `tag` fields.

- [ ] **Step 1: Write the failing tests** in `tests/studio/styles.test.ts`:
  - `MENU_STYLES` has length 35, its ids are unique, and its numbers are 1..35.
  - The group counts are `{ themes: 8, heritage: 3, motion: 8, shapes: 16 }`.
  - It contains `motion-dep` and `layout-2-dep`, and does not contain `themed-par`, `kurd-arab-and`, `kurd-arab-jli`, `kurd-arab-hwr`, `kurd-arab-chy` or `kurd-arab-sad`.
  - For each of `en`, `ar` and `ckb`, every `styles.<id>.name`, `styles.<id>.line`, `styles.group.<g>` and `nav.styles` is non-empty.
  - There are no stale `styles.<id>.(name|line)` keys.
  - `filterStyles(MENU_STYLES, { q: 'مطار', group: 'all' }, arName)` returns `['layout-2-dep']`.
  - `{ q: '٣' }` returns the style numbered 3, and so does `{ q: '#3' }`.
  - `{ q: '', group: 'heritage' }` returns three ids.
  - `{ q: 'zzz' }` returns `[]`.
- [ ] **Step 2: Run** `npx vitest run tests/studio/styles.test.ts`. It should FAIL because the module is not found.
- [ ] **Step 3: Implement** the catalog, the search and the three message files. Wire the message files into the main dictionaries.
- [ ] **Step 4: Run** `npx vitest run tests/studio/styles.test.ts tests/studio/messages.test.ts`. They should PASS.
- [ ] **Step 5: Commit** with `feat(studio): a catalog of the 35 menu styles, named in three languages`.

### Task 2: The style pages and the route that serves them

**Files:**
- Create: `src/studio/styles/pages/{themed,kurd-arab,motion,layout,layout-2}.html`, copied from `.superpowers/brainstorm/86318-1792958227/content/{themed-menus,kurd-arab-menus,motion-menus,layout-menus,layout-menus-2}.html`
- Create: `src/app/studio/style-files/page/[file]/route.ts`, `src/app/studio/style-files/poster/[id]/route.ts`, `src/server/studio/style-files.ts`
- Modify: `next.config.ts` (`outputFileTracingIncludes`: `'/studio/style-files/**': ['./src/studio/styles/pages/*.html', './src/studio/styles/posters/*.webp']`)
- Test: `tests/studio/style-files.test.ts`

**Interfaces:**
- Consumes: `STYLE_PAGES`, `MENU_STYLES`, `menuStyleById` (Task 1).
- Produces:
  - `GET /studio/style-files/page/<page>` returns `text/html`.
  - `GET /studio/style-files/poster/<id>` returns `image/webp`.
  - Both use `cache-control: private, max-age=3600` and `x-content-type-options: nosniff`.
  - `styleFileAccess(): Promise<boolean>` in `src/server/studio/style-files.ts` returns true when `getActor()` gives an actor who is not `isOwnerOnly`.
  - Solo mode in each copy: `?style=<key>` opens that style straight away, full size, with the gallery, the close button and the full-screen button hidden.

Edits to each copy (one-time, by hand or a throwaway script kept out of the repo):
1. Delete the like button, the `liked` set and its `localStorage` key, the `.liked` CSS, and both `brainstorm.send` lines.
2. Remove the unpicked entries from `STYLES`: `par` from themed, and `jli`, `hwr`, `chy`, `sad` and `and` from kurd-arab. Then update each page's gallery heading count.
3. Append the solo block before `</script>`. When `?style=` names a key in `STYLES`, it adds `solo` to `<html>`, calls `open(key)` and adds `full` to `#app`. A CSS rule `.solo body > :not(#app)` hides the rest, and `.solo` also hides the close and full-screen controls.

- [ ] **Step 1: Write the failing tests.** Mock `@/server/studio/auth/actor`'s `getActor`, following the `vi.mock` pattern in `tests/studio/actor.test.ts`.
  - A designer (not super admin, no memberships) gets 200 `text/html` for each of the five pages.
  - The `layout-2` body contains `STYLES` and does not contain `brainstorm.send`, `يعجبني` or `layout2-liked`.
  - The themed body has no `key: 'par'`.
  - The kurd-arab body has only `cit`, `ram` and `lyl` as `key:` entries.
  - Every copy contains `searchParams` / `get('style')` and the `solo` class.
  - An owner-only actor gets 404, and so does a `null` actor.
  - The page names `..%2Fpackage.json`, `layout-2.html`, `LAYOUT` and `nope` each get 404.
  - The poster route for a catalog id returns 200 `image/webp` (after Task 3, mark it `it.todo` until then). `nope` and `themed-par` get 404.
- [ ] **Step 2: Run** `npx vitest run tests/studio/style-files.test.ts`. It should FAIL.
- [ ] **Step 3: Implement** the copies, `styleFileAccess`, both routes (follow `src/app/api/assets/models/[file]/route.ts`: a strict allow-list rather than a regex, and `readFile` from `join(process.cwd(), 'src', 'studio', 'styles', …)`), and the tracing entry.
- [ ] **Step 4: Run** the test again. It should PASS.
- [ ] **Step 5: Add `impeccable` detector ignores** for the five copies, for rules whose effect is the style itself (marquee, pulsing-dot, dark-glow), with the reason "a menu style's own effect, shown as-is in the Studio showroom". Disclose them in the reply.
- [ ] **Step 6: Commit** with `feat(studio): the menu style pages, served only to Studio staff`.

### Task 3: Card posters

**Files:**
- Create: `scripts/menu-style-posters.ts` (npm script `styles:posters`), and `src/studio/styles/posters/<id>.webp` × 35
- Test: extend `tests/studio/styles.test.ts`

**Interfaces:**
- Consumes: `MENU_STYLES` (Task 1), and the solo mode (Task 2).
- Produces: 35 WebP files, 430×900 rendered at device scale 1 and saved at width 344 (quality 72).

- [ ] **Step 1: Write the failing test.** For every catalog id, `src/studio/styles/posters/<id>.webp` exists and is under 60 KB.
- [ ] **Step 2: Run** it. It should FAIL.
- [ ] **Step 3: Implement the script.**
  1. Launch Playwright chromium with a 430×900 viewport.
  2. For each style, open `file://…/src/studio/styles/pages/<page>.html?style=<key>`.
  3. Wait 1800 ms so entrances settle.
  4. Take a PNG screenshot.
  5. Convert it with `sharp(...).resize({ width: 344 }).webp({ quality: 72 })`.

  Run it with `npx tsx scripts/menu-style-posters.ts`.
- [ ] **Step 4: Run** the tests, including the poster route test from Task 2. They should PASS. Look at five posters by eye, one of each group plus the book.
- [ ] **Step 5: Commit** with `feat(studio): posters for the menu style cards`.

### Task 4: Navigation

**Files:**
- Modify: `src/studio/nav.ts` (`NavIcon` and `NavKey` gain `'styles'`, and the item `{ key: 'styles', href: '/studio/styles', labelKey: 'nav.styles', icon: 'styles' }` goes right after motion), and `src/studio/shell/Sidebar.tsx` (map `styles` to lucide `LayoutTemplate`)
- Test: `tests/studio/nav.test.ts`

- [ ] **Step 1: Update the expectations** in `tests/studio/nav.test.ts`. Every key list gains `'styles'` after `'motion'`, and the href list gains `'/studio/styles'`. The owner-only cases stay unchanged.
- [ ] **Step 2: Run** `npx vitest run tests/studio/nav.test.ts`. It should FAIL.
- [ ] **Step 3: Implement** the nav change.
- [ ] **Step 4: Run** the test. It should PASS. Also run `npm run typecheck`.
- [ ] **Step 5: Commit** with `feat(studio): Menu styles in the sidebar`.

### Task 5: Gallery page (impeccable, then 21st-ui-build)

**Files:**
- Create: `src/app/studio/(studio)/(app)/styles/page.tsx`, `src/studio/styles/StyleLibrary.tsx`, `src/studio/styles/StyleCard.tsx`
- Test: `tests/e2e/studio-styles.spec.ts`

**Interfaces:**
- Consumes: Task 1 (catalog, search, messages), and the Task 2 poster URL `/studio/style-files/poster/<id>`.
- The page mirrors `motion/page.tsx`: metadata from `styles.library.title`, `getActor`, the `isOwnerOnly` redirect, and `<Suspense><StyleLibrary/></Suspense>`.
- `StyleLibrary` mirrors `MotionLibrary`: a `PageHeader` with search and group chips (`group` param), a showing count, `EmptyState` with clear filters, and one section per group.
- `StyleCard` is a `Link` to `/studio/styles/<id>` holding:
  - the poster `<img loading="lazy" width=344 height=720>` in a 43:90 frame with the same ring and hover as `MotionCard`
  - the number, the name and the line (two-line clamp)

- [ ] **Step 1: Invoke `impeccable`** (shape and critique against the Studio tokens), then `21st-ui-build` for the card and grid. Record any direction note in the commit body.
- [ ] **Step 2: Write the failing e2e tests**, following `tests/e2e/studio-motions.spec.ts` for sign-in fixtures:
  - A Super Admin opens `/studio/styles` and sees `Showing 35 of 35`.
  - Typing `Airport` leaves one card, and clearing filters brings back 35.
  - The `Kurdish & Arab` chip shows 3 cards.
  - An owner who visits `/studio/styles` lands on `/studio`.
- [ ] **Step 3: Run** `npx playwright test tests/e2e/studio-styles.spec.ts`. It should FAIL.
- [ ] **Step 4: Implement** the page, the library and the card.
- [ ] **Step 5: Run** the e2e tests again. They should PASS. Also run `npm run lint` and `npm run typecheck`.
- [ ] **Step 6: Commit** with `feat(studio): the Menu styles gallery`.

### Task 6: Detail page with the phone frame

**Files:**
- Create: `src/app/studio/(studio)/(app)/styles/[id]/page.tsx`, `src/studio/styles/StyleDetail.tsx`
- Test: extend `tests/e2e/studio-styles.spec.ts`

**Interfaces:**
- Consumes: `menuStyleById`, and the page route `/studio/style-files/page/<page>?style=<key>`.
- The page mirrors `motion/[id]/page.tsx`: metadata `<name> · <title>`, the same auth redirects, and `notFound()` for an unknown id.
- `StyleDetail` shows:
  - a `PageHeader` with a back link (`styles.detail.back`), the name, the line and the group
  - previous and next links in catalog order
  - an `<iframe title={name} src=…>` 430×900, inside a rounded phone frame
  - the frame scaled with CSS `min(1, (100dvh - header) / 900)` so it fits short screens
  - an "Open full screen" link (`styles.detail.open`) to the same page URL in a new tab

- [ ] **Step 1: Write the failing e2e tests.**
  - Opening the Airport card lands on `/studio/styles/layout-2-dep` with the heading `Airport of Flavour`.
  - The iframe's frame locator shows `.app.on`.
  - Clicking the first `.add` inside it changes the cart count from ٠.
  - `/studio/styles/themed-par` and `/studio/styles/nope` show the not-found page.
- [ ] **Step 2: Run** the tests. They should FAIL.
- [ ] **Step 3: Implement** the page, guided by the same `impeccable`/`21st-ui-build` direction as Task 5.
- [ ] **Step 4: Run** the tests. They should PASS.
- [ ] **Step 5: Commit** with `feat(studio): open a menu style in a phone frame`.

### Task 7: Verify and review

- [ ] **Step 1: Run** `npm run lint`, `npm run typecheck` and `npm test`. All must pass. Then run `npx playwright test tests/e2e/studio-styles.spec.ts tests/e2e/studio-motions.spec.ts tests/e2e/shell.spec.ts`.
- [ ] **Step 2: Browser check** (`superpowers:verification-before-completion`):
  1. Open the gallery in Arabic, English and Sorani.
  2. Open one style from each group.
  3. Check that the frame fits at 1280×700.
  4. Check that the console is clean.
  5. Take screenshots for the user.
- [ ] **Step 3: Run `graphify update .`**, then run `code-review` on the branch diff. Fix what it confirms.
