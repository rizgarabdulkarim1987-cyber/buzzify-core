# Sales Tools: the researched sales techniques, run by the owner

Status: written from the user's request ("add all sales techniques to the menu, editable by the owner"). The user
skipped the design questions and said to start, so every choice below not quoted from them is the builder's call.
Date: 2026-10-18
Branch: `sales-tools`, from `motion-studio`

## 1. Intent

A menu should sell, not only list. The research (summarised in section 8) found a set of techniques with real
evidence behind them, and the revenue engine of sub-project 1 already runs several of them (upgrades, Perfect Pairing,
sets, the signature dish, badges, dayparts). What is missing:

- the owner cannot edit most of it: upgrade rules, pairings and sets have no Studio screen, and a product's cost (what
  the engine needs to know a dish's margin) cannot be entered, so a new menu starts with no sales rules at all;
- several proven techniques are not built: real "most ordered" labels, honest "only a few left", prices without the
  currency symbol, timed offers and happy hours, "complete your meal", sharing dishes with a price per person;
- the owner has no way to see what sells and what to change.

Success: an owner opens one Sales tab, turns techniques on, writes rules in their three languages, publishes, and the
menu shows them; a week later the same tab tells them which dishes are stars, which suggestions guests accept, and what
to fix next.

## 2. Goals

1. A **Sales** tab in every menu's workspace, open to anyone with `content.edit` (owners and designers by default),
   with these pages: Overview (insights and advisor), Upgrades, Pairings, Sets, Offers, Settings.
2. Owners edit **upgrade rules**, **pairing rules** and **sets** (bundles) end to end: create, edit, switch off,
   delete, in English, Arabic and Sorani, with dayparts.
3. The product drawer gains **cost**, **promote this dish** (the engine's `priority`) and **serves** (people a dish is
   for). The Availability tab gains **portions left** (live stock).
4. New guest techniques, each switchable per menu:
   - **Most ordered**: a label on the menu's top dishes by real guest additions.
   - **Only a few left**: shown only from real stock at or below the owner's threshold.
   - **Plain prices**: the menu and product pages show prices without the currency symbol.
   - **Offers**: today's special or a limited-time dish (a highlight), or a percentage discount (happy hour), on chosen
     dishes or categories, in date ranges, daily time windows and days of the week.
   - **Complete your meal**: in the cart, a quiet row suggesting a dish from each category the owner marked as
     completing a meal (drinks, desserts) that the cart does not yet have.
   - **Sharing dishes**: "For 4 · 2.50 each" on dishes that serve more than one person.
5. **Insights**: the menu engineering matrix (Kasavana and Smith: stars, plowhorses, puzzles, dogs) from real guest
   additions and the owner's costs, with a plain next step for each class; and how often guests accept each kind of
   suggestion.
6. **Advisor**: a checklist built from the draft that names what to fix (no photo, no description, no cost, too many
   dishes in a category, a separate vegetarian section, two sizes where three sell better, no sales rules, a set that
   is not cheaper than its items, no signature dish), each linking to where it is fixed.

## 3. Non-goals

- Anything that needs real orders: loyalty, first-visit codes, "order again", "your table also ordered", spend
  thresholds with a free item. They wait for verified table ordering (sub-project 6), where a reward can be honoured.
- Weather-based suggestions: no weather source and no location per menu yet. Dayparts already cover time of day.
- AI-written descriptions (sub-project 5's AI work), A/B tests, push or SMS marketing.
- Fixed-price offers and "buy one get one". Percentage discounts cover happy hour; more kinds can follow.

## 4. Anti-goals

Failure even if it works:

- Anything a guest reads as a fact that is not true: an invented "was" price, "only 2 left" that is not, a countdown
  that resets, "most ordered" not drawn from real data. A struck-through price is only ever the dish's real regular
  price during a real discount.
- Paid extras chosen in advance for the guest (pre-ticked add-ons).
- A modal, a pop-up or anything else between a hungry guest and the menu. Suggestions stay quiet rows, as now.
- A slower menu: the menu page must still arrive in its first round trip (docs/perf). "Most ordered" is one cached
  query; everything else rides in the snapshot.

## 5. Constraints (from the codebase)

- Every draft edit goes through `editDraft` (hash stays current); guests see changes after a publish. Live fields
  (availability, hidden, stock) bypass publishing.
- Rows the person edits are saved at the version they read (`updateWithVersion`), so rules and sets get a `version`.
- Every audited action name is in `AUDIT_ACTIONS` with a label in all three Studio languages.
- Every Studio and guest string exists in `en`, `ar` and `ckb`.
- New snapshot fields are left out when unset, so menus published before this keep their hash and do not show
  "unpublished changes" for nothing. `SNAPSHOT_SCHEMA_VERSION` stays 1.
- The client never decides a price: discounts are applied by the server quote; the browser's live total mirrors the
  same rule for display only.
- Money is integer minor units. A discounted price rounds to the menu's price step (`menuPriceStep`), never above the
  regular price and never below zero.

## 6. Design

### 6.1 Data

One migration:

- `UpsellRule`, `PairingRule`, `Bundle`: `version Int @default(1)`.
- `Product.serves Int?` (2 to 20; null means one person).
- `Category.completesMeal Boolean @default(false)`.
- `enum PromotionKind { SPECIAL DISCOUNT }` and `model Promotion`: `menuId`, `kind`, `percentOff Int?` (DISCOUNT only,
  5 to 90), `productIds String[]`, `categoryIds String[]`, `startsOn String?` and `endsOn String?` (local dates,
  `YYYY-MM-DD`, inclusive), `startMinute Int?` and `endMinute Int?` (a daily window in the menu's time zone; may wrap
  past midnight), `daysOfWeek Int @default(127)` (bit 0 Sunday, as `DaypartSchedule`), `translations Json` (`title`,
  `text`), `isActive`, `sortOrder`, `version`.
- `Menu.engineConfig.sales` (optional JSON): `{ priceStyle: 'symbol' | 'plain', showMostOrdered: boolean,
  showLowStock: boolean }`, defaults `symbol`, `true`, `true`, resolved at read time and absent until set.

Promotions are part of the catalog and the snapshot (`catalog.promotions`, absent when empty), each frozen with the
`roundTo` step of its menu. Duplicating or restoring a menu remaps their product and category ids; a hidden product
drops out of them; deleting a product or category removes its id from them.

### 6.2 Engine (pure, `src/server/domain/`)

- `offers.ts`: which offers are live at a moment (date range, window, day, menu time zone), the discount a product gets
  (the largest of the live DISCOUNT offers naming it or its category), and `salePrice(regular, percent, roundTo)`.
- Every price a guest is shown or charged goes through one `priceOf(catalog, product, variantId, optionIds, now)`:
  the quote, the menu view, upgrade deltas and totals, set comparisons. Sets themselves are never discounted; a set
  is still offered only while it is cheaper than its items at their current prices.
- `meal.ts`: "complete your meal" offers for a cart. For each `completesMeal` category with no line in the cart, the
  best-scoring orderable dish in daypart (promotion score), not dismissed; at most 2, suggestion ids `meal:<productId>`.
- `engineering.ts`: the matrix. Popularity of a dish is the number of distinct guest sessions that added it (events
  `ADD_TO_CART` and `PAIRING_ADD`) in the last 30 days. A dish is popular when its share is at least 70% of an equal
  share (`0.7 / dishes`); profitable when its margin (price minus cost) is at least the popularity-weighted average
  margin of the costed dishes. Dishes without a cost are "needs cost", outside the four classes.
- `advisor.ts`: the checklist from the draft catalog (rules in section 2, goal 6). A category is too long above 10
  dishes. A separate vegetarian section is a category of at least 3 dishes all tagged vegetarian or vegan.

### 6.3 Guest

- Menu rows, the signature dish and the product page show: the offer badge ("Today's special", "−20%"), the sale price
  with the regular price struck through during a discount, "Most ordered", "Only 3 left", "For 4 · 2.50 each".
- Above the categories, a quiet strip lists the live offers: title, text, and "until 18:00" (or "until Sunday") when
  the offer ends within 7 days. No countdown timer.
- The cart gains the "Complete your meal" row below the pairing row; it records `PAIRING_IMPRESSION` and `PAIRING_ADD`
  with its `meal:` suggestion ids (no new event types).
- `priceStyle: 'plain'` drops the symbol on the menu list, the signature and the product page. The cart, totals and
  the order review keep it.
- Most ordered: the top 3 dishes by distinct sessions over the last 14 days, each with at least 5 sessions; read once
  per menu per hour (`cached`, tag per menu); off when the owner switches it off or there is too little data.

### 6.4 Studio

The Sales tab (`/studio/menus/{id}/sales`), second-level tabs:

| Page | What it does |
|---|---|
| Overview | Advisor checklist; matrix table with class, adds, margin and next step; suggestion results (shown, accepted, rate) for upgrades, pairings, sets and "complete your meal" |
| Upgrades | Rules "when a guest opens X, offer Y instead": pitch and what changes in three languages, priority (normal, high, top = 50, 75, 100), dayparts, on/off |
| Pairings | "with X (a dish or a category), suggest Y": reason in three languages, strength (normal, strong, strongest = 50, 75, 100), dayparts, on/off |
| Sets | Name and description in three languages, items (dish, size, quantity; 2 to 8 lines), price, dayparts, on/off; shows the items' total and the saving live; refuses a price that is not below the items' total |
| Offers | Special or discount; dishes and categories; dates, daily window, days; title and text in three languages; on/off; order |
| Settings | Plain prices, most ordered, only a few left; which categories complete a meal; how many upgrades and pairings a guest sees (1 to 5) and how much more an upgrade may cost (25% to 200%) |

## 7. Left to the builder

Layout and wording inside the Studio's existing components and tokens; the order of sections on each page; empty
states; exact event windows beyond those stated.

## 8. Research summary (the evidence behind the choices)

| Technique | Evidence | Here |
|---|---|---|
| Popularity labels from real data | Cai, Chen and Fang, AER 2009: +13 to 20% for the top five dishes | Most ordered |
| First or last in a category | Dayan and Bar-Hillel 2011: up to twice as chosen as the middle | Advisor tip for puzzles and stars |
| No currency symbol | Yang, Kimes and Sessarego 2009: about 8% more spent | Plain prices |
| Pre-selected default size | Online food nudging studies: pre-selection changes choice | Exists (default size) |
| A middle option | Simonson and Tversky 1992, compromise effect | Advisor: two sizes |
| Descriptions, photos | Mixed (Wansink retracted; platform data +12 to 24%) | Advisor |
| Category length | Bournemouth (secondary sources): about 6 to 10 | Advisor |
| Separate vegetarian section | LSE thesis via WRI: about 56% fewer orders | Advisor |
| Scarcity | Works only when true; server-delivered scarcity is stronger | Only a few left, from stock |
| Menu engineering | Kasavana and Smith 1982 | Insights |
| Timed offers, specials, meal completion, sharing | Industry practice | Offers, complete your meal, serves |
