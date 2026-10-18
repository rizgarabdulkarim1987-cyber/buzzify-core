# Motions on a client's menu

Status: the builder's design; the user said to go ahead without more questions ("هيا", 2026-10-18)
Date: 2026-10-18
Branch: `claude/musing-hugle-66b065`, built on `motion-studio` (43fca96)
Builds on: the motion library (`docs/superpowers/plans/2026-10-18-motion-studio.md`), Studio Core
(`2026-10-16-studio-core-design.md`), plans and entitlements (`2026-10-18-plans-and-entitlements-design.md`)

## 1. Intent

The Motion Studio holds 150 motions that designers can watch and tune, but a guest never sees one. This project lets a
Buzzify designer put motions from that library on a client's menu: choose a place on the menu, choose a motion, tune it
with the same controls as the Motion Studio, publish, and every guest who opens the menu sees it play.

It is the "motion graphic" privilege the user asked to sell (roadmap, "make these as privileges"), so it is a plan
feature from the start.

Success: a designer opens a menu's new Motion tab, puts golden particles at the top of the menu and coffee steam over
the "Hot drinks" heading, publishes, and the public menu plays both, in the guest's language and direction, without the
menu loading any slower for guests whose menu has no motion.

## 2. Goals, non-goals, anti-goals

Goals:

- Three places on the menu that take a motion (section 3), each set, tuned and removed on its own.
- Text in a motion (a typography motion's words) written per language of the menu.
- Part of the draft: guests see it after a publish; revisions, rollback, restore to draft and duplicate carry it.
- A plan feature with the usual rules: locked choices may be kept, never newly made; guests on a plan without it see
  the menu as it is today.

Non-goals (this project):

- A motion as the transition between categories, or between pages. The library's transitions draw stand-in pages of
  their own; they cannot move the menu's real content. A transition built for the menu belongs to the templates project.
- A motion behind the whole page. Text over a moving picture is hard to read; uploaded backgrounds (image, video) are
  Project 2's, and a full-page motion belongs with them.
- Motions on the product page, the cart, Explore, the table entry page or the unavailable page.
- New motions, or changes to the library's 150 beyond what placing them needs.
- Uploading Lottie or video files.

Anti-goals (a failure even if everything else works):

- The menu route's first JavaScript grows for a menu with no motion, or carries the animation library for any menu.
- A guest sees a fake button, a fake menu row or a fake page (several library motions are demonstrations of controls).
- A motion makes a heading, a price or the logo hard to read, or moves the page's layout as it loads.
- A guest who asks for reduced motion, or a menu whose motion level is "none", gets moving pictures.
- A motion takes taps or scrolling away from the menu.

## 3. The places (the builder's call)

| Key | Name in the Studio | Where guests see it | Shape |
|---|---|---|---|
| `hero` | Top of the menu | A band right under the header (logo, language), above the search box | full width, 2:1, at most 280 px high |
| `signature` | Behind the signature dish | Behind the dish of the hour, inside its lit stage; the 3D stage is transparent, so the motion shows around the dish | the stage's own box (5:4) |
| `category` | A category's heading | A band above that category's heading; the heading overlaps its faded lower edge. Set per category | full width, 3:1, at most 160 px high |

Each band fades into the page at its edges (a mask, as the signature stage already does), so text never sits on the
moving part: the logo is above the hero band, the search box below it, and a heading sits where its band has faded out.

A menu holds at most one motion per place: one hero, one signature, one per category.

## 4. Which motions a place offers

Only motions that are pictures: the groups **3D**, **luxury**, **food**, **backgrounds**, **typography** and **effects**
(90 motions). The groups **scroll**, **interactive**, **micro-interactions** and **transitions** are left out: they draw
stand-in menu rows, cards, buttons and pages that guests would take for the real ones. The list is a property of the
place (`placeMotions(place)`), the same for all three places in this release, so a later place can differ.

The server refuses any other motion id, whatever the Studio sends.

## 5. What a placement holds

- `motionId`: one of the offered motions.
- `params`: the motion's parameters other than text, stored resolved (`resolveParams`): defaults filled, ranges
  clamped, unknown keys dropped. The guest page resolves them again, so a value saved for an older version of a motion
  can never reach its code.
- `texts`: for each text parameter, a text per language of the menu (`{ [param]: { en?, ar?, ckb? } }`), each at most
  the parameter's length. A guest reads their language, then the menu's default language, then the brand's logo text
  (the name guests see), so a guest never sees the library's sample words ("Buzzify", "Fresh every morning").

When a designer first picks a motion, its colour parameter `background` starts as the page colour of the menu's theme,
so the band melts into the page; every other parameter starts at the library's default. Text parameters whose sample is
the brand start as the brand's logo text in every language; others start empty (and so read as the logo text).

## 6. Data

```prisma
model MenuMotion {
  id         String    @id @default(cuid())
  menuId     String
  /// `hero`, `signature`, or `category:<categoryId>`; one motion per place.
  slot       String
  /// The category whose heading it plays over (category places only); deleting the category deletes the motion.
  categoryId String?
  motionId   String
  params     Json
  texts      Json      @default("{}")
  version    Int       @default(1)
  updatedAt  DateTime  @updatedAt
  menu       Menu      @relation(fields: [menuId], references: [id], onDelete: Cascade)
  category   Category? @relation(fields: [categoryId], references: [id], onDelete: Cascade)

  @@unique([menuId, slot])
  @@index([categoryId])
}
```

`slot` carries the uniqueness (PostgreSQL treats two NULL `categoryId`s as different, so a unique on the category
alone would allow two heroes); `categoryId` carries the cascade. Only the motions service writes rows, and it always
writes the two together. The model is menu-scoped in the tenancy registry.

## 7. Publishing

- The snapshot gains an optional `motions: SnapshotMotion[]`, sorted by slot, **left out when the menu has none**, so
  every existing draft and revision hashes exactly as before and no menu shows "unpublished changes" after the deploy.
  `SnapshotMotion = { place: 'hero' | 'signature' | 'category', categoryId?: string, motionId, params, texts }`.
- `parseSnapshot` reads it defensively: an entry with an unknown place, an unknown or no-longer-offered motion id, or a
  category the snapshot does not contain is dropped; params go through `resolveParams`; texts are trimmed to length and
  to the snapshot's languages.
- Restore to draft writes the rows back with the snapshot's category ids. Duplicate writes them with the new category
  ids (the map `writeDraftFromSnapshot` already builds). Rollback moves `liveRevisionId` and needs nothing.
- The guest-facing form lives on `TenantInfo.motions` (section 9), so the slug cache's key moves (`'slug', '3'`).

## 8. The plan

- New live feature `design.menuMotions` ("motions from the library on the menu"), area design, Project 2, **starts in
  Pro**. Every existing restaurant is Premium, so nothing changes for them.
- Guests: without the feature, `TenantInfo.motions` is empty and every place renders exactly as today. The plan is read
  live, so a downgrade hides motions without a publish, and an upgrade brings them back.
- The Studio: the Motion tab shows for anyone with `brand.edit`. On a plan without the feature it shows the lock and
  the upgrade hint (as the Brand tab does) and the "Choose a motion" buttons are replaced by the hint. Saving a place
  that already holds the same motion is accepted (a kept choice, even with new params or texts); choosing a new motion
  or filling an empty place is refused with `UPGRADE_REQUIRED`. Removing is always allowed.
- The Preview tab shows what guests on the restaurant's plan see, with the existing "Guests on this plan don't see" note
  listing motions when they are hidden.

## 9. Guests

- `TenantInfo.motions`: the snapshot's motions, empty without the feature, each with its params and texts resolved for
  rendering (texts stay per language; the page picks the guest's).
- The menu renders a `MenuMotion` slot at each place that has one. The slot reserves its box with CSS (aspect ratio and
  max height) before anything loads, so nothing shifts.
- The slot is loaded with `next/dynamic` from a file that imports `@/motion`; a menu without motions never loads it,
  and the animation library itself only arrives with a motion's own code. The `<Motion>` inside mounts once the slot is
  within about one screen of the viewport and the page is idle, so motion code never competes with the first paint.
- `respectReducedMotion` stays on: a guest who asks for reduced motion sees a still frame. A menu whose motion level is
  "none" shows every placed motion as a still frame too.
- The slot is decoration: `aria-hidden`, `inert`, `pointer-events: none`, so it never takes a tap or a scroll (a
  pointer-driven motion plays its own gentle synthetic pointer). Motions pause off screen (the library already does).
- `dir` follows the guest's language, so sideways motion mirrors in Arabic and Sorani.
- A motion that fails to load or has no WebGL shows its still fallback (the library already does); the menu never
  breaks.

## 10. The Studio

- A new workspace tab, **Motion** (`/studio/menus/{id}/motion`), after Brand, needing `brand.edit`.
- The tab lists the places: Top of the menu, Behind the signature dish (with a note when the menu has no signature
  dish), and one row per category in the menu's order. Each row shows a small still preview of its motion and the
  motion's name, or "No motion", with Choose / Change and Remove.
- Choose opens the picker: the offered motions as live cards (the Motion Studio's cards, mounted near the viewport),
  with the Motion Studio's search and group chips. Picking one opens the tuner.
- The tuner: a live preview in the place's own shape, drawn on the menu's page colour; the Motion Studio's parameter
  controls for everything but text; for each text parameter, one field per language of the menu. Save and Cancel. The
  save is at the placement's version; a conflict shows the framework's usual message.
- Saving and removing go through the framework's actions (`motions.save`, `motions.remove`, permission `brand.edit`,
  feature `design.menuMotions` as section 8), through `editDraft` (so the draft hash moves and "unpublished changes"
  appears), and into the audit log with the before and after.
- The tab reuses `MotionCard`, `ParamControls` and the gallery's search from `src/studio/motion`, split where needed so
  a card can select instead of linking.
- English, Arabic and Sorani messages for everything (the messages test enforces parity).

## 11. Testing

- Unit: `placeMotions` offers exactly the six groups; the save's validation (place, motion offered, category belongs
  to the menu, params resolved, texts trimmed to the menu's languages and lengths); the plan rule (new refused, kept
  accepted, remove allowed); snapshot hash unchanged for a menu without motions; snapshot carries motions and
  `parseSnapshot` drops bad entries; restore and duplicate carry motions (duplicate remaps the category); deleting a
  category deletes its motion; `TenantInfo.motions` empty without the feature; text fallback order.
- End to end: a designer opens the Motion tab, chooses golden particles for the top of the menu, changes its colour,
  saves, publishes; the public menu shows a `[data-motion="golden-particles"]` slot at the top that plays; with reduced
  motion it does not play.
- `npm run typecheck`, lint of the project's folders, the unit suite, the new e2e test and the existing menu e2e tests.

## 12. The builder's calls

The user opted out of questions, so these are the builder's, open to change:

1. The three places of section 3, and leaving transitions, page backgrounds and the product page out.
2. Bands under or above the text rather than behind it, for legibility.
3. The six groups of section 4.
4. Texts per language with the logo text as the last fallback.
5. The new key `design.menuMotions`, starting in Pro.
6. The permission `brand.edit` (designers by default; owners only if a policy grants it).
7. A menu with motion level "none" shows placed motions still.
8. `background` starting as the page colour.
