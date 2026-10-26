# Menu styles in the Templates gallery: design

Date: 2026-10-26. Follows `2026-10-26-menu-styles-library-design.md` (merged as PR #29) and builds on
`2026-10-18-template-studio-design.md`.

## Intent and the why

The user picked 35 menu styles that change how a menu is browsed (a book with an index, a magazine, a departures
board…), not just its colours. They are in the Studio as a separate showroom of mockups with sample dishes. The user
wants them **in the same place as the templates**: a menu's **Design → Templates** gallery, where a business picks a
look and sees it with its own products in the live preview. "Keep it in the same place and arrange everything on this."
The user asked Claude to do all of it.

Today every one of the 30 templates shares one page skeleton (hero, nav, cards); the presets only change ten knobs.
The styles need something the template system does not have yet: a **browse shape** that replaces the whole body of
the menu.

## Goals

1. A new layout setting, **body** (browse shape): `scroll` (today's skeleton, the default), `book`, `magazine`,
   `board`. It swaps the menu body for a different component, keeping everything around it.
2. Three real templates built on it, numbered 31–33, each a picked style made real with the menu's own products:
   - 31 **The Book** (`the-book`, body `book`): the printed menu book. Its first screen is the index page. Each
     chapter on the index shows its name, how many dishes it holds, and two or three dish photos with prices. Tapping
     a chapter turns to its spread, which shows the dishes as photo cards with prices. A ribbon tab returns to the
     index from any spread.
   - 32 **The Magazine** (`the-magazine`, body `magazine`): a masthead and a section strip. Each section is a spread
     with a lead dish as a large photo and the rest in columns.
   - 33 **Taste Airport** (`taste-airport`, body `board`): a departures board. Gate tabs jump to sections. Each dish is
     a row with its photo, name, gate code and price, and an add button where ordering is on.
3. The Templates gallery gains a **Styles** filter that shows all 35 picked styles in one place:
   - The three that are real are ordinary templates. They are previewed with the menu's products, and Customize and
     publish work as for any template.
   - The other 32 show as **coming soon** cards with their poster. Selecting one shows its sample-dish mockup in the
     preview pane, under the label "Coming soon with your products". They cannot be applied.
4. The separate **Menu Styles** sidebar area and its `/studio/styles` pages are removed, so there is one place.
   `/studio/styles` and `/studio/styles/<id>` redirect to `/studio/menus`. The private style files route, the
   catalog, the posters and the messages stay: the gallery uses them.

## Non-goals

- Making the other 32 styles real. Later batches use the same `body` mechanism, one style at a time.
- The wheel of fortune.
- New business types or a change to how templates are stored.

## Anti-goals

- A body that hides products behind an intro, a cover or one-at-a-time flipping. The first screen must show
  categories, products with photos, and prices (template spec, lines 16–17; [[menu-fast-choice-rule]]). Every section
  is one tap away.
- A heavy library for page turns. The menu is near its script budget; use CSS transforms or a small rAF, no GSAP.

## The current menu stays exactly as it is (the user, 2026-10-26)

"Without breaking the original menu and its motion." The work is additive:

- A template whose body is `scroll` (all 30 today, and every stored design) renders the same DOM, classes, CSS and
  motion as before. The scroll path in `TemplateMenu` is not refactored, only wrapped in a branch.
- Shared motion is untouched: the scene layer and its ambient, tap and scroll effects, the hero motion, the nav
  indicator, the card entrances, the detail sheet and the cart bar. The new bodies sit inside the same frame, so
  those keep working on them too.
- No existing CSS file, skin, token or component changes behaviour. The new bodies bring their own CSS, scoped under
  a `data-body="<kind>"` attribute.
- Proof: the existing template unit tests and e2e specs pass unchanged, and the 30 existing gallery thumbnails are
  regenerated and compared against the committed ones (no visible difference).

## Rules every body obeys (from the template spec)

- It keeps the shared frame that `TemplateMenu` renders around the body: `SceneLayer`, the header, search, dietary
  and favourites filters, promo and offers, info, footer, `CartBar` and `TemplateDetail`.
- It reads only `TemplateContext` and calls `openProduct` / `quickAdd`, so the detail sheet, the cart, deep links
  (`/p/[slug]`) and ordering `none`/`list` work unchanged.
- It renders the filtered `byCategory`, so search, filters and favourites apply.
- It supplies section jumping that works with `jumpTo` and `activeId`: either it keeps the `cat-<slug>` ids, or it
  drives them itself.
- It works in three languages with correct RTL: logical CSS only, and a page turn that mirrors in RTL. It uses the
  tenant's numerals through `useApp().price`.
- With reduced motion there are no turns or flaps: changes are instant or a short fade.
- It meets the contrast rules: 4.5:1 for text, 3:1 for buttons.
- Sold-out, favourites and badges show as they do on today's cards.

## How it is built

- **Schema.** `DesignLayout.body: BodyKind`, where `BODY_KINDS = ['scroll', 'book', 'magazine', 'board']`, is added
  in these places:
  - `types.ts`
  - `LAYOUT_RULES` (`resolve.ts`)
  - `menuDesignSchema` (`design-schema.ts`), as optional with default `scroll`, so existing snapshots parse without a
    schema version bump
  - the Customizer's `LAYOUT_CHOICES`, with messages in en, ar and ckb

  The 30 existing presets get `body: 'scroll'`.
- **Renderer.** `TemplateMenu` branches on `design.layout.body`. `scroll` keeps today's hero, nav and sections.
  Other kinds render `<BookBody/>`, `<MagazineBody/>` or `<BoardBody/>` from `src/ui/template/bodies/`, each with its
  own CSS.
- **Everything stays editable (the user, 2026-10-26).** The new templates must let a business change everything the
  Templates page lets it change today:
  - palette and its alternatives
  - fonts, scale, case and tracking
  - the scene: mode, intensity, speed, ambient, tap, scroll, brightness, blur, opacity and overlay, plus scene files
  - detail kind, option style, image ratio, density, corners and shadow
  - featured dish, promo, info and ordering

  Each body honours those settings through the same CSS variables and components the scroll body uses. The structural
  knobs also stay live wherever the shape allows:

  | Body | Live structural knobs | Set by the shape |
  |---|---|---|
  | book | `heading` (`SectionHeading`) and `card` (`ProductList` on the spreads) | `hero` and `nav` (the index and the ribbon replace them) |
  | magazine | `nav` (`Nav` for the section strip), `heading` and `card` (`ProductList` beside the lead dish) | `hero` (the masthead replaces it) |
  | board | none: rows, gate tabs and gate labels are the shape | `hero`, `nav`, `card`, `heading` |

  The board honours density (row height), image ratio (row photo), corners and colours. Only knobs a shape sets are
  hidden in Customize. In their place it says, in all three languages, "Set by the <shape> shape". The body choice
  itself is a select, so a business can switch a template between shapes.
- **Presets.** Three `definePreset` entries are added in a new `presets/styles.ts`:
  - business `restaurant`
  - tags that include their theme
  - at least three alternatives each
  - a palette and fonts that follow each mockup: the book in paper and ink, the magazine as editorial, the airport
    as a black board with yellow

  They are appended to `TEMPLATE_IDS`. Their gallery thumbnails come from the existing `studio:thumbnails` generator.
  The tests that pin the list change: numbers 1–33, and 13 restaurant presets.
- **Gallery.** The Styles filter is backed by the menu-styles catalog (`src/studio/styles/catalog.ts`), with a
  mapping from a catalog id to a template id for the real ones:
  - `themed-book` maps to `the-book`
  - `layout-mag` maps to `the-magazine`
  - `layout-2-dep` maps to `taste-airport`

  Coming-soon cards use `/studio/style-files/poster/<id>`. The preview pane shows
  `/studio/style-files/page/<page>?style=<key>` for them.
- **Removal.** The following are removed:
  - the `styles` nav item and its icon mapping
  - the `/studio/styles` pages: the gallery, the detail page and their components
  - their e2e tests, which are replaced by Design-tab tests

  Redirects are left behind for old links.

## Tests

- **Unit, templates:** 33 presets with ids equal to `TEMPLATE_IDS`, and the counts updated. Every preset has a
  `body`. The three new presets have their bodies and pass the palette contrast checks that exist today.
- **Unit, schema:** a stored design without `body` parses as `scroll`. An unknown body is dropped by
  `parseOverrides` and rejected by `menuDesignSchema`.
- **Unit, catalog mapping:** every mapped template id exists, and every other catalog id is coming soon.
- **Component or e2e, each body:**
  - It renders all categories and products with prices on the first screen. For the book this is the index with
    photos and prices.
  - A section jump works.
  - `openProduct` opens the detail sheet.
  - Quick add updates the cart when ordering is on.
  - It works in Arabic, with RTL.
- **E2e, Design tab:**
  - The Styles filter shows 35 cards.
  - Picking The Book previews the menu's own products and can be applied.
  - A coming-soon card shows its mockup and offers no apply.
  - `/studio/styles` redirects.
- **Nav tests:** the styles item is gone.

## Left to the builder

- The exact visuals of each body within the rules, following the matching mockup in
  `src/studio/styles/pages/{themed,layout,layout-2}.html` (keys `book`, `mag` and `dep`).
- How the book's page turn looks, and its timing (CSS, at most 300 ms, mirrored in RTL).
- Alternative palettes and the copy of the Studio labels.

## Calls Claude made (the user said "do everything")

- The first batch is the book, the magazine and the airport board. The user named the book and the newspaper or
  magazine. The board was chosen because it is the most list-like of the shape styles.
- The new templates are restaurant templates for now.
- Coming-soon styles show in the gallery with their mockup, not hidden.
- The separate Menu Styles area is removed, and redirects are left behind.
- Any template may choose any body in Customize.
- Which structural knobs each shape keeps live, as in the table above.
