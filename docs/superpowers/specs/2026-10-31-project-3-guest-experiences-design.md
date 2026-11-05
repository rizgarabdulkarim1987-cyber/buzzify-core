# Project 3: guest experiences

Status: building (the user said "continue without questions" on 2026-10-31; every choice below is Claude's call,
marked **[call]**, to be checked when the user is back)
Date: 2026-10-31
Builds on: `2026-10-18-product-roadmap.md` (project 3), `2026-10-18-plans-and-entitlements-design.md`,
`2026-10-30-menu-occasions-showcase-design.md` (merged: `Occasion`, `ShowcaseCard`), the existing `PairingRule`.

## 1. Intent

Five plan features are `reserved` and show "Not built yet" in Settings > Plans. Each is something the guest sees and
feels on the menu, sold as a privilege:

| Feature key | Starts in | What the guest gets |
|---|---|---|
| `guest.drinkMatch` | PRO | On a dish, "goes well with": the drinks and dishes the owner paired to it |
| `guest.moodPicker` | PRO | "What are you in the mood for?": one tap puts the matching dishes first |
| `guest.livingPhotos` | PREMIUM | The open dish's photo tilts with the finger or phone and catches a moving sheen |
| `guest.occasionMoods` | PRO | An occasion (Ramadan, Newroz, Eid) tints the menu and counts down its days |
| `guest.stories` | PRO | Instagram-style stories at the top of the menu |

Goal: none is `reserved`; each works end to end (Studio switch, guest menu, plan lock). Slices ship in the order
above (cheapest and most reusable first); a feature turns `live` only in the slice that finishes it.

## 2. Non-goals and anti-goals

- No change to any template's look when a feature is off. Anti-goal: slowing the menu or freezing iPhone (the open
  incident in the occasions design): no per-card transforms, no animation loops on lists, no autoplay.
- No payment, no ordering change. No AI. No cashier change (the cashier has no motion).
- A downgrade never deletes stored data; it only stops guests seeing the feature (project 1's rule).

## 3. Design

### 3.1 Drink and dish match

- Source: the active `PairingRule`s whose source is the dish (or its category), already loaded into the catalog. The
  guest dish sheet gets a "Goes well with" row of up to 3 targets (highest `weight` first, available only, in the
  current daypart), each tappable to open that dish.
- Plan: `guestFeatures().drinkMatch`. Without it the row is absent. The cart suggestions of smart selling are
  untouched and keep their own lock. **[call]** Match is a display; it does not need a new Studio screen: the owner
  already builds pairings in Sales > Pairings.

### 3.2 Mood picker

- Moods are derived, not typed, so no migration and no new field in the dish editor **[call]**: `light` (under 450
  kcal, or vegetarian/vegan), `hearty` (over 750 kcal), `share` (serves 2 or more), `sweet` (dessert category),
  `fresh` (drink category), `popular` (POPULAR or RECOMMENDED badge). Only moods that at least one dish has are
  offered. Pure function `moodsOf(product, categoryKind)` in `src/lib/moods.ts`.
- Picker: a chip row above the dish list; choosing a mood moves matching dishes to the top of their category and
  hides nothing; choosing it again clears. Stored in memory only.
- Plan: `guestFeatures().moodPicker`; the owner can also switch it off per menu (`Menu` setting is deferred; plan
  lock only for now) **[call]**.

### 3.3 Living photos

- A pointer/gyro tilt of at most 6 degrees and a CSS sheen on the photo inside the open dish sheet only, never on
  list cards **[call]**. Off for reduced motion and data saver, and when not a touch/pointer device that can tilt.
- Plan: `guestFeatures().livingPhotos`.

### 3.4 Occasion moods

- `Occasion` gains `mood` (`NONE | RAMADAN | NEWROZ | EID`) and the menu shows, while the occasion is live, a slim
  banner with its name and "N days left" and a tint of the menu's accent **[call]**. A true iftar countdown needs
  sunset times per city and is out of scope.
- Needs one small migration (`Occasion.mood`). Studio: a select in the occasion dialog.
- Plan: `guestFeatures().occasionMoods`.

### 3.5 Stories

- New `Story` model (menu, picture or short video from the library, caption in three languages, optional dish link,
  expiry, order). Guest: a round-avatar rail above the showcase, full-screen viewer with tap to advance, no autoplay
  timer beyond 5 s per picture, close on swipe down **[call]**. Studio: a Stories page in the Sales tab.
- Needs a migration. Plan: `guestFeatures().stories`.

## 4. Constraints

- Pure logic first and tested; UI after. Studio and guest strings in `en`, `ar`, `ckb`.
- Arabic and Kurdish are RTL; never split text per character.
- Honour `prefers-reduced-motion` and data saver.
