# Sales Tools Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Owners run the researched sales techniques from one Studio tab, and the guest menu shows them truthfully.

**Architecture:** New fields and a `Promotion` model ride the existing draft → snapshot → live catalog path. Pure engine
modules (`offers`, `meal`, `engineering`, `advisor`) sit beside the current revenue engine; one `priceOf` makes every
shown and charged price agree. The Studio gets a Sales tab built from the existing service/action/query/component
pattern; the guest UI reads new optional fields on the menu view.

**Tech Stack:** Next.js 16, React 19, Prisma 7 on PostgreSQL, Zod 4, Vitest, Tailwind 4.

**Spec:** `docs/superpowers/specs/2026-10-18-sales-tools-design.md`

## Global Constraints

- Every Studio string in `src/studio/messages/{en,ar,ckb}.ts`; every guest string in `src/lib/messages/{en,ar,ckb}.ts`.
- Every audited action name in `AUDIT_ACTIONS` (`src/server/domain/audit-actions.ts`) with `activity.action.<name>` in all three Studio catalogs.
- New snapshot fields are omitted when unset (null, false, empty, default); `SNAPSHOT_SCHEMA_VERSION` stays 1.
- Draft edits go through `editDraft`; edited rows save with `updateWithVersion` / `deleteWithVersion`.
- Prices are integer minor units; a discounted price is `salePrice(regular, percent, roundTo)`: rounded to `roundTo`, at most `regular`, at least 0.
- Percent off 5 to 90; serves 2 to 20; set lines 2 to 8; upgrades and pairings shown 1 to 5; upgrade cap 25% to 200%.
- Most ordered: top 3, last 14 days, at least 5 distinct sessions each, cached 1 hour per menu.
- Matrix: last 30 days; popular at `share ≥ 0.7 / dishes`; profitable at `margin ≥ popularity-weighted mean margin`.
- Advisor: category too long above 10 dishes; vegetarian section = at least 3 dishes, all `vegetarian` or `vegan`.
- No modals; no pre-selected paid options; no invented prices, counts or timers.
- Lint `src`, not `.` (memory: browser-verification-quirks). Check `git diff --stat` for whole-file CRLF churn before each commit.

## Review Focus

1. A menu published before this change keeps `draftHash === liveHash` after a no-op edit cycle: tested in Task 2.
2. An offer window that wraps midnight (22:00 to 02:00) is live at 01:00 the next day and on the right weekday: Task 3.
3. A discounted product inside a set: the set compares against sale prices and disappears when no longer a deal: Task 3.
4. Deleting a product or category named by an offer, and duplicating a menu with offers: ids removed / remapped, Task 2 and Task 10.
5. An owner without `content.prices` cannot change a cost or a set price: Task 7 and Task 10.

---

### Task 1: Schema and migration

**Files:**
- Modify: `prisma/schema.prisma`, `src/server/data/tenant-db.ts` (`MENU_SCOPED_MODELS` gets `'Promotion'`)
- Create: `prisma/migrations/20261018120000_sales_tools/migration.sql` (generated)
- Test: `tests/data/tenant-registry.test.ts` (existing; must pass with the new model)

**Interfaces:**
- Produces: Prisma fields `UpsellRule.version`, `PairingRule.version`, `Bundle.version` (`Int @default(1)`), `Product.serves Int?`, `Category.completesMeal Boolean @default(false)`, `enum PromotionKind { SPECIAL DISCOUNT }`, model `Promotion` exactly as spec 6.1 plus `createdAt`, `@@index([menuId])`, relation `Menu.promotions`.

- [ ] Step 1: Edit the schema; run `npx prisma migrate dev --name sales_tools --create-only` with the dev DB up (`npm run db:start`), then `npx prisma migrate dev`.
- [ ] Step 2: Run `npx vitest run tests/data/tenant-registry.test.ts` — expected FAIL until `Promotion` is registered, then PASS after adding it.
- [ ] Step 3: Commit `feat(sales): schema for rule versions, serves, meal categories and offers`.

### Task 2: Catalog, snapshot and draft round trip

**Files:**
- Modify: `src/server/domain/types.ts`, `src/server/domain/config.ts`, `src/server/domain/snapshot.ts`, `src/server/data/catalog-loader.ts`, `src/server/publish/draft.ts`, `src/server/studio/services/menus.ts` (duplicate, if it copies rows itself)
- Test: `tests/domain/snapshot.test.ts`, `tests/data/loader.test.ts`, `tests/publish/*.test.ts` (add cases)

**Interfaces:**
- Produces in `types.ts`:
  - `CatalogProduct.serves: number | null`; `CatalogCategory.completesMeal: boolean`
  - `interface CatalogPromotion { id; kind: 'SPECIAL' | 'DISCOUNT'; percentOff: number | null; productIds: string[]; categoryIds: string[]; startsOn: string | null; endsOn: string | null; startMinute: number | null; endMinute: number | null; daysOfWeek: number; roundTo: number; translations: TranslationMap; sortOrder: number }`
  - `Catalog.promotions: CatalogPromotion[]`
- Produces in `config.ts`: `interface SalesSettings { priceStyle: 'symbol' | 'plain'; showMostOrdered: boolean; showLowStock: boolean }`, `DEFAULT_SALES_SETTINGS`, `EngineConfig.sales?: SalesSettings` (kept only when the stored JSON has it), `salesSettings(config: EngineConfig): SalesSettings`.
- Snapshot: product `serves` omitted when null, category `completesMeal` omitted when false, `catalog.promotions` omitted when empty, `menu.engineConfig.sales` omitted when absent; the parser defaults them back. `toCatalog` drops hidden product ids from promotions and drops a promotion left with no ids.
- Loader: `roundTo = menuPriceStep(menu)` from `bulk-prices.ts`; promotions `isActive` only, by `sortOrder`, then `id`.
- `writeDraftFromSnapshot` remaps promotion `productIds`/`categoryIds` (unresolvable ids dropped); `restoreDraftFromSnapshot` restores promotions with their snapshot ids and moves versions on (rules, sets and promotions included in the `versions` map).

- [ ] Step 1: Failing tests:
  - `snapshot: a catalog without the new fields hashes as before` — build a snapshot from the existing fixture, assert `snapshotHash` equals a hash computed from the same input with `serves: null`, `completesMeal: false`, `promotions: []`, no `sales`.
  - `snapshot: promotions, serves and completesMeal survive buildSnapshot → parseSnapshot`.
  - `toCatalog: a hidden product leaves every promotion, and an emptied promotion goes`.
  - `loader: reads promotions with the menu's price step as roundTo` (USD → 5).
  - `draft: duplicating a menu remaps a promotion's product and category ids`; `restore: a promotion comes back with its id and a higher version`.
- [ ] Step 2: Run `npx vitest run tests/domain/snapshot.test.ts tests/data/loader.test.ts tests/publish` — FAIL.
- [ ] Step 3: Implement the interfaces above.
- [ ] Step 4: Same command — PASS; then `npm run typecheck` (fixtures in `tests/domain/fixtures.ts` gain `serves: null`, `completesMeal: false`, `promotions: []`).
- [ ] Step 5: Commit `feat(sales): offers, serves and meal categories in the catalog and snapshot`.

### Task 3: Offers and one price for everything

**Files:**
- Create: `src/server/domain/offers.ts`
- Modify: `src/server/domain/catalog.ts`, `pricing.ts`, `upsell.ts`, `bundles.ts`, `index.ts`
- Test: `tests/domain/offers.test.ts`; add cases to `pricing.test.ts`, `upsell.test.ts`, `bundles.test.ts`

**Interfaces:**
- Produces in `offers.ts`:
  - `isOfferLive(offer: CatalogPromotion, now: Date, timeZone: string): boolean` — local date within `[startsOn, endsOn]` (either may be null), weekday bit set, and within `[startMinute, endMinute)` when both are set; a window with `end <= start` wraps past midnight and its after-midnight part counts toward the previous day's weekday and date.
  - `liveOffers(catalog: Catalog, now: Date): CatalogPromotion[]` (in `sortOrder`)
  - `discountFor(product: CatalogProduct, live: CatalogPromotion[]): { percent: number; roundTo: number } | null` — the largest DISCOUNT naming the product or its category.
  - `salePrice(regular: number, percent: number, roundTo: number): number` — `Math.min(regular, Math.max(0, Math.round(regular * (100 - percent) / 100 / roundTo) * roundTo))`.
  - `specialFor(product, live): CatalogPromotion | null` — the first SPECIAL naming it.
- Produces in `catalog.ts`: `priceOf(product: CatalogProduct, variantId: string | null, optionIds: readonly string[], live: CatalogPromotion[]): { price: number; regular: number; cost: number | null }`.
- `quoteCart`, `suggestUpsells` (current and candidate totals both via `priceOf`; `priceDelta` = difference), `compareBundle`/`detectBundleOpportunities`/`quoteBundle` (individual totals via `priceOf`) all take live offers computed once from `now`.

- [ ] Step 1: Failing tests (times from `at()` in fixtures, Asia/Baghdad):
  - `offers: a happy hour 17:00–19:00 is live at 18:00 and not at 19:00`
  - `offers: 22:00–02:00 on Thursday only is live Friday 01:00 and not Thursday 01:00`
  - `offers: dates are inclusive in the menu's time zone`
  - `offers: the larger of two discounts wins; a category discount reaches its dishes`
  - `salePrice: 20% of 1250 at step 250 is 1000; 15% of 300 at step 5 is 255; never above regular`
  - `pricing: a quote during a 20% offer charges 800 for a 1000 dish and 1000 after it ends`
  - `upsell: during a discount the size upgrade delta is the difference of sale prices`
  - `bundles: a set stops being offered when discounted items make it no longer cheaper`
- [ ] Step 2: `npx vitest run tests/domain` — FAIL.
- [ ] Step 3: Implement.
- [ ] Step 4: `npx vitest run tests/domain` — PASS (existing tests unchanged: no offers means `priceOf` equals `unitPrice`).
- [ ] Step 5: Commit `feat(sales): timed offers and discounts priced by the server`.

### Task 4: Complete your meal

**Files:**
- Create: `src/server/domain/meal.ts`
- Modify: `src/server/domain/suggestions.ts`, `src/server/data/suggestion-view.ts`
- Test: `tests/domain/meal.test.ts`, `tests/domain/suggestions.test.ts`

**Interfaces:**
- Produces: `interface MealOffer { suggestionId: string; productId: string; categoryId: string }`; `suggestMealCompletions(catalog: Catalog, cart: CartInput, dismissedIds: readonly string[], now: Date, config: EngineConfig): MealOffer[]`; `SuggestionsResponse.meal: MealOffer[]` (filled in cart context only); `SuggestionsView.meal` with the same name/price fields `PairingView` carries.

- [ ] Step 1: Failing tests: `meal: suggests the best drink when the cart has food and no drink`; `meal: nothing when the cart is empty`; `meal: nothing for a category already in the cart, counting set items`; `meal: skips a dismissed meal:<id>, unorderable or out-of-daypart dish`; `meal: at most 2 offers, one per category, never a product a pairing already offers`.
- [ ] Step 2: `npx vitest run tests/domain/meal.test.ts tests/domain/suggestions.test.ts` — FAIL.
- [ ] Step 3: Implement; the best dish is the highest `scoreProducts` result in the category.
- [ ] Step 4: Same command — PASS.
- [ ] Step 5: Commit `feat(sales): complete-your-meal suggestions in the cart`.

### Task 5: Menu engineering and advisor (pure)

**Files:**
- Create: `src/server/domain/engineering.ts`, `src/server/domain/advisor.ts`
- Test: `tests/domain/engineering.test.ts`, `tests/domain/advisor.test.ts`

**Interfaces:**
- Produces in `engineering.ts`: `type DishClass = 'STAR' | 'PLOWHORSE' | 'PUZZLE' | 'DOG' | 'NEEDS_COST'`; `interface DishPerformance { productId: string; sessions: number; price: number; cost: number | null; margin: number | null; dishClass: DishClass }`; `classifyDishes(rows: Array<{ productId: string; price: number; cost: number | null; sessions: number }>): DishPerformance[]` (sorted by class order above, then sessions descending).
- Produces in `advisor.ts`: `type AdviceCode = 'NO_PHOTO' | 'NO_DESCRIPTION' | 'NO_COST' | 'LONG_CATEGORY' | 'VEGETARIAN_SECTION' | 'TWO_SIZES' | 'NO_RULES' | 'SET_NOT_A_DEAL' | 'NO_SIGNATURE'`; `interface Advice { code: AdviceCode; productIds: string[]; categoryIds: string[]; bundleIds: string[] }`; `adviseMenu(catalog: Catalog, locales: Locale[]): Advice[]` (one entry per code that applies, codes in the order above).

- [ ] Step 1: Failing tests: `engineering: 4 dishes split into one of each class` (sessions 40/40/5/5, margins high/low/high/low); `engineering: a dish without cost is NEEDS_COST and does not move the average`; `engineering: with zero sessions nobody is popular, so costed dishes are PUZZLE or DOG by margin`; `advisor: flags a product missing an Arabic description when the menu has ar`; `advisor: 11 dishes is LONG_CATEGORY, 10 is not`; `advisor: 3 vegan dishes alone in a category is VEGETARIAN_SECTION`; `advisor: a product with exactly 2 sizes is TWO_SIZES`; `advisor: no upgrade or pairing rule is NO_RULES`; `advisor: a set priced at its items' total is SET_NOT_A_DEAL`; `advisor: no isSignature/isFeatured dish is NO_SIGNATURE`.
- [ ] Step 2: `npx vitest run tests/domain/engineering.test.ts tests/domain/advisor.test.ts` — FAIL.
- [ ] Step 3: Implement.
- [ ] Step 4: Same command — PASS.
- [ ] Step 5: Commit `feat(sales): menu engineering classes and the advisor checklist`.

### Task 6: Upgrade and pairing rules in the Studio (server)

**Files:**
- Create: `src/server/studio/services/sales.ts`, `src/server/studio/actions/sales.ts`, `src/server/studio/queries/sales.ts`, `src/app/studio/_actions/sales.ts`
- Modify: `src/server/domain/audit-actions.ts`, Studio message catalogs (activity labels)
- Test: `tests/studio/sales.test.ts`

**Interfaces:**
- Actions (all `permission: 'content.edit'`, target the menu, through `editDraft`, audited):
  - `sales.saveUpgrade` input `{ menuId, ruleId?, version?, sourceProductId, targetProductId, pitch: Texts, effect: Texts, priority: 50|75|100, dayparts: Daypart[], isActive }` → `{ id, version }`; audit `upgrade.created` / `upgrade.updated`.
  - `sales.deleteUpgrade` `{ menuId, ruleId, version }`; audit `upgrade.deleted`.
  - `sales.savePairing` `{ menuId, ruleId?, version?, source: { kind: 'PRODUCT'|'CATEGORY', id }, targetProductId, reason: Texts, weight: 50|75|100, dayparts, isActive }`; audit `pairing.created` / `pairing.updated`; `sales.deletePairing`, audit `pairing.deleted`.
- Query `sales.rules` (`content.edit`) → `{ locales, defaultLocale, currency, products: Array<{ id; names; categoryId; price }>, categories: Array<{ id; names }>, upgrades: Array<{ id; version; sourceProductId; targetProductId; pitch: Names; effect: Names; priority; dayparts; isActive }>, pairings: Array<{ id; version; sourceType; sourceId; targetProductId; reason: Names; weight; dayparts; isActive }> }`.
- Refusals (`StudioError('INVALID', …, fields)`): source equals target; a product or category of another menu (`NOT_FOUND`); a duplicate active rule with the same source and target.

- [ ] Step 1: Failing tests: create, edit at the read version, conflict at an old version (`CONFLICT`), delete, refuse source = target, refuse another menu's product, draft hash changes and the published snapshot carries the rule, audit rows written, a designer without the menu sees `NOT_FOUND`.
- [ ] Step 2: `npx vitest run tests/studio/sales.test.ts` — FAIL.
- [ ] Step 3: Implement; `Texts` and `namesField` from `services/content.ts`; translations stored as `{ en: { pitch, effect } }`.
- [ ] Step 4: Same command plus `npx vitest run tests/studio/messages.test.ts tests/studio/activity.test.ts` — PASS.
- [ ] Step 5: Commit `feat(studio): owners edit upgrade and pairing rules`.

### Task 7: Sets in the Studio (server)

**Files:** Modify the Task 6 files; Test: `tests/studio/sales.test.ts`

**Interfaces:**
- `sales.saveSet` (`content.edit`; also `content.prices` for a new set or a changed price) input `{ menuId, bundleId?, version?, slug, names: Texts, descriptions: Texts, price, items: Array<{ productId; variantId: string | null; quantity: 1..10 }> (2..8), dayparts, isActive }` → `{ id, version }`; audit `set.created` / `set.updated`. `sales.deleteSet`, audit `set.deleted`.
- Query `sales.rules` gains `sets: Array<{ id; version; slug; names; descriptions; price; items; dayparts; isActive; itemsTotal: number }>` and each product's `variants: Array<{ id; names; priceDelta }>`.
- Refusals: price not below the items' total at regular prices (`fields.price`, message names the total); a variant not of its product; duplicate slug.

- [ ] Step 1: Failing tests: create with 2 items, refuse 1 item, refuse price ≥ total, refuse a foreign variant, owner with `content.prices` removed by policy cannot change the price but can rename, delete.
- [ ] Step 2–4: run, implement, pass (`npx vitest run tests/studio/sales.test.ts`).
- [ ] Step 5: Commit `feat(studio): owners build sets with a live saving`.

### Task 8: Offers in the Studio (server)

**Files:** Modify the Task 6 files; Test: `tests/studio/sales.test.ts`

**Interfaces:**
- `sales.saveOffer` (`content.edit`; DISCOUNT also needs `content.prices`) input `{ menuId, offerId?, version?, kind, percentOff: number | null, productIds, categoryIds, startsOn, endsOn, startMinute, endMinute, daysOfWeek: 1..127, title: Texts, text: Texts, isActive }`; audit `offer.created` / `offer.updated`. `sales.deleteOffer` (audit `offer.deleted`), `sales.reorderOffers` `{ menuId, ids: string[] }` (audit `offer.reordered`).
- Query `sales.rules` gains `offers: Array<…same fields…, version, sortOrder>`.
- Refusals: no product and no category; DISCOUNT without 5..90 percent; SPECIAL with a percent; `endsOn` before `startsOn`; only one of `startMinute`/`endMinute`; a title missing in the default language.

- [ ] Step 1: Failing tests for each refusal, create/edit/delete/reorder, and that publishing puts the offer in the live catalog.
- [ ] Step 2–4: run, implement, pass.
- [ ] Step 5: Commit `feat(studio): owners schedule specials and happy hours`.

### Task 9: Sales settings (server)

**Files:** Modify the Task 6 files; Test: `tests/studio/sales.test.ts`

**Interfaces:**
- `sales.saveSettings` (`content.edit`) input `{ menuId, version (Menu.version), priceStyle, showMostOrdered, showLowStock, upsellMaxOffers: 1..5, pairingMaxOffers: 1..5, upsellDeltaCapRatio: 0.25..2, mealCategoryIds: string[] }`; writes `Menu.engineConfig` (keeping keys it does not own) and `Category.completesMeal`; audit `menu.sales_settings_changed`.
- Query `sales.settings` → the same fields resolved, plus `categories: Array<{ id; names; completesMeal }>` and `version`.

- [ ] Step 1: Failing tests: defaults read back when nothing is stored; saving keeps existing `weights`; meal categories set and cleared; a stale menu version is `CONFLICT`.
- [ ] Step 2–4: run, implement, pass.
- [ ] Step 5: Commit `feat(studio): sales settings per menu`.

### Task 10: Product drawer and Availability fields

**Files:**
- Modify: `src/server/studio/services/content.ts` (`productSaveFields` + load + save + delete), `src/studio/workspace/content/ProductDrawer.tsx`, `src/server/studio/services/availability.ts`, `src/server/studio/actions/availability.ts`, `src/app/studio/_actions/availability.ts`, `src/studio/workspace/AvailabilityBoard.tsx`, Studio message catalogs
- Test: `tests/studio/content.test.ts`, `tests/studio/availability.test.ts`

**Interfaces:**
- `productSaveFields` gains `cost: priceField.nullable()` (a change needs `content.prices`, like price), `priority: 50 | 75 | 100`, `serves: 2..20 | null`, `lowStockThreshold: 1..999 | null`. `ProductEditing` returns them.
- Deleting a product or category removes its id from every promotion of the menu (and deletes a promotion left empty).
- `availability.setStock` (`content.availability`, live, audited `product.stock_changed`) `{ menuId, productId, stockCount: 0..9999 | null }`; board rows carry `stockCount` and `lowStockThreshold`.

- [ ] Step 1: Failing tests: cost saved and refused without `content.prices`; serves and priority saved; delete strips offer ids; setStock writes the live value without changing `draftHash`.
- [ ] Step 2–4: run (`npx vitest run tests/studio/content.test.ts tests/studio/availability.test.ts`), implement, pass.
- [ ] Step 5: Commit `feat(studio): cost, promotion level, serves and portions left`.

### Task 11: The Sales tab (Studio UI)

**Files:**
- Modify: `src/studio/workspace/tabs.ts` (`'sales'`, path `/sales`, needs `['content.edit']`, after `availability`), Studio message catalogs
- Create: `src/app/studio/(studio)/(app)/menus/[id]/sales/{layout,page}.tsx`, `.../sales/{upgrades,pairings,sets,offers,settings}/page.tsx`, `src/studio/workspace/sales/{RulesEditor,UpgradeForm,PairingForm,SetForm,OfferForm,SalesSettingsForm,SalesOverview}.tsx`
- Test: `tests/studio/workspace-tabs.test.ts` (tab list), `tests/studio/messages.test.ts` (catalog parity)

**Interfaces:**
- Consumes the Task 6–9 server actions via `src/app/studio/_actions/sales.ts` and queries via `query(...)` in pages.
- Second-level navigation with the existing `RouteTabs`. Forms use `Field`, `Input`, `Select`, `Switch`, `Picker`, `Dialog`, `ConfirmDialog`, `TranslationFields`; failures through `describeFailure`; success toasts as elsewhere.

- [ ] Step 1: Failing tests: `visibleTabs` lists `sales` for an owner and hides it without `content.edit`; message parity passes for every new key.
- [ ] Step 2–4: run, implement pages, pass.
- [ ] Step 5: Browser check of each page at desktop and 375 px in English and Arabic (RTL), against the dev server and seeded ATELIER.
- [ ] Step 6: Commit `feat(studio): the Sales tab`.

### Task 12: Insights (server + Overview page)

**Files:**
- Create: `src/server/studio/services/insights.ts`
- Modify: `src/server/studio/queries/sales.ts`, `src/studio/workspace/sales/SalesOverview.tsx`
- Test: `tests/studio/insights.test.ts`

**Interfaces:**
- Query `sales.overview` (`content.edit`) → `{ since: string; totalSessions: number; dishes: Array<DishPerformance & { names: Names }>; suggestions: Array<{ kind: 'upgrade'|'pairing'|'set'|'meal'; shown: number; accepted: number }>; advice: Advice[] }`. Sessions: distinct `anonymousSessionId` per product over `ADD_TO_CART` and `PAIRING_ADD` in 30 days. Suggestion kinds by `suggestionId` prefix: `up:`, `pair:`, `bundle:`, `meal:`; shown = distinct sessions with an impression, accepted = distinct sessions with an accept/add.
- `advice` from `adviseMenu(loadDraftCatalog(...), menu.locales)`.

- [ ] Step 1: Failing tests with seeded events: classes come out as in Task 5; events older than 30 days ignored; another menu's events ignored; suggestion counts by prefix.
- [ ] Step 2–4: run, implement, pass.
- [ ] Step 5: Commit `feat(studio): sales insights and the advisor`.

### Task 13: Guest view model

**Files:**
- Create: `src/server/data/most-ordered.ts`
- Modify: `src/server/data/menu-view.ts`, `src/server/route-context.ts`, `src/lib/menu-price.ts`, `src/server/domain/money.ts`
- Test: `tests/data/menu-view.test.ts`, `tests/data/most-ordered.test.ts`, `tests/domain/money.test.ts`

**Interfaces:**
- `loadMostOrdered(prisma, menuId, now): Promise<string[]>` (cached 1 hour, tag `menu:<id>:most-ordered`) per the Global Constraints.
- `buildMenuView(catalog, tenant, locale, now, extras?: { mostOrdered?: string[] })`; `MenuView` gains `priceStyle`, `offers: Array<{ id; kind; title; text; percentOff: number | null; endsAt: { time?: string; weekday?: number; date?: string } | null }>` (ends within 7 days only); `MenuProductView` gains optional `regularPrice` (only while discounted), `percentOff`, `roundTo`, `special: string` (offer title), `mostOrdered: true`, `fewLeft: number`, `serves: number` — each omitted when not applicable. `displayPrice` is the sale price.
- `unitPriceFromMenu` applies `percentOff`/`roundTo` with `salePrice`.
- `formatMoney(..., { symbol: false })` option formats the number with the currency's digits and no symbol.

- [ ] Step 1: Failing tests: discounted dish has `displayPrice` 800 and `regularPrice` 1000; no `regularPrice` without an offer; `mostOrdered` only for listed ids and only when the setting is on; `fewLeft` only when stock ≤ threshold and > 0 and the setting is on; `offers` lists only live ones; `loadMostOrdered` threshold and window; `formatMoney` plain gives `12.50` and `12,500` for IQD.
- [ ] Step 2–4: run, implement, pass.
- [ ] Step 5: Commit `feat(menu): offers, most ordered, few left and serves in the menu view`.

### Task 14: Guest UI

**Files:**
- Modify: `src/ui/menu/ProductRow.tsx`, `src/ui/menu/SignatureFeature.tsx`, `src/ui/menu/MenuApp.tsx`, `src/ui/product/ProductDetail.tsx`, `src/ui/cart/CartView.tsx`, `src/ui/AppProviders.tsx` (a `price` formatter honouring `priceStyle` next to `money`), `src/lib/messages/{en,ar,ckb}.ts`
- Create: `src/ui/menu/OfferStrip.tsx`, `src/ui/cart/MealSuggestions.tsx`
- Test: `tests/e2e/sales.spec.ts`

**Interfaces:**
- Consumes Task 13 view fields and Task 4 `SuggestionsView.meal`.
- `MealSuggestions` tracks `PAIRING_IMPRESSION` once per suggestion and `PAIRING_ADD` on add; dismiss adds `meal:<id>` to the dismissed list like pairings.

- [ ] Step 1: Failing e2e: on seeded ATELIER with a live discount, the row shows the struck regular price and the sale price; the cart with a dish and no drink shows "Complete your meal" and adding it updates the server total.
- [ ] Step 2–4: run (`npx playwright test tests/e2e/sales.spec.ts`), implement, pass.
- [ ] Step 5: Browser check at 375 px, English and Arabic, light and dark; reduced motion.
- [ ] Step 6: Commit `feat(menu): guests see offers, most ordered, few left, serves and meal suggestions`.

### Task 15: Demo data and full verification

**Files:** Modify: `prisma/seed.ts` (ATELIER: costs on dishes, one happy hour, one special, drinks and desserts complete a meal, a sharing platter with `serves`)

- [ ] Step 1: `npm run db:seed`; open ATELIER in the browser and the Studio Sales tab.
- [ ] Step 2: `npm test`, `npm run typecheck`, `npx eslint src`, `npx playwright test` — all pass.
- [ ] Step 3: Commit `feat(seed): ATELIER shows every sales technique`.
