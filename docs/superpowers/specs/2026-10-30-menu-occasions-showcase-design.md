# Menu showcase carousels and occasions — design

Date: 2026-10-30. Status: draft for the owner's approval. Spoken language with the owner: Arabic (Iraqi); this document is English.

## Intent and why

The owner of Buzzify Menu (and the restaurants it serves, first Remorse Restaurant) wants to put offers in front of guests the moment the menu opens, and to run seasonal occasions (Ramadan, Eid) without a developer. Today the menu has one small offers list (`OfferList`, specials and percentage discounts) and sets (`Bundle`) that appear only inside dishes and the cart. There is no occasion concept (only reserved hooks: entitlement `guest.occasionMoods`, hero kind `occasion`, preset `the-ramadan-nights`).

The why: a restaurant's busiest, most profitable weeks are occasions. The owner needs to announce a set menu, an open buffet, a family breakfast, and a few discounted dishes, for exactly those weeks, and have the menu go back to normal on its own.

## What the owner asked for (their words, decided)

- Two **carousels**: one **above the search field**, one **below the search field, before the menu**.
- The business owner places any offer in either carousel, freely.
- Offer types that can appear: **special offers** (existing), **set menu** (existing sets), **open buffet** (new), **breakfast / family package for N people** (e.g. 2 or 4; new).
- An **occasion** (Ramadan, Eid) has a **start and end date typed by the owner**. Cards of an occasion show only inside those dates; afterwards the slot returns to normal by itself.
- A breakfast-for-N offer is the owner's own offer: it is not tied to an occasion unless the owner ties it. The owner switches it on and off by hand.

## Goals

1. A guest opening the menu sees the live carousel(s) first, scrolls sideways, and reads each card (title, price, what is included, when).
2. The owner builds all of this in the Studio Sales tab, in one new page, without touching dish records.
3. Occasions turn on and off by date with no owner action.
4. Works in every template body, in Arabic/Kurdish (RTL) and English, on iPhone Safari and Chrome.

## Non-goals

- No table booking, no WhatsApp reservation button, no payment. The buffet card is information only (my call; the owner did not answer the booking question).
- No automatic or recurring dates (no Hijri calendar lookup). Dates are typed.
- No occasion theming (colours, hero swap, background). The existing `occasion` hero and `occasionMoods` entitlement are left alone.
- Not part of this project: moving Signature, Featured, badges, cost, serves, few-left from the product drawer into the Sales tab (separate project, brainstormed and built after this one); fixing the iPhone freeze (separate, branch `menu-diag-flags`).

## Anti-goals (would make this a failure even if it technically works)

- The menu becoming slow or freezing on iPhone. Owner reported a freeze that stops when Signature, Featured and Special are removed; carousels must not add per-card composited layers, transforms on images, animation loops or heavy JS. Native scroll-snap only; no autoplay; a cap on cards.
- An empty carousel leaving a gap, or an expired occasion leaving anything behind.
- The owner needing two places to set one offer.

## Constraints

- Existing stack: Next.js, Prisma, per-template `TemplateMenu.tsx`, Studio under `src/studio/workspace/sales/` (tabs: Overview, Upgrades, Pairings, Sets, Offers, Settings).
- Cashier/POS has no motion; this feature is guest menu and Studio only.
- Project skill chain applies: plan, TDD, impeccable/21st for UI, verification, review.
- Dates are local dates in the menu's time zone (`YYYY-MM-DD`, both inclusive), the same convention as `Promotion.startsOn/endsOn`.
- Plain-language owner copy in all three locales (en, ar, ckb) like the rest of the Studio.

## Behaviour

### Slots
Two named slots, `ABOVE_SEARCH` and `BELOW_SEARCH`. In `TemplateMenu` the first sits before the `tpl-tools` block (search + filters), the second after it and before the body. The Book shape has no search box: the slots keep their order around where the search would be (above the tools block, below it). A slot with no live card renders nothing.

### Cards
Every card has: slot, order, on/off switch, optional occasion, and a translated title and text. Kinds:

| Kind | Content | Source |
|---|---|---|
| Special offer | an existing `Promotion` (SPECIAL or DISCOUNT) | reference, not a copy |
| Set menu | an existing `Bundle` (price, items) | reference |
| Open buffet | title, price per person, time window (days and hours), text | new, self-contained |
| Package for N people | title, number of people (2 to 12, my call), price, included items as text or products, text | new; my suggestion is `Bundle` with an optional `people` field so it can be added to the cart, the builder may choose otherwise |

Card tap: special offer opens its dish (or scrolls to its category); set and package cards add to the cart (owner decided, see the end); buffet only expands its text. Price uses the tenant currency and numeral system.

### Occasions
An occasion has a name (translated), start date, end date, on/off. A card linked to an occasion is live only when today (menu time zone) is within the dates and the occasion is on. Before its start it is hidden (my call). A card with no occasion is live while its own switch is on. The special offer and set keep their own existing date/time rules in addition.

### Owner screen (Studio, Sales tab)
One new page in the Sales tab (name left to the builder, working name "Showcase") with:
1. Occasions list: add, edit dates, switch.
2. Two columns or sections, Above search / Below search, each an ordered list of cards with add card, edit, reorder (up/down like the Offers page), switch, and a small "preview as guest" thumbnail if cheap.
3. An add-card flow that offers the four kinds and, for the two reference kinds, picks from existing offers/sets.
The page follows the existing look of `OffersEditor.tsx` and `SetsEditor.tsx` (same Dialog, Field, Switch, StatusBadge, reorder buttons).

### Guest carousel
Horizontal scroll-snap strip, one to two cards visible at 390px, correct RTL start edge, keyboard and screen reader friendly (list with labelled region), no autoplay, no JS animation, respects reduced motion by default (nothing animates). Cap of 8 live cards per slot (my call). Images are optional; no image means a text card.

## Data and flow (suggested, builder owns the final shape)

- New models: `Occasion` (menuId, translations, startsOn, endsOn, isActive, version) and a card model (menuId, slot, kind, sortOrder, isActive, occasionId?, promotionId?/bundleId? references, buffet/package fields, translations, version). Cascade on menu delete like `Promotion`/`Bundle`.
- Read path: follow exactly how `Promotion` flows to the guest (live overlay with its 30 second cache, not the published snapshot) so an owner's change shows without a publish, unless the builder finds the product rule says otherwise; the builder states which in the plan.
- `MenuView` gains `showcase: { aboveSearch: ShowcaseCardView[]; belowSearch: ShowcaseCardView[] }`, resolved for the guest's locale, dates already filtered.
- A pure function `liveShowcase(cards, occasions, now, timeZone)` holds the date logic and is unit-tested.
- Studio server actions mirror `src/app/studio/_actions/sales.ts` (save, delete, reorder) with version checks.

## Tests that must exist

- Date logic: before start, first day, last day, after end, no occasion, occasion off, time zone edge near midnight.
- Empty slot renders nothing; more than 8 cards is capped.
- Both locales RTL ordering of cards.
- Studio actions: create/edit/reorder/delete, version conflict.
- Browser check at 390px in at least two template shapes (one coverflow, one Book) with the carousel above and below the search.

## Left to the builder

Exact model and file names; whether Package-for-N reuses `Bundle`; card visual design inside each template's tokens (design system and tokens win over the skills); how the "preview as guest" works; plan entitlement gating (none required by the owner).

## Open items, my calls to check

1. Buffet is information only, no booking.
2. Occasion hidden before its start date.
3. Max 8 live cards per slot, people count 2 to 12.
4. Card tap behaviour for special and buffet cards as above.
5. Not gated by plan entitlement.

## Answers from the builder check

Answered by the project:
- Time zone: the menu already has a per-menu `timezone` field (`menu.timezone`, passed to the catalog as `timeZone`). `liveShowcase` takes that; no new field.
- All templates render through `TemplateMenu.tsx`, so the two slots have one insertion point each (Book is the special case above). The card visual is one shared component themed through the template's tokens, not per-template variants.

My calls (check these):
- Read path: live overlay, same as `Promotion`; no publish needed for an occasion to start or end.
- A card whose referenced offer or set is off, outside its own dates or hours, or deleted is hidden from guests. The Studio shows it with a status badge saying why. Deleting an offer or set removes its cards (cascade).
- Buffet time window: structured like `Promotion` (days of week plus start and end minute), reusing its formatter.
- Translations: a missing locale falls back to the default locale like the rest of the menu; a card can go live with one locale filled.

## Owner's answer on ordering

Set and package-for-N cards **add to the cart** (the owner's decision). So the package-for-N kind is built on `Bundle` with an optional `people` field, so it reuses the existing cart and order handling for sets. The buffet stays information only. Special-offer cards open their dish. The guest's tap on a set or package card adds it and shows the cart's usual confirmation (`cart.added` announcement), with a way to open its details first (builder's call on the exact control).
