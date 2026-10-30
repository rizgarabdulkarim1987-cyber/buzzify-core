# Menu Showcase Carousels and Occasions Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Two guest-menu carousels (above and below the search field) that show special offers, sets, an open buffet and "package for N people" cards, with occasions that switch cards on and off by owner-typed dates, all managed from one new Studio Sales page.

**Architecture:** New `Occasion` and `ShowcaseCard` tables beside `Promotion`/`Bundle`, loaded by `catalog-loader.ts` into `Catalog` and resolved for the guest by a pure `liveShowcase()` into `MenuView.showcase`. A shared `ShowcaseCarousel` component renders each slot from one insertion point per slot in `TemplateMenu.tsx`. Studio gets services/actions/queries that copy the existing `saveOffer`/`reorderOffers` patterns (draft edit, versions, audit). Package-for-N is a `Bundle` with an optional `people` field so it reuses the cart's `setBundleQuantity`.

**Tech Stack:** Next.js, Prisma (Postgres), Zod, Vitest (`npm test`, `npm run typecheck`, `npm run lint`), the in-app browser for 390px checks.

**Spec:** `docs/superpowers/specs/2026-10-30-menu-occasions-showcase-design.md`

## Global Constraints

- Work in a **fresh worktree off `main`** (the current checkout has unrelated uncommitted work in `prisma/schema.prisma`, `package.json`, and others; do not build on it). Worktree needs `npm ci` (or the `node_modules` junction), its own `BUZZIFY_DB_PORT`, and `next-env.d.ts`; see memory `worktree-setup`.
- Dates are `YYYY-MM-DD` local dates in `menu.timezone` (passed to the catalog as `timeZone`), both inclusive; use `localDate(now, timeZone)` from `src/server/domain/offers.ts`.
- Max **8** live cards per slot; people count **2 to 12**; buffet is **information only** (no booking, no cart).
- Special-offer card opens its dish; set and package cards **add to the cart**; buffet only expands its text.
- Read path is the same as `Promotion`: loaded live in `catalog-loader.ts`, no publish needed for a start/end date to take effect. Do not touch the published snapshot schema in `src/server/domain/snapshot.ts` beyond keeping its types compiling.
- A card whose referenced offer/set is off, outside its own dates or hours, or deleted is hidden from guests; the Studio shows a status badge saying why. Deleting an offer or set cascades to its cards.
- A missing translation falls back to the default locale (`resolveText(..., locale, fallback)`); one filled locale is enough.
- Carousel: native scroll-snap only. No autoplay, no transforms on images, no `will-change`, no per-card animation (iPhone freeze anti-goal). Empty slot renders `null`. RTL correct.
- Studio copy goes in all three of `src/studio/messages/en.ts`, `ar.ts`, `ckb.ts`; guest copy in the guest messages the same way `offers.label` is added.
- Cashier/POS code is untouched. Template tokens and design system win over any skill's aesthetics.
- Out of scope: moving Signature/Featured/badges/cost/serves/few-left into the Sales tab, fixing the freeze, occasion theming or the `occasion` hero.

## Review Focus

- A card pointing at a set whose dishes are all hidden/out of hours: must be hidden, not shown unorderable. Test in Task 1 (`liveShowcase`) and Task 3.
- Occasion dates typed backwards (end before start) or one day only: rejected on save when end < start; one-day occasion shows that whole day. Tests in Tasks 1 and 4.
- 1,000-character or one-word-no-space titles and 8+ cards: carousel must not overflow the page horizontally (only the strip scrolls). Test in Task 6 plus the 390px check.
- Midnight in the menu's time zone (Asia/Baghdad is UTC+3): an occasion ending today stays live until local midnight. Test in Task 1.
- Guest taps "add" on a package twice quickly: quantity 2, not two lines or an error. Test in Task 6.

---

### Task 1: Pure showcase logic

**Files:**
- Create: `src/server/domain/showcase.ts`
- Test: `tests/domain/showcase.test.ts`

**Interfaces:**
- Produces:
  ```ts
  export const SHOWCASE_SLOTS = ['ABOVE_SEARCH', 'BELOW_SEARCH'] as const;
  export type ShowcaseSlot = (typeof SHOWCASE_SLOTS)[number];
  export const SHOWCASE_KINDS = ['OFFER', 'SET', 'BUFFET'] as const; // a package for N is kind SET whose bundle has people
  export type ShowcaseKind = (typeof SHOWCASE_KINDS)[number];
  export const SHOWCASE_MAX_PER_SLOT = 8;
  export interface CatalogOccasion { id: string; startsOn: string; endsOn: string; isActive: boolean; translations: TranslationMap /* name */ }
  export interface CatalogShowcaseCard {
    id: string; slot: ShowcaseSlot; kind: ShowcaseKind; sortOrder: number; occasionId: string | null;
    promotionId: string | null; bundleId: string | null;
    price: number | null;            // BUFFET: per person
    startMinute: number | null; endMinute: number | null; daysOfWeek: number; // BUFFET window
    translations: TranslationMap;    // title, text
  }
  export function isOccasionLive(occasion: CatalogOccasion, now: Date, timeZone: string): boolean;
  export function liveShowcase(input: {
    cards: CatalogShowcaseCard[]; occasions: CatalogOccasion[];
    liveOfferIds: ReadonlySet<string>; shownBundleIds: ReadonlySet<string>; now: Date; timeZone: string;
  }): Record<ShowcaseSlot, CatalogShowcaseCard[]>;
  ```
  `liveOfferIds` = ids from `liveOffers(catalog, now)`; `shownBundleIds` = bundles whose items are all shown (reuse the check in `snapshot.ts:425` / the `menu-view.ts` product visibility).
  Types `CatalogOccasion`/`CatalogShowcaseCard` are also re-exported from `src/server/domain/types.ts` and added to `Catalog` as required arrays `occasions` and `showcaseCards` (update `tests/domain/fixtures.ts` `makeCatalog` with `[]` defaults).

- [ ] **Step 1: Write failing tests** in `tests/domain/showcase.test.ts` using `makeCatalog`/`at` from `./fixtures` and `TZ = 'Asia/Baghdad'`:
  - `isOccasionLive`: false the day before `startsOn`, true on `startsOn`, true on `endsOn` at 23:30 local, false at 00:01 local the next day, false when `isActive` false, true for a one-day occasion on that day, and the UTC-vs-local edge (an instant that is the previous UTC date but already `startsOn` in Baghdad is live).
  - `liveShowcase`: card without occasion is live; card of an ended occasion is dropped; OFFER card whose `promotionId` is not in `liveOfferIds` is dropped; SET card whose `bundleId` is not in `shownBundleIds` is dropped; BUFFET card outside its `daysOfWeek`/time window is dropped (window wraps midnight when end <= start, same as `isOfferLive`), all-day when both minutes null; result ordered by `sortOrder` then `id`; capped at `SHOWCASE_MAX_PER_SLOT` per slot; both slots always present as arrays.
- [ ] **Step 2: Run** `npx vitest run tests/domain/showcase.test.ts` — expect FAIL (module missing).
- [ ] **Step 3: Implement** `showcase.ts` per Interfaces. Reuse `localDate` and the window/weekday logic from `isOfferLive` in `offers.ts` (extract a shared `inWindow(now, timeZone, {startMinute,endMinute,daysOfWeek})` there if one is not already exported, keeping `offers.test.ts` green). Add the type exports and the two `Catalog` fields.
- [ ] **Step 4: Run** `npx vitest run tests/domain` and `npm run typecheck` — expect PASS (fixtures updated).
- [ ] **Step 5: Commit** `feat(showcase): pure live-showcase logic and catalog types`.

### Task 2: Schema and migration

**Files:**
- Modify: `prisma/schema.prisma`
- Create: `prisma/migrations/20261030120000_showcase/migration.sql` (generate with `npx prisma migrate dev --name showcase --create-only`, then review)

**Interfaces:**
- Produces Prisma models (names are the contract for Tasks 3–5): `enum ShowcaseSlot { ABOVE_SEARCH BELOW_SEARCH }`, `enum ShowcaseKind { OFFER SET BUFFET }`, `model Occasion { id, menuId, startsOn String, endsOn String, translations Json /* name */, isActive Boolean @default(true), sortOrder Int @default(0), version Int @default(1), createdAt, menu @relation(onDelete: Cascade), cards ShowcaseCard[] @@index([menuId]) }`, `model ShowcaseCard { id, menuId, slot ShowcaseSlot, kind ShowcaseKind, sortOrder Int, isActive Boolean @default(true), occasionId String? (onDelete: Cascade), promotionId String? (relation to Promotion, onDelete: Cascade), bundleId String? (relation to Bundle, onDelete: Cascade), price Int?, startMinute Int?, endMinute Int?, daysOfWeek Int @default(127), translations Json /* title, text */, version Int @default(1), createdAt, menu @relation(onDelete: Cascade) @@index([menuId, slot]) }`, and `Bundle.people Int?`. Add the back-relations on `Promotion` and `Bundle`.

- [ ] **Step 1:** Add the models above, matching the doc-comment style of `Promotion`.
- [ ] **Step 2:** Generate the migration, open the SQL and confirm it only adds (no drops), then `npx prisma generate`.
- [ ] **Step 3: Verify** `npm run typecheck` passes and `npx prisma migrate status` reports the migration applied to the worktree DB.
- [ ] **Step 4: Commit** `feat(showcase): occasion and showcase card tables, bundle people`.

### Task 3: Load into the catalog and the guest MenuView

**Files:**
- Modify: `src/server/data/catalog-loader.ts` (load `occasion`, `showcaseCard`; map to `CatalogOccasion`/`CatalogShowcaseCard`; add `people` to the `Bundle` mapping and to `Bundle` in `src/server/domain/types.ts`)
- Modify: `src/server/data/menu-view.ts` (add `showcase` to `MenuView`; build it in `buildMenuView`)
- Test: `tests/data/menu-view-showcase.test.ts` (follow the existing `tests/data` style and `makeCatalog`)

**Interfaces:**
- Consumes: `liveShowcase` from Task 1, `liveOffers` (`offers.ts`), `resolveText` (already used in `menu-view.ts`).
- Produces:
  ```ts
  export interface ShowcaseCardView {
    id: string; kind: 'OFFER' | 'SET' | 'BUFFET';
    title: string; text: string; occasion: string | null; // the occasion's name, shown as a small label
    price: number | null; people: number | null;          // SET/BUFFET price (set price; buffet per person); people only for packages
    productId: string | null;  // OFFER: first dish of the offer to open, else null
    bundleId: string | null;   // SET
    perPerson: boolean;        // BUFFET
    when: { startMinute: number | null; endMinute: number | null; daysOfWeek: number } | null; // BUFFET
  }
  // MenuView: showcase: { aboveSearch: ShowcaseCardView[]; belowSearch: ShowcaseCardView[] }
  ```

- [ ] **Step 1: Write failing tests:** a catalog with one live offer card, one set card (shown), one set card whose items are hidden, one ended-occasion card, one buffet card → `buildMenuView(...).showcase.aboveSearch` has exactly the live ones, titles resolved in `ar` with fallback to the default locale when `ar` is missing, `people` carried from the bundle, set `price` is the bundle price.
- [ ] **Step 2: Run** `npx vitest run tests/data/menu-view-showcase.test.ts` — expect FAIL.
- [ ] **Step 3: Implement** loader mapping and `buildMenuView` using `liveShowcase`; compute `shownBundleIds` from the products visible now (same visibility `menu-view.ts` already applies for `offers`). Any other code that constructs a `MenuView` literal (search for `signatureProductId:` in tests/helpers) gets `showcase: { aboveSearch: [], belowSearch: [] }`.
- [ ] **Step 4: Run** `npm test -- tests/data tests/domain` and `npm run typecheck` — expect PASS.
- [ ] **Step 5: Commit** `feat(showcase): load cards and occasions into the guest menu view`.

### Task 4: Studio services, actions and query

**Files:**
- Modify: `src/server/studio/services/sales.ts` (add `occasionFields`, `showcaseCardFields`, `saveOccasion`, `deleteOccasion`, `saveShowcaseCard`, `deleteShowcaseCard`, `reorderShowcaseCards`; extend `SalesRules` and `salesRules()` with `occasions` and `showcase` arrays plus per-card `hiddenReason`)
- Modify: `src/server/studio/actions/sales.ts` and `src/app/studio/_actions/sales.ts` (wrap each, `permission: 'content.edit'`, no plan feature gate)
- Test: `tests/studio/showcase.test.ts` (copy the harness/setup style of `tests/studio/sales.test.ts` "offers" block)

**Interfaces:**
- Produces (all `(ctx: ActionContext, input) => Promise<...>` like `saveOffer`):
  - `saveOccasion(input: { occasionId?: string; version?: number; names: Names; startsOn: string; endsOn: string; isActive: boolean })` → `{ id, version }`. Invalid when a date is not a real date (`isDate` exists in this file), `endsOn < startsOn`, or the default-locale name is empty.
  - `deleteOccasion({ occasionId, version })`: removes the occasion and its cards.
  - `saveShowcaseCard(input: { cardId?: string; version?: number; slot; kind; occasionId: string | null; promotionId: string | null; bundleId: string | null; price: number | null; startMinute: number | null; endMinute: number | null; daysOfWeek: number; title: Names; text: Names; isActive: boolean })` → `{ id, version }`. Kind rules: OFFER needs `promotionId`; SET needs `bundleId`; BUFFET needs a default-locale title and `price >= 0`; the other reference fields must be null. Reject creating a 9th active card in a slot? No: allow, guests see the first 8; the Studio warns.
  - `deleteShowcaseCard({ cardId, version })`, `reorderShowcaseCards({ slot, order: string[] })` (must name each card of that slot once; moves no version, like `reorderOffers`).
  - `SalesRules.showcase[i].hiddenReason: null | 'OFFER_OFF' | 'OFFER_ENDED' | 'SET_OFF' | 'SET_UNAVAILABLE' | 'OCCASION_OFF' | 'OCCASION_ENDED' | 'OCCASION_UPCOMING'`.
- Package-for-N: `setFields`/`saveSet` get optional `people: z.number().int().min(2).max(12).nullable()`; `SalesRules.sets[i].people` is returned. (UI in Task 5.)

- [ ] **Step 1: Write failing tests:** create/edit/version-conflict/delete for occasion and card; backwards dates rejected; OFFER card without promotion rejected; reorder with a missing id rejected; deleting a Promotion or Bundle removes its cards; `salesRules()` gives `hiddenReason` `OCCASION_ENDED` for an ended occasion, `OFFER_OFF` for a card on an inactive offer; `saveSet` stores `people` 4 and rejects 1 and 13; a viewer without `content.edit` is refused (copy the permission test used for offers).
- [ ] **Step 2: Run** `npx vitest run tests/studio/showcase.test.ts` — expect FAIL.
- [ ] **Step 3: Implement** services mirroring `saveOffer` (`editDraft`, `updateWithVersion`, `deleteWithVersion`, `ctx.audit` with actions `occasion.created/updated/deleted`, `showcase.created/updated/deleted`), the actions with `defineAction`, and the `salesRules` extension (reuse `ended`-style logic via `isOccasionLive` pieces from Task 1).
- [ ] **Step 4: Run** `npx vitest run tests/studio` and `npm run typecheck` — expect PASS.
- [ ] **Step 5: Commit** `feat(showcase): studio actions for occasions and showcase cards`.

### Task 5: Package-for-N field in the Sets editor

**Files:**
- Modify: `src/studio/workspace/sales/SetsEditor.tsx`
- Modify: `src/studio/messages/en.ts`, `ar.ts`, `ckb.ts` (labels for "For how many people", empty = ordinary set)
- Test: extend the existing Sets editor DOM test if one exists under `tests/studio` (search `SetsEditor`); otherwise add `tests/studio/sets-people.test.tsx` rendering the editor with one set.

**Interfaces:** Consumes `SalesRules.sets[i].people` and `saveSet({ ..., people })` from Task 4.

- [ ] **Step 1: Failing test:** the editor shows a "people" number field; entering `4` submits `people: 4`; leaving it empty submits `null`; the set row shows "For 4" when set.
- [ ] **Step 2: Run** the test — expect FAIL.
- [ ] **Step 3: Implement** the field using the editor's existing `Field`/`Input` pattern and its draft state; show the number in the row summary.
- [ ] **Step 4: Run** `npx vitest run tests/studio` — expect PASS.
- [ ] **Step 5: Commit** `feat(showcase): sets can be packages for N people`.

### Task 6: Guest carousel

**Files:**
- Create: `src/ui/template/ShowcaseCarousel.tsx`, `src/ui/template/showcase.css` (imported from `skins.css` or `TemplateMenu.tsx` the way `coverflow.css` is)
- Modify: `src/ui/template/TemplateMenu.tsx` (render `<ShowcaseCarousel slot="aboveSearch" />` immediately before `<div className="tpl-tools ...">` and `slot="belowSearch"` inside `tpl-tools` after the `FilterBar`, or right after the `tpl-tools` div if that keeps spacing simpler; both only when `query.trim() === ''`)
- Modify: guest message files (where `offers.label` lives) with `showcase.*` keys: region label, "per person", "for {count} people", "add", "added", and the buffet "days/hours" line formatting (reuse the existing offer-end/hours formatter if `useOfferEnd` exposes one)
- Test: `tests/ui/showcase-carousel.test.tsx` (follow `tests/ui/signature-strip.test.ts` / existing DOM tests)

**Interfaces:**
- Consumes: `view.showcase` (Task 3), `useApp()` `{ t, addLine, announce, cart, setBundleQuantity, preview }`, `openProduct` from `TemplateContext`.
- Produces: `export function ShowcaseCarousel({ slot }: { slot: 'aboveSearch' | 'belowSearch' }): JSX.Element | null`. Behaviour: `<section aria-label={t('showcase.label')}>` with a `<ul>` scroll-snap strip (`overflow-x: auto; scroll-snap-type: x mandatory; scrollbar hidden`; each card `scroll-snap-align: start`, fixed `inline-size` about 80% of the container on phones, capped at 20rem), card text wraps with `overflow-wrap: anywhere`; OFFER tap calls `openProduct(card.productId)`; SET shows name, `money(price)`, "for N people" when `people`, and an add button calling `setBundleQuantity(bundleId, current + 1)` then `announce(t('cart.added', { name }))`, hidden when the menu cannot order (`canOrder` false or `preview`) — the card still shows; BUFFET shows `money(price)` + "per person" + its days/hours, no button. The occasion label (small kicker) shows when `card.occasion`.

- [ ] **Step 1: Failing tests:** renders nothing for an empty slot; renders cards in order; long unbroken title does not set a width wider than the card (`overflow-wrap` class/style present); RTL: container dir follows the locale; clicking add twice calls `setBundleQuantity` with quantity 1 then 2 (mock `useApp` cart); buffet card has no button; OFFER tap calls `openProduct`.
- [ ] **Step 2: Run** `npx vitest run tests/ui/showcase-carousel.test.tsx` — expect FAIL.
- [ ] **Step 3: Implement** the component and CSS using the template's tokens (`--gutter`, `--muted`, `tpl-display`, `tpl-name`, `tpl-badge`, as `OfferList` does); then insert it in `TemplateMenu.tsx`. Use the `impeccable` skill for the card visual pass; no motion at all.
- [ ] **Step 4: Run** `npm test -- tests/ui` and `npm run lint` (on `src`, not `.`) — expect PASS.
- [ ] **Step 5: Commit** `feat(showcase): guest carousels above and below the search`.

### Task 7: Studio Showcase page

**Files:**
- Modify: `src/studio/workspace/sales/pages.ts` (add `{ key: 'showcase', path: '/showcase', labelKey: 'sales.page.showcase' }` after `offers`)
- Create: `src/app/studio/(studio)/(app)/menus/[id]/sales/showcase/page.tsx` (copy `offers/page.tsx`)
- Create: `src/studio/workspace/sales/ShowcaseEditor.tsx`
- Modify: `src/studio/messages/en.ts`, `ar.ts`, `ckb.ts` (`sales.page.showcase`, occasion and card labels, the six `hiddenReason` texts, "only the first 8 are shown")
- Test: `tests/studio/showcase-editor.test.tsx`

**Interfaces:** Consumes `SalesRules.occasions`, `SalesRules.showcase`, `saveOccasion`/`deleteOccasion`/`saveShowcaseCard`/`deleteShowcaseCard`/`reorderShowcaseCards` from `@/app/studio/_actions/sales`. Produces `export function ShowcaseEditor({ menuId, rules }: { menuId: string; rules: SalesRules }): JSX.Element`.

Page layout: an **Occasions** list (add/edit dialog with name per locale, two date inputs, switch; shows "upcoming / live / ended" with `StatusBadge`), then two sections **Above search** and **Below search**, each an ordered list of cards with up/down reorder, switch, edit, delete (ConfirmDialog), and a `StatusBadge` with the `hiddenReason` when not showing. "Add card" opens a dialog: pick the kind (special offer, set or package, open buffet), the slot, the optional occasion; OFFER/SET pick from existing offers/sets (a Select); BUFFET asks title/text per locale, price per person, days and time window (reuse the controls `OffersEditor` uses for `daysOfWeek` and times). Follow `OffersEditor.tsx` for `useSave`, `Dialog`, `Field`, `RuleRow`, `Locked` and reorder buttons.

- [ ] **Step 1: Failing tests:** page lists existing cards in slot order; an ended-occasion card shows the "occasion ended" badge; adding a buffet card submits `saveShowcaseCard` with `kind: 'BUFFET'` and the typed price; reorder button calls `reorderShowcaseCards` with the new order; a backwards-date occasion shows the server's validation message.
- [ ] **Step 2: Run** `npx vitest run tests/studio/showcase-editor.test.tsx` — expect FAIL.
- [ ] **Step 3: Implement** the page, editor and messages (all three locales; Arabic/Kurdish read right-to-left like the other editors).
- [ ] **Step 4: Run** `npm test` (full), `npm run typecheck`, `npm run lint` — expect PASS.
- [ ] **Step 5: Commit** `feat(showcase): Studio showcase page`.

### Task 8: End-to-end check and review

**Files:** none new (fixes go where the bug is).

- [ ] **Step 1:** Start the dev server with `preview_start` in the worktree; in the Studio create an occasion (today to tomorrow), a buffet card above search, a package (set with `people: 4`) below search, and a special-offer card.
- [ ] **Step 2:** In the in-app browser at 390px (Arabic `/ar`), load the menu on a Coverflow template (Saj) and on the Book template: both carousels appear in the right order, strip scrolls sideways only, page has no horizontal scroll (`document.documentElement.scrollWidth <= innerWidth`), tapping the package's add button raises the cart count, buffet card has no button, an ended occasion's card disappears after editing its end date to yesterday and reloading. Screenshot each.
- [ ] **Step 3:** Run `superpowers:verification-before-completion` (`npm test`, `npm run typecheck`, `npm run lint`) and then `code-review` on the branch diff; fix findings.
- [ ] **Step 4:** Open the PR via the browser compare URL (no `gh`; see memory `pr-without-gh`).
