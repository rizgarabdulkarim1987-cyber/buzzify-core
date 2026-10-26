# Menu Styles library: design

Date: 2026-10-26. Status: waiting for approval.

## Intent and the why

Over seven brainstorm rounds the user picked 35 menu styles from clickable mockups in the visual companion. The mockups
live in a gitignored brainstorm folder and in one browser tab. The user wants them in the Studio, where the people who
build menus can look through them, open each one, and try it, the way the Motion library shows the 150 motions.

This is a showroom, not a switch. A Super Admin or designer uses it to show a client the styles and to agree which one
their menu should get. Turning a style into a working customer menu is later work, done style by style.

## Goals

- A **Menu styles** area in the Studio sidebar, right after Motion, at `/studio/styles`.
- A gallery of the 35 picked styles in four groups, each card with a picture of the style, its name and one line on
  how it browses.
- A detail page per style, `/studio/styles/[id]`, that runs the style full height inside a phone frame. It can be
  scrolled, its sections jumped to, and dishes added to its cart, exactly as in the mockup.
- Names and lines in the Studio's three languages: Arabic, English and Sorani.

## Non-goals

- Applying a style to a real menu. No schema change, no `BrandConfig` field, no customer menu change.
- The wheel of fortune. It stays a plan (an optional extra in every style, switched on from Business Core).
- Real restaurant dishes in the previews. The previews keep the mockups' sample dishes and Unsplash photos.
- Editing a style's colours or fonts from the Studio.

## Anti-goals

- A gallery where the styles look alike. Each card must show the style's own shape (shelf, board, map, comic…), since
  that is the whole point ([[menu-styles-not-just-skins]]).
- Breaking the fast-choice rule in what is shown: the previews are the full menus with many dishes and photos.

## Who sees it

The same people as Motion: Super Admins and designers. An owner who opens the address is sent to `/studio`, through
the same `isOwnerOnly` check the Motion page uses.

## The 35 styles and their groups

Ids are `<file key>-<style key>` so the two `dep` styles (motion and layout) stay apart.

| Group | Styles (mockup key) | Source page |
|---|---|---|
| Themes | kurd, shn, bab, spc, win, sum, prn, book | themed-menus.html (Paris left out: not picked) |
| Kurdish and Arab | cit, ram, lyl | kurd-arab-menus.html |
| Motion-led | thr, stk, mor, fly, ink, stm, dep, kin | motion-menus.html |
| New shapes | elv, per, met, cab, shf, tkt, mag, top, dep, cmc, hom, map, lvl, frg, bnt, box | layout-menus.html, layout-menus-2.html |

## How it is built

- **The styles stay as they are.** Each of the five mockup pages is copied into `src/studio/styles/pages/` (not
  `public/`), as a static page.
  Rewriting 35 styles as React components is the later "make it real" work; for a showroom the mockups are the product.
- **Served only to signed-in Studio people.** A route handler, `/studio/styles/file/[name]`, returns a page or a poster
  after the same actor and `isOwnerOnly` check as the Motion page; anyone else gets a 404. Files in `public/` would skip
  Studio sign-in (the proxy matcher leaves out every path with a dot) and would reach the public menu host. The
  standalone Hostinger build also does not ship `public/`, which the repo has never had. Reading the files from the
  server bundle avoids both. The handler reads the files through `outputFileTracingIncludes`, so standalone output
  carries them.
- **Unpicked styles come out** of the copies: Paris (`par`) from the themes page, and `jli`, `hwr`, `chy`, `sad` and
  `and` from the Kurdish and Arab page.
- **Brainstorm parts come out** of the copies: the like buttons and stored likes, the `brainstorm.send` calls, the
  gallery wording aimed at the user ("press يعجبني").
- **Solo mode.** Each copy reads `?style=<key>` and opens that style straight away. It then hides its own gallery and
  close button, and fits the phone to the frame it is shown in. The detail page shows it in an `<iframe>`.
- **Catalog** in `src/studio/styles/catalog.ts`: id, group, source page, mockup key and number. Its names and lines
  live in the Studio messages, like the motions' do.
- **Card pictures** are WebP stills taken once with Playwright from each style in solo mode, saved to
  `src/studio/styles/posters/<id>.webp` by a script in `scripts/`. There are no 35 live iframes in the gallery.
- **Gallery and detail** reuse the Motion library's parts: `PageHeader`, `SearchFilter`/`useFilterParams`, group
  chips, `EmptyState`, card grid. The detail page has a back link, the name, the line, the group, and the framed preview.
- **Nav**: a `styles` key, icon and label in `src/studio/nav.ts`, shown to the same people as Motion.

## Tests

- Unit (vitest): the catalog has 35 entries with unique ids, every id has a name and a line in all three languages,
  and every entry's page and poster file exist; each copy holds
  only picked styles and no `brainstorm` or like code.
- Route handler: a signed-in designer gets the page, an owner and a signed-out visitor get 404, and a name outside the
  list (`../`, unknown file) gets 404.
- Unit: search filters by name in the viewer's language, and by group.
- Nav test: Super Admin and designer see the item, an owner does not (extend the existing nav tests).
- Browser check: gallery, search, a group chip, opening three styles of different groups, adding a dish inside one,
  and an owner being redirected.

## Skills used while building

`superpowers:writing-plans` for the plan; `superpowers:test-driven-development` for each unit; `impeccable` then
`21st-ui-build` for the gallery and detail screens, following the Studio's existing tokens;
`superpowers:verification-before-completion` before calling it done; `code-review` on the diff.

## Left to the builder

- Exact card size and copy length, within the Motion library's grid.
- How tall the phone frame is on short screens (scale it down; keep it scrollable inside).
- The English and Sorani wording of the 35 names and lines.

## Calls I made (not discussed with the user)

- Static copies of the mockups, shown in an iframe, rather than React rewrites.
- The copies are private: served by a signed-in Studio route, not from `public/` (raised by the builder check).
- Pictures for the cards instead of live previews, to keep the gallery light.
- The four groups and their names.
- Unsplash photos stay hot-linked, as in the mockups.
