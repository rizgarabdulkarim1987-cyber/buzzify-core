# Sub-project 1: Foundation, Customer Menu and Revenue Engine

Status: approved. Amended during planning (see the plan's "Spec refinements").
Date: 2026-10-15
Part of: Luxury 3D Smart Restaurant Menu and Revenue Platform (working name: buzzify-menu)

## 1. Purpose and outcome

Build the foundation of a multi-tenant SaaS for cafés and restaurants, and ship the
first usable slice: a premium, fast, server-priced customer menu for the fictional
luxury café ATELIER, driven by a rule-based revenue engine (upsell, cross-sell,
bundles, profit- and daypart-aware promotion).

Success looks like this:

- A fresh clone, plus the setup commands in section 10, opens
  `/atelier/en/t/04` with a server-rendered menu visible immediately.
- Diners can browse, search (English, Arabic, Sorani), open a product, choose
  upgrades, see an honest live total, add Perfect Pairing items, and review a cart
  whose totals always come from the server.
- Everything is persisted in PostgreSQL, tenant-isolated, and covered by tests.

The product positioning, from the original brief: "We don't just digitize menus.
We transform menus into revenue-generating dining experiences." The most important
design principle: customers are hungry, so they reach products instantly, with no
intro, loader, or unnecessary interaction.

## 2. Scope

### 2.1 Decomposition of the full brief

The full brief (seven phases) is split into three sub-projects. Each gets its own
spec, plan, and working result.

| # | Sub-project | Brief phases |
|---|---|---|
| 1 | Foundation, customer menu, revenue engine (this document) | 1, 2 |
| 2 | Secure ordering loop: table sessions and PIN, orders, cashier dashboard, kitchen display, real-time, audit log | 3, 4 (kitchen) |
| 3 | Admin, SaaS and immersive layer: admin panel, super-admin and plans, analytics dashboards, 3D and Explore mode, hardening and deployment | 4 (admin), 5, 6, 7 |

### 2.2 In scope here

Project scaffold, PostgreSQL schema and migrations, tenant-scoped data access,
ATELIER seed, Quick Menu, search, product detail with options and upgrades, cart
with server quote and read-only order review, upsell, Perfect Pairing cross-sell,
bundles, profit- and daypart-aware promotion, English/Arabic/Sorani with RTL,
brand tokens applied per tenant, analytics event capture, test suite, README.

### 2.3 Out of scope here

Table sessions and PIN verification, order submission, cashier and kitchen screens,
admin UI, 3D product viewer and Explore mode, analytics dashboards, super-admin and
subscription plans, user accounts and roles, tax and service charge, payments,
custom-domain routing (the resolver is built, but domains are not wired), production
hardening, real photography and 3D assets.

The cart ends in a read-only order review. There is no Submit control in this
sub-project, so nothing in the UI pretends to place an order.

## 3. Decisions

| Decision | Choice | Reason |
|---|---|---|
| Architecture | Next.js monolith with a framework-free domain layer | Fastest path to a working demo, server rendering for LCP, pure and testable pricing logic that can move to a sidecar later |
| Database | PostgreSQL | Real-time delivery and strict tenant isolation are easier here; matches the brief |
| Local database | `embedded-postgres` npm package, data in `.data/` | Real Postgres engine, no installer, no admin rights, same as production engine |
| Production hosting | Undecided; settled in Phase 7. Stay on Postgres-capable hosts | User decision. Hostinger shared hosting would imply MySQL and is not assumed |
| Tenancy | Shared schema, `restaurantId` on every tenant-owned row, Prisma client extension forcing scope | Simple operations, enforced by construction. Postgres row-level security is added as defense in depth in Phase 7 |
| Money | Integer minor units, currency per restaurant | No float errors; IQD (0 decimals) and USD (2) both supported |
| Cart | Client-side state; server re-prices every time | The client never decides a price |
| Translations | `translations` JSONB per entity; fallback locale, then restaurant default, then English | Pragmatic to edit and validate with Zod |
| Branch | Work stays on the currently checked-out branch (`main`) | User choice when asked |

## 4. Architecture

### 4.1 Stack

Next.js (App Router) with TypeScript, React, Tailwind CSS, Motion for React, Prisma
on PostgreSQL, Zod, Zustand (cart), an in-house typed message module for UI strings
(`{param}` interpolation and plural keys over `Intl.PluralRules`; the `[locale]` path
segment owns routing, so next-intl is not used), Vitest (unit and API integration),
Playwright with axe (end to end and accessibility), and Lighthouse for the
performance baseline. Versions are pinned exactly in `package.json`.

### 4.2 Code layout

```
prisma/              schema, migrations, seed (ATELIER)
src/server/domain/   pure TypeScript: money, pricing, upsell, pairing, bundles,
                     promotion, schedules (no Next, no Prisma imports)
src/server/data/     Prisma access, tenant-scoped client, mappers to domain types
src/app/             routes, route handlers, server components
src/ui/              components, design tokens, motion primitives
tests/               unit, API integration, end to end
```

The domain layer takes plain data in and returns plain data out. The clock is
injected. Ties are broken by id so output is deterministic.

### 4.3 Routing and tenant resolution

| Route | Purpose |
|---|---|
| `/{tenant}/{locale}` | Quick Menu |
| `/{tenant}/{locale}/t/{table}` | QR entry: stores table context, then shows the menu |
| `/{tenant}/{locale}/p/{slug}` | Product detail: sheet over the menu from the list, full page on direct load |
| `/{tenant}/{locale}/cart` | Cart and read-only order review |
| `POST /api/{tenant}/quote` | Server pricing |
| `POST /api/{tenant}/suggestions` | Upgrades, pairings, bundles, signature item |
| `POST /api/{tenant}/events` | Analytics events |

A single `resolveTenant()` maps a path segment or a request host (through
`RestaurantDomain`) to a restaurant. Custom domains and subdomains are enabled in
Phase 7 without changing any page.

Public endpoints validate payloads with Zod, cap body size, cap lines per cart (50)
and quantity per line (1 to 20), and apply a basic per-client rate limit.

### 4.4 Tenant isolation

Every tenant-owned table has `restaurantId`. All reads and writes go through a
Prisma client extension that injects it on find, update, and delete and sets it on
create. A registry lists scoped models, and a test fails if a model in the schema is
neither registered nor explicitly marked global. Raw SQL is forbidden by lint.

### 4.5 Money

`Money` is `{ amount: integer minor units, currency: ISO 4217 }`. Display follows
the currency's minor-unit digits via `Intl.NumberFormat`. Totals are computed only
on the server. The numeral style (Latin or Arabic-Indic) is configurable per
restaurant.

### 4.6 Translations and direction

Translatable entities carry `translations: { en, ar, ckb }`, each with `name`,
`description` and entity-specific fields. RTL (`dir="rtl"`) is derived from the
locale for `ar` and `ckb`. Styles use logical properties only.

## 5. Data model

All tenant-owned tables include `restaurantId`.

| Table | Key fields |
|---|---|
| `Restaurant` | `slug` (unique), `name`, `currency`, `defaultLocale`, `locales[]`, `timezone`, `numeralSystem`, `engineConfig` (JSONB: weights, caps), `status` |
| `RestaurantDomain` | `restaurantId`, `host` (unique) |
| `BrandConfig` | `restaurantId` (unique), color tokens, typography, default theme, motion intensity, navigation style, logo media |
| `Category` | `slug`, `sortOrder`, `translations`, `isActive` |
| `Product` | `categoryId`, `slug`, `basePrice`, `cost?`, `popularity` (0-100), `priority` (0-100), `isSignature`, `isFeatured`, `isAvailable`, `stockCount?`, `lowStockThreshold?`, `dayparts[]` (empty = all), `hideOutsideDaypart`, `slot?` (DRINK, SIDE, DESSERT, STARTER, BAKERY, MAIN), `allergens[]`, `ingredients`, `media[]`, `translations`, `sortOrder` |
| `ProductVariant` | `productId`, `priceDelta`, `costDelta?`, `isDefault`, `translations`, `sortOrder` |
| `ModifierGroup` | `productId`, `minSelect`, `maxSelect`, `translations`, `sortOrder` |
| `ModifierOption` | `groupId`, `priceDelta`, `costDelta?`, `isSuggested`, `suggestPriority`, `effect` (translatable "what changes"), `isAvailable`, `sortOrder` |
| `UpsellRule` | `sourceProductId`, `targetProductId` (swap), `priority`, `translations` (pitch, differences), `dayparts[]`, `isActive` |
| `PairingRule` | `sourceType` (PRODUCT or CATEGORY), `sourceProductId?`, `sourceCategoryId?`, `targetProductId`, `weight`, `translations` (reason), `dayparts[]`, `isActive` |
| `Bundle` | `slug`, `price`, `translations`, `dayparts[]`, `isActive` |
| `BundleItem` | `bundleId`, `productId`, `variantId?`, `quantity` |
| `DaypartSchedule` | `daypart` (BREAKFAST, LUNCH, DINNER, LATE_NIGHT), `startMinute`, `endMinute`, `daysOfWeek` mask |
| `Table` | `number`, `label`; unique per restaurant |
| `AnalyticsEvent` | `anonymousSessionId`, `type`, `tableId?`, `productId?`, `suggestionId?`, `payload`, `occurredAt` |

Event types: `MENU_VIEW`, `PRODUCT_VIEW`, `ADD_TO_CART`, `UPSELL_IMPRESSION`,
`UPSELL_ACCEPT`, `PAIRING_IMPRESSION`, `PAIRING_ADD`, `BUNDLE_IMPRESSION`,
`BUNDLE_ACCEPT`. These are browsing behavior only; submitted orders and confirmed
sales are separate event sources introduced in later sub-projects.

Add-ons such as "premium cheese +$1" are modifier options on the product. Upsell
rules decide which options are suggested and how they are framed, so a customer can
always choose an add-on directly.

Deferred to later sub-projects: table sessions, orders and order items, users and
roles, payments, audit logs, subscription plans.

## 6. Revenue engine

Lives in `src/server/domain/`. Pure functions.

### 6.1 Quote

Input: tenant config and cart lines `{ productId, variantId?, optionIds[], quantity,
bundleId? }`. The client sends no prices.

The server verifies each line: product belongs to the tenant; variant belongs to
the product; modifier group min/max satisfied; product available, in stock, and in
daypart. Output: line totals, applied bundles, subtotal, per-line `issues[]`, and an
empty `charges[]` reserved for tax and service charge.

### 6.2 Upsell

For a selected product (with its current configuration), return up to 3 offers.

- Candidates come only from: the product's own `isSuggested` options, a larger
  variant, or an explicit `UpsellRule` swap.
- Hard filters: already selected, unavailable, out of daypart, delta above the cap
  (default 75% of the current price). At most one swap.
- Each offer carries: price delta, a concrete "what changes" description, and the
  resulting total.
- Order: rule priority, then margin of the delta, then popularity. Defaults are
  configurable via `engineConfig`.

### 6.3 Cross-sell ("Perfect Pairing")

- Candidates come from `PairingRule`s matched against every cart line, not only the
  last item.
- Filters: already in the cart, unavailable, out of daypart, slot already filled
  (the cart already holds a product with the same non-null `slot` as the target),
  and dismissed this session (`dismissedIds` is an input). At most one offer per
  slot.
- Score: rule weight times matching-line count with diminishing returns (several
  rules supporting one target add at half weight each, capped), plus margin and
  popularity and priority, minus a low-stock penalty. Top 3, each with a
  plain-language reason from the rule's translated `reason`.
- Placement: inline on product detail and as a quiet row in the cart. Never a modal.

### 6.4 Bundles

- `individualTotal` is the live sum of the items at current prices (including
  variants). The comparison shows the bundle price against it. A saving is shown
  only when positive; no invented "was" prices.
- A bundle whose price is not below its items is never shown as a deal, and the
  seed validator reports it.
- When the cart contains a bundle's items, offer "make it a set" and convert in one
  action, priced server-side.

### 6.5 Promotion and occasion

- Inputs: price, cost, margin, popularity, stock, priority. Unknown cost is
  neutral and never inferred.
- Eligibility: available, in daypart, in stock.
- Output: a promotion score (weights configurable per restaurant) that orders the
  Signature shelf and cart nudges, always with `reasons[]` for explainability.
- Daypart comes from the restaurant's schedule in its own timezone, including
  windows that wrap past midnight (for example 22:00 to 03:00).
- A product with `dayparts` set is unorderable outside them only when
  `hideOutsideDaypart` is true. Otherwise it stays orderable but is not promoted or
  recommended outside its dayparts.

### 6.6 Relevance gate

Margin only orders candidates that are already relevant. A high-margin product with
no relationship to the cart or selection can never be recommended.

### 6.7 Measurement

Every suggestion has a stable `suggestionId`. The UI emits impression and accept
events into `AnalyticsEvent`, so conversion data is real from the first session.

## 7. Customer experience

### 7.1 Principles

The menu is the first screen. There is no splash or intro. Content never waits on
an animation. One memorable element (the product stage); everything else is quiet.

### 7.2 ATELIER design plan

| | Choice |
|---|---|
| Color | Basalt `#0E0E0F` page, Charcoal `#1B1A19` surfaces, Smoke `#2A2826` raised, Champagne `#D6BC8A` accent, Bone `#EDE8DF` text, Mist `#A7A096` secondary |
| Type | Bodoni Moda (display), Hanken Grotesk (text), Noto Naskh Arabic (Arabic and Sorani); self-hosted and subset |
| Surfaces | Hairline dividers and generous space instead of boxed cards. Glass and metal only as subtle material on the product stage and sheet |
| Avoid | Tracked all-caps eyebrow labels, 01/02/03 numbering, arrows on links, identical rounded-card grids, decorative glow |

Brand values are stored in `BrandConfig` and emitted as CSS variables on the server
so there is no theme flash. A light theme is defined alongside the default dark.

### 7.3 Quick Menu

1. Header: logo, table label ("Table 04"), search, language.
2. Signature of the hour: one large item chosen by the daypart and promotion
   engine; the only large visual on first load.
3. Sticky category rail, then a product list: name, one-line description, price,
   thumbnail. A quick-add control appears when no choices are required; otherwise
   the row opens the detail sheet.
4. Search is client-side over the translated menu with diacritic and
   Arabic-letter normalization.

### 7.4 Product detail

Large visual stage, options and upgrades with a live total that states exactly what
each upgrade changes, Perfect Pairing below, sticky "Add to order" showing the
running total. On mobile it is a bottom sheet with focus trapping.

### 7.5 Cart

Editable lines, server-priced subtotal, a quiet pairing row, and a "make it a set"
suggestion when applicable. Ends in a read-only order review; real submission
arrives with table verification in sub-project 2.

### 7.6 Explore mode

The 3D and storytelling mode belongs to sub-project 3. The shell keeps a reserved
slot but renders no control until the mode exists.

### 7.7 Product visuals

No real photography is available. Each product gets generated, art-directed
still-life art in the ATELIER palette. The `media` list accepts real images, video
or 3D models; dropping real files into `public/media/atelier/` and referencing them
replaces the generated art with no code change.

### 7.8 Language and RTL

Logical CSS properties throughout; `dir` derived from locale; directional icons
mirrored; numeral style per restaurant. Switching language changes the path
segment only. The cart persists per device and restaurant, and scanning a different
table's QR code starts a fresh order. The quote is re-fetched in the new language.

### 7.9 Motion

Motion for React. Animate only in response to action (sheet open and close,
add-to-cart confirmation, price change). One page-load moment: the signature item
settles in. Transform and opacity only, interruptible springs.
`prefers-reduced-motion` falls back to opacity.

### 7.10 Performance

Target: LCP under 2.5 s on a throttled mobile profile, where practical.

- Tenant catalog cached per restaurant (300 s, tag `catalog:{restaurantId}`); the
  menu view, daypart and signature item are computed per request from it.
- LCP image sized and prioritized, AVIF or WebP via `next/image`.
- Fonts self-hosted and subset.
- Menu route initial JavaScript targeted at roughly 120 KB gzipped; cart and sheet
  code-split; no 3D library in this sub-project's bundle.
- A Lighthouse mobile run records the measured number. The target is reported as
  met or not met, never assumed.

### 7.11 Accessibility

Focus-trapped dialog for the sheet, 44 px targets, visible focus, cart total
changes announced through a live region, contrast checked for Champagne on
Charcoal, search input labelled.

## 8. Seed data (ATELIER)

- Currency USD, default locale `en`, locales `en`, `ar`, `ckb`, timezone
  `Asia/Baghdad` (a per-restaurant setting; ATELIER's choice is arbitrary demo
  data).
- 5 categories: Coffee and Tea, Breakfast, Plates, Pâtisserie, Cold and Sparkling.
- 24 products with realistic prices, costs, popularity, priority, stock,
  allergens, ingredients, and dayparts.
- Upsell: burger options (premium cheese, double patty) and a swap to a premium
  burger; coffee add-ons (oat milk, extra shot).
- Pairings: burger to side and beverage; coffee to croissant or dessert; steak to
  side and beverage; pasta to starter or dessert.
- 2 bundles with honest pricing.
- Dayparts: breakfast 07:00-11:00, lunch 11:00-16:00, dinner 16:00-22:00,
  late-night 22:00-03:00.
- Tables 01 to 12; Table 04 is the demo table.
- Every name, description, option and category label in English, Arabic and Sorani.
  The Arabic and Sorani text is machine-drafted and must be reviewed by a native
  speaker before real customers see it.
- The demo PIN `482916` for Table 04 belongs to sub-project 2 and is seeded there
  as a development-only credential.

## 9. Testing

| Layer | Coverage |
|---|---|
| Domain unit tests (Vitest) | Pricing and rounding (USD and IQD), modifier min/max, upsell caps and filters, pairing slot-filled and dismissal, bundle honesty, daypart windows that wrap midnight with timezone, promotion reasons, the relevance gate |
| Tenant isolation | Two seeded tenants never see or write each other's rows; registry coverage test fails on an unregistered model |
| API integration against real Postgres | Client-sent prices ignored, other-tenant product IDs rejected, unavailable items flagged, payload limits enforced |
| End to end (Playwright) | Mobile viewport and one RTL run: QR URL shows the menu with no interaction; search; add a burger with an upgrade and check the total; add a pairing; switch language and cart persists; reduced motion; axe checks |
| Performance | Lighthouse mobile run recorded |
| Static | Strict TypeScript; lint bans raw SQL |

## 10. Setup and workflow

```bash
npm install
npm run db:start      # embedded Postgres in .data/ on port 54329
npm run db:migrate
npm run db:seed
npm run dev           # http://localhost:3100/atelier/en/t/04
```

The dev server uses port 3100 because port 3000 is occupied on the development
machine. `.env.example` is committed. `.env` and `.data/` are git-ignored.

Nothing is pushed to GitHub unless the user asks. The GitHub repository is public,
so pushing publishes the code.

## 11. Definition of done

1. A fresh clone plus the commands in section 10 loads `/atelier/en/t/04` with a
   server-rendered menu visible immediately.
2. Search works in all three languages; Arabic and Sorani render correctly RTL.
3. Upgrades, pairings, and bundles behave per section 6, and the server quote
   always equals what the UI shows.
4. Tampered client payloads are rejected; tenant isolation tests pass.
5. All tests pass and the Lighthouse baseline is recorded.
6. Work is committed with a README documenting setup and architecture.

## 12. Risks and assumptions

| Item | Note |
|---|---|
| Placeholder visuals | Generated art will not match real food photography; the asset pipeline is built so real media replaces it without code changes |
| Translation quality | Arabic and Sorani are drafted, not professionally reviewed |
| `embedded-postgres` maturity | The package is labelled beta. If it proves unreliable on this machine, fall back to a system PostgreSQL with the same Prisma schema |
| LCP target | Reported as measured. Throttled-mobile results depend on the test environment |
| Hosting | Undecided until Phase 7; a MySQL-only host would require a schema provider change |
| Public repository | Anything pushed is public until the repository is made private |
