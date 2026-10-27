# 77 more menu styles as real templates: addendum

Date: 2026-10-28. Adds to `2026-10-26-menu-styles-in-templates-design.md` (the first 35, merged as PR #51). Every rule
of that spec still holds: the scroll menu and its motion do not change, bodies keep the shared frame, fast choice,
three languages with RTL, reduced motion, contrast, no GSAP.

## Intent

From rounds 8–20 of the brainstorm the user liked 77 more styles. On 2026-10-28 they asked to "put them in the system,
only with search, I can customise the colours, and the sales apply to them". Each one becomes a template in the
gallery's Styles filter, applied with the menu's own products.

## What every new template must do

1. **Search.** The shared `SearchField` stays above every body and filters `byCategory`. No mockup header replaces it.
2. **Colours.** Palette, its alternatives and fonts drive the body through the same CSS variables as the 35. Nothing
   the palette should drive is hard-coded.
3. **Sales.** The discount price and the offer badge show on every dish, as on the 35.
4. **Brand.** A title a mockup invented inside its shape (a masthead, a cinema sign, a radio station) shows
   `tenant.logoText`, or the logo where there is room, never a sample name.
5. **Products.** `openProduct`, `quickAdd`, the detail sheet, the cart, and section jumps with `jumpTo` / `activeId`.

## Families: one body kind, several looks

Many of the 77 share a structure: seven are dishes strung down a central line, seven are covers that open when they
reach the middle of the screen. Giving each its own body would mean 77 near-copies. Instead:

- A **family** is one new `BodyKind` with one component: the structure, the section jumps, the motion engine.
- A new optional `layout.motif` names the family's look (beads, footsteps, torches…). Each motif brings its own CSS,
  scoped under `[data-body="<kind>"][data-motif="<motif>"]`, so the drawing and the motion of each style stay its own.
  Absent means the family's first motif. Customize shows the motif as a select under the body, in en, ar and ckb.
- A style that matches one of the 35 shapes shares that body kind and adds a preset (and, where the drawing differs,
  a motif on that body).

## The 77 by family

| Family (`BodyKind`) | Structure | Styles (mockup keys) |
|---|---|---|
| `carpet` (existing) | floating section blocks | carpet, sp-isle |
| `lattice` (existing) | shanashil facade | shan |
| `magazine` (existing) | lead dish and columns | front |
| `board` (existing) | price board rows | bourse |
| `stacked` (existing) | sheets whose heads stay | catalog |
| `ledger` | dense rows, one line a dish | sheet, serp, typew, cassette, radio |
| `coverflow` | per-section sideways carousel, the middle one large | sp-deck, zel, saj, crate |
| `pedestal` | cards lifted on a light base | sp-lift, sp-holo |
| `drift` | sideways rows that drift, a touch stops them | sp-drift, sadu, halay, dabka, faqi, ahwar |
| `swing` | cards hung on strings, in a grid | peg, kew, lira, balloon |
| `rope` | a sideways line per section with hung items | cable, kiosk, arcade |
| `float` | scattered tilted cards at different depths | sp-zero, kilim, henar, jamana, clips |
| `dense` | many small boxes in columns | ads, sp-ctrl |
| `spine` | dishes alternate sides of a central line | sp-count, misb, newroz, klash, dengbej, sp-comet, manus |
| `lens` | size by distance from the screen's middle | sp-warp, sp-worm, sp-hole, bazaar, stamps |
| `frame` | an ornate section frame, two columns | deco, marquee |
| `reveal` | a cover opens at the screen's middle | opera, resmal, khurjin, sadaf, mashra, fold, tone |
| `vitrine` | object tiles with a window on the photo | wash, jewel, apoth, qays, clay |
| `pinboard` | tilted pieces stuck on a page | album, afish, pass, xayat, ticket |
| `orbit` | dishes on a ring round the section | sp-orbit, tannour, daf |
| `stars` | dishes as linked stars | sp-const |
| `hex` | honeycomb cells | honey |
| `towers` | a building per section, side by side | city |
| `snakes` | one numbered board, zigzag | snake |
| `filmstrip` | a vertical film with title cards | film |
| `wrap` | wraps that fold in from both sides | pshtwen |

16 new kinds join `BODY_KINDS` (21 families counting the five existing shapes). Total: 77.

## Batches (one PR each, confirmed with the user before each push)

| Batch | Families | Styles | Count |
|---|---|---|---|
| 10 | existing shapes, plus the gallery plumbing for all 77 | carpet, sp-isle, shan, front, bourse, catalog | 6 |
| 11 | `ledger` | sheet, serp, typew, cassette, radio | 5 |
| 12 | `coverflow`, `pedestal` | sp-deck, zel, saj, crate, sp-lift, sp-holo | 6 |
| 13 | `drift` | sp-drift, sadu, halay, dabka, faqi, ahwar | 6 |
| 14 | `swing`, `rope` | peg, kew, lira, balloon, cable, kiosk, arcade | 7 |
| 15 | `float`, `dense` | sp-zero, kilim, henar, jamana, clips, ads, sp-ctrl | 7 |
| 16 | `spine` | sp-count, misb, newroz, klash, dengbej, sp-comet, manus | 7 |
| 17 | `lens`, `frame` | sp-warp, sp-worm, sp-hole, bazaar, stamps, deco, marquee | 7 |
| 18 | `reveal` | opera, resmal, khurjin, sadaf, mashra, fold, tone | 7 |
| 19 | `vitrine` | wash, jewel, apoth, qays, clay | 5 |
| 20 | `pinboard` | album, afish, pass, xayat, ticket | 5 |
| 21 | `orbit`, `stars`, `hex` | sp-orbit, tannour, daf, sp-const, honey | 5 |
| 22 | `towers`, `snakes`, `filmstrip`, `wrap` | city, snake, film, pshtwen | 4 |

Batch 10 also adds the 77 to the catalog (`src/studio/styles/catalog.ts`): their 12 mockup pages move into
`src/studio/styles/pages/`, each style gets a poster, and the Styles filter shows 112 cards. Styles of later batches
show as coming soon with their mockup until their batch lands.

## Rules for the mockups' motion

- Endless motion (drifting rows, orbiting rings, swaying strings) stops while a finger is on it, pauses off screen,
  and is off under reduced motion; the structure stays readable without it.
- Drifting and orbiting rows always show several dishes at once and can be dragged; none is one-at-a-time.
- `sp-hole` and `lens` scale only by distance from the middle; a dish never leaves before it can be read and tapped.
- The `snake` dice only suggests a dish; every square is tappable directly.
- The space and floating styles take buzzify.me's look only: no buzzify logo, no agency copy.
- Arabic text is never split into letters: word-level motion at most.

## Tests (per batch, as in the first spec)

- Presets equal `TEMPLATE_IDS`, counts updated, each new preset has its body and motif and passes palette contrast.
- Schema: a design without `motif` parses; an unknown motif is dropped by `parseOverrides` and rejected by
  `menuDesignSchema`; a motif that does not belong to the body falls back to the family's first.
- Each family: all sections and dishes with prices on the first screen, a section jump, the detail sheet, quick add,
  search filters it, a discounted dish shows its sale price, the tenant's name shows, Arabic RTL.
- Unchanged: the existing unit and e2e tests and the 35 existing gallery thumbnails.
