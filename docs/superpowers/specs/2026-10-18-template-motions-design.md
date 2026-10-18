# Motions and templates, connected

Status: agreed with the user, 2026-10-18 ("نعم، هذا ما أقصده ... ابدأ ولا تسأل كثيراً")
Builds on: `2026-10-18-menu-motions-design.md` (the Motion tab) and `2026-10-18-template-studio-design.md` (the 30 presets)

## 1. Intent

The user reported that "the motions are not connected to the menu templates". Today a menu with a template is drawn by
`TemplateMenu`, which draws none of the Motion tab's motions, and no preset comes with any. The user agreed to three
things:

1. Template menus show the Motion tab's motions.
2. Each template comes with suggested motions from the library, placed on the menu when a designer chooses the
   template, and still changeable or removable in the Motion tab.
3. The Template Studio shows them: its live preview of a template, and its gallery.

Anti-goals: a template's text, prices or first screen pushed down or made hard to read; a designer's own motion
replaced by a template's suggestion; motions placed on a plan without `design.menuMotions`; motion that cannot be
paused on a template menu.

## 2. Where motions play on a template menu (the builder's call)

| Place | Template menu |
|---|---|
| `hero` (Top of the menu) | Behind the template's header and hero, as a backdrop: it fades into the page at its bottom and is veiled by the page colour (the template's scene overlay, at least 0.4), with the header and hero in front. It adds no height, so products stay on the first screen. |
| `category` | A band above the category's heading, as on the classic menu. |
| `signature` | Not drawn: a template shows the dish of the hour as its hero's own picture, usually a full-width photo, which would hide anything behind it. The Motion tab says so for a template menu. |

The template's motion pause button (the footer's) also pauses placed motions, and shows whenever the menu has a placed
motion, even with a static scene. Reduced motion shows still frames, as everywhere.

## 3. Suggested motions

- Each preset names one motion for the top of the menu (`motions.hero`), chosen for its look: golden particles for
  Obsidian Gold, coffee beans for Copper Roast, an ice-cream swirl for Gelato Riviera, and so on (the table lives in
  `src/lib/templates/motions.ts`).
- Every preset also suggests motions for categories by what they hold, read from each category's slug and names in all
  three languages: coffee gets coffee steam, desserts chocolate dripping, ice cream a swirl, cold drinks a splash, the
  grill flames. At most three categories get one, the first matches in menu order.
- A suggestion starts on the template's page colour (`background`) and, for the ambient motions, its accent (`color`);
  words that stand for the brand get the logo text.

## 4. Choosing a template

- `MenuMotion` gains `fromTemplate String?`: the preset that placed it. A motion the designer placed or saved in the
  Motion tab has none.
- Applying a template (or Classic, or a saved design) removes the motions earlier templates placed, then places the new
  preset's suggestions where the place is empty. The designer's own motions are never touched.
- Saving a suggested motion in the Motion tab makes it the designer's (`fromTemplate` null); removing it removes it until
  a template is applied again.
- Suggestions are placed only when the restaurant's plan includes `design.menuMotions`.
- `fromTemplate` is Studio bookkeeping, not part of the snapshot: hashes do not change, and a restored or duplicated
  menu's motions count as the designer's.

## 5. The Studio

- Design tab preview: while a designer looks at a template not yet applied, the preview shows the motions applying it
  would give (the designer's own, plus that preset's suggestions in the empty places).
- Gallery: each preset's card names its top-of-menu motion.
- Motion tab: a suggested motion is marked "Suggested by {template}"; with a template applied, the hero row explains that
  it plays behind the template's top, and the signature row that templates do not show it.

## 6. Testing

Unit: the category classifier (three languages, first match wins, at most three); every preset's suggestions are
offered motions; applying a template replaces earlier suggestions and keeps the designer's motions; nothing placed on a
plan without the feature; saving a suggestion makes it the designer's; the preview's swap. E2e: applying a template
in the Design tab places its motion, and the published template menu plays it.
