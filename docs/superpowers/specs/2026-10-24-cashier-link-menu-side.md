# Buzzify Menu ↔ Buzzify Cashier link: the Menu side

Status: proposal for the contract with `menu-link-plan` (the cashier repo's `docs/superpowers/specs/2026-10-24-menu-cashier-link-contract.md` is the contract of record; where the two differ, the contract wins and this note is updated).
Owner's rules: Buzzify Menu is connected to the cashier, there is no second menu; the menu keeps its models and architecture; a menu-only restaurant behaves exactly as today; a cashier-only restaurant keeps working.

Base: this note and the code are written on `origin/main` (d3bbfb5), the production branch, in the worktree `.claude/worktrees/cashier-link` on branch `feat/cashier-link`. The local `motion-studio` branch is 96 commits behind it and has no billing or plans.

## 1. Menu facts that shape the link (verified in code)

| Fact | Where |
|---|---|
| **Menu is now also Core.** `Application` (`menu`, `cashier`), `PlanPrice`, `Subscription` (per restaurant and application: TRIAL/ACTIVE/GRACE/…), `Payment` (by hand) live in this database. So the cashier subscription of a restaurant is a row here, and the restaurant is the registry. | `prisma/schema.prisma`, `20261023090000_billing_applications` |
| `Restaurant` is the client (`clientNumber`, status, plan). It owns `Menu`s (one slug, one catalog, one brand each). A cashier `Business` therefore maps to one `Restaurant` (and the link names one `Menu`). | schema |
| Guests read the **live revision** (`MenuRevision.snapshot`), never the draft. Sold-out, hidden, stock and sold-out options are laid over it live ("overlay") with no publish. `getCatalog(tenant)` = live revision + overlay, hidden products removed. | `src/server/data/public-menu.ts`, `live.ts` |
| Public slug resolution is cached up to 5 minutes (`resolvePublicMenu`, `expireMenu` expires it). Plans are read live per guest request. | `public-menu.ts`, `cache.ts` |
| Prices: integer minor units (`basePrice`, `priceDelta`, bundle `price`), currency per menu (`Menu.currency`, default USD; IQD has no decimals). Server prices carts with `quoteCart` (promotions, bundles, dayparts) at `POST /api/[tenant]/quote`. | `domain/pricing.ts`, `api/[tenant]/quote` |
| Catalog shape: categories → products → variants (sizes, `priceDelta`), modifier groups (`minSelect`/`maxSelect`) → options (`priceDelta`, `isAvailable`). Texts are `translations` per `en`/`ar`/`ckb`. | `domain/types.ts` |
| Tables: `Table(menuId, number, label)` and `QrCode(menuId, tableNumber)`. The guest page `/[tenant]/[locale]/t/[table]` opens the menu with `RouteTable` set. Tables are plain numbers; no areas. | schema, `[tenant]/[locale]/t/[table]/page.tsx` |
| Orders: **none**. The cart lives in `localStorage` (zustand) and ends in a read-only review ("show this to the waiter"). Entitlement `ordering.tableBasket` is named and `reserved`. | `ui/cart/*`, `domain/entitlements.ts` |
| Public API pattern: `handleTenantRequest` (tenant lookup, in-memory rate limit per tenant+IP, 32 KiB body cap, zod schema, problem JSON `{error:{code,message}}`). Rate limiter is per instance (known gap in the architecture audit). | `server/http/route.ts`, `rate-limit.ts` |
| Server-to-server auth precedent: `Authorization: Bearer ${CRON_SECRET}` compared in constant time. Env is parsed lazily per section in `src/server/env.ts` with a production check. | `http/cron-auth.ts`, `env.ts` |
| Studio actions go through one framework (permission + audit in the same transaction); `tests/studio/enforcement.test.ts` forbids bypassing it. `tenant-db.ts` scopes Prisma clients by menu. | `server/studio/framework` |
| Tests: Vitest (domain, data, http, api, studio against a real Postgres), Playwright e2e. Dev DB port 54329 is shared; a worktree uses its own port (`BUZZIFY_DB_PORT`). | tests/, CLAUDE memory |

## 2. Principle: one catalog, one owner

- When a restaurant is linked, **the Menu owns products, categories, options, prices and availability**. The cashier reads them; it never writes them back. No double entry.
- The cashier **pulls** the published catalog (server to server). A pull gives the live revision plus today's availability, i.e. exactly what a guest sees.
- Orders flow the other way: a guest order is **sent by the Menu server to the cashier**, which holds it as a request until a cashier approves (after optionally editing) or rejects it. The Menu stores no orders.
- Cashier-only restaurants: no link row, nothing here changes. The spec's "later they subscribe to the menu and the products move over" is a separate import (cashier → Menu draft) that reuses `src/server/sheets` import; out of scope for v1, noted in section 9.
- Menu-only restaurants: no link row, so guest pages, API and Studio behave exactly as today. The link adds one nullable relation read and one feature flag defaulting to off.

## 3. Mapping and pairing

```
Restaurant (menu repo)  1 ── 0..1  CashierLink  ── 1  Menu (the one that feeds the cashier)
                                      │
                                      └─ cashierBusinessId  ↔  cashier Business.id  (set once, at pairing)
```

New table `CashierLink`:

| Column | Notes |
|---|---|
| `id` cuid | sent as `X-Buzzify-Link` |
| `restaurantId` unique, `menuId` unique | one link per restaurant; the menu must be PUBLISHED and its currency `IQD` |
| `status` `PENDING \| ACTIVE \| PAUSED \| REVOKED` | PENDING until the cashier pairs; PAUSED stops the cashier reading and orders; REVOKED is final |
| `secretVersion` int | rotating the secret = increment |
| `cashierBusinessId` unique nullable | bound by the first signed `POST /pair`; later requests must carry the same id |
| `orderingEnabled` bool default false | guest ordering switch, separate from the catalog read |
| `pairedAt`, `lastSeenAt`, `lastCatalogAt` | for the Studio status panel |
| `version`, timestamps | optimistic concurrency like the other editable rows |

Secret: never stored. `secret = HMAC-SHA256(CASHIER_LINK_KEY, "link:" + id + ":" + secretVersion)` (hex, 32 bytes). Studio shows `id.secret` **once** (the "link code"); the owner pastes it into the cashier's settings; the cashier stores it as its own secret. Rotation shows a new code and the old one stops at once. `CASHIER_LINK_KEY` is a new env value (≥ 32 chars, checked in production like `CRON_SECRET`); unset means the whole link feature answers 503/off.

Who may link: the restaurant must hold a live (`TRIAL | ACTIVE | GRACE`) `Subscription` for application `cashier`; creating, pausing, rotating and revoking is a Super Admin / platform-owner action in v1 (new permission `cashier.link`, never grantable to designers; a client policy may grant it later). Everything is audited (`cashier.link.create|pair|pause|resume|rotate|revoke|ordering`).

Cashier base URL: one value in Menu env, `CASHIER_BASE_URL` (the single Buzzify cashier deployment). The Menu never posts to an address the cashier or a guest supplied (no SSRF).

## 4. Authentication of every link call (both directions)

Signed request, shared per-link secret, no bearer secret on the wire:

```
X-Buzzify-Link:      <linkId>
X-Buzzify-Business:  <cashierBusinessId>          (menu->cashier: the same id, cashier checks it)
X-Buzzify-Timestamp: <unix seconds>
X-Buzzify-Signature: v1=<hex HMAC-SHA256(secret, `${ts}\n${METHOD}\n${pathWithQuery}\n${sha256hex(body)}`)>
```

- Receiver rejects when the signature is wrong (constant-time), the timestamp is more than 300 s from its clock, the link is not `ACTIVE`, or the business id differs. All with the same 401 and no detail.
- `POST` writes also carry `Idempotency-Key` (section 6). GETs are idempotent by nature.
- 5xx and timeouts: caller retries with the same `Idempotency-Key`.
- Body cap 256 KiB on the link API; JSON only.

## 5. What the Menu exposes to the cashier: `/api/link/v1` (versioned in the path)

| Call | Purpose |
|---|---|
| `POST /pair` `{ cashierBusinessId }` | first call: binds the business id (PENDING → ACTIVE). Repeating with the same id is fine; a different id is 409 `LINK_ALREADY_PAIRED`. |
| `GET /status` | `{ link:{status, orderingEnabled}, restaurant:{id,name,status}, subscription:{cashier:{status,currentPeriodEnd}}, menu:{id, slug, currency, defaultLocale, locales, timeZone}, now }`. Lets the cashier replace its operator-script `cashierActive` flag with the real subscription state. |
| `GET /catalog` | the published catalog (below). `ETag` = `"<revisionId>.<overlayHash>"`; `If-None-Match` gives 304. |
| `GET /availability` | light poll: `{ etag, products:{ [id]:{ isAvailable, stockCount } }, options:{ [id]:{ isAvailable } } }` from the overlay only. |

Catalog body (`schema: 1`; additions are additive, a breaking change is `/v2`):

```
{ schema:1, generatedAt, etag,
  menu:{ id, slug, name, currency:"IQD", defaultLocale, locales, timeZone, revisionId, revisionNumber },
  categories:[{ id, sortOrder, names:{en,ar,ckb} }],
  products:[{ id, categoryId, sortOrder, names:{...}, descriptions:{...},
              basePrice,                       // integer IQD
              isAvailable, stockCount|null,
              variants:[{ id, names, priceDelta, isDefault }],
              groups:[{ id, names, minSelect, maxSelect,
                        options:[{ id, names, priceDelta, isAvailable }] }] }] }
```

Rules: ids are the Menu's ids and are stable (the cashier keeps them as `menuProductId`, `menuVariantId`, `menuOptionId`). Only the live revision's products that are not hidden; `isAvailable=false` products are included (the cashier shows them as sold out). No cost, no media, no sales-tool data. Texts are the menu's per-locale strings, unchanged (the cashier flattens to its own shape). Promotions are **not** in the catalog (see open question Q3).

Pull rhythm: the cashier calls `/catalog` with `If-None-Match` every few minutes and on "Sync now"; `/availability` more often. Optional later: the Menu pings a cashier webhook on publish/availability change (v1.1; the pull is enough).

## 6. A guest order, end to end

```
guest phone ──POST /api/{tenant}/orders──▶ Menu server ──POST /api/link/v1/customer-orders (signed)──▶ Cashier
            ◀──{ orderRef, status }───────                ◀──{ publicId, status:PENDING }──────────────
guest phone ──GET  /api/{tenant}/orders/{orderRef}─▶ Menu ──GET  /api/link/v1/customer-orders/{publicId} (signed)──▶ Cashier
```

**Guest to Menu** (new, public, same pattern as `/quote`): body `{ clientKey, locale, tableNumber, note, cart }`.
- `clientKey`: random id the browser makes once per submit (kept in `sessionStorage` until the answer arrives), 16–64 chars.
- Allowed only when the tenant's link is `ACTIVE` with `orderingEnabled`, the restaurant active, the table exists in this menu (`Table.number`), and the menu is open (no business-hours rule in v1).
- The Menu prices the cart itself with `quoteCart` (never trusts the client), refuses lines that are unavailable or unknown, and builds the order from that quote.
- Rate limit: 10 orders per IP+tenant per minute at the Menu (in-memory, like the other public routes), plus the cashier's own per-table and per-business limits; a 429 from the cashier is passed through as `RATE_LIMITED`.
- Cart rules reuse `cartSchema` limits (50 lines, quantity ≤ 20). Note ≤ 300 chars.

**Menu to Cashier**: `POST {CASHIER_BASE_URL}/api/link/v1/customer-orders`, signed, `Idempotency-Key: <clientKey>` (the cashier stores `(linkId, clientKey)` unique; a repeat returns the same `publicId` with 200 instead of 201):

```
{ clientKey, tableNumber, locale, note, menuRevisionId, currency:"IQD",
  lines:[{ productId, variantId|null, optionIds:[...], quantity, note:"",
           snapshot:{ name, variantName|null, options:[{id,name,priceDelta}], unitPrice, lineTotal } }],
  bundles:[{ bundleId, quantity, snapshot:{ name, unitPrice, lineTotal,
             items:[{ productId, variantId|null, quantity, name }] } }],
  subtotal }
```

The `snapshot` is the Menu's own quote of what the guest saw (promotions, bundle price and daypart rules included), in IQD integers. The cashier uses it for the request's prices, as its spec says ("prices come from the request snapshot"), and validates that every `productId/variantId/optionId` exists in its synced copy of this link's catalog. Unknown or disabled ones are refused with `PRODUCT_UNKNOWN` / `PRODUCT_UNAVAILABLE`. A bundle becomes one line without a product on the cashier side (name + price, components for the kitchen text).

Answers: `201|200 { publicId, status:"PENDING", createdAt }`; errors as problem JSON `{error:{code,message}}` with `ORDERING_OFF` (409), `TABLE_UNKNOWN` (404), `PRODUCT_UNKNOWN` / `PRODUCT_UNAVAILABLE` (422), `TOO_MANY_REQUESTS` (429 + `Retry-After`), `LINK_INACTIVE` (401). The Menu maps them to guest messages in en/ar/ckb.

**Status**: `GET {CASHIER_BASE_URL}/api/link/v1/customer-orders/{publicId}` signed → `{ publicId, status: "PENDING"|"APPROVED"|"REJECTED"|"EXPIRED", rejectReason?, decidedAt? }`. The cashier answers 404 for a `publicId` of another business or link. The Menu relays it as `GET /api/{tenant}/orders/{orderRef}` where `orderRef = publicId`; guest vocabulary: waiting / approved / rejected (EXPIRED reads as rejected-by-timeout with its own text). The guest page polls every 4 s with backoff while PENDING and stops after the final state or 60 minutes; no SSE in v1.

Failure behaviour: cashier unreachable or 5xx → the guest sees "could not send, tell the waiter" and the cart stays; nothing is queued in the Menu. A status poll that fails shows the last known state with "checking…".

## 7. Menu-side changes (summary)

Database (migration written, not applied to any shared DB): `CashierLinkStatus`, `CashierLink`; no changes to existing tables.
Domain (pure, tested first): link signing and verification, secret derivation, catalog serializer (`Catalog` → feed v1 + etag), order builder (`Quote` → cashier order body), cashier error mapping.
Server: `src/server/link/*` (verify middleware, repo, cashier client with timeout 8 s and no redirects), routes `/api/link/v1/{pair,status,catalog,availability}`, guest routes `/api/[tenant]/orders` (+ `[ref]`), `findPublicMenu` reads the link and `guestFeatures` gains `cashierOrdering` (false when there is no active link), cache expiry on link change.
Guest UI (no redesign): only when `features.cashierOrdering` and the guest is on a table: the cart page's read-only review note gets a "Send order" button and a status panel; en/ar/ckb strings, RTL as everywhere.
Studio: a "Cashier link" section in the restaurant's settings (Super Admin): create, show the code once, status, ordering switch, pause, rotate, revoke, last seen. En/ar/ckb.
Env: `CASHIER_LINK_KEY`, `CASHIER_BASE_URL` (both optional; absent = feature off), added to `.env.example`, the deploy docs and the production check.

## 8. Untouched on purpose

Menu-only restaurants; revisions and publish; templates, motions, 3D; analytics; the existing quote/suggestions/events APIs; plans and entitlements (the link is gated by the cashier subscription, not by the menu tier); the Better Auth sign-in; the hand-recorded billing.

## 9. Open questions for the contract

- **Q1 Bundles and variants on the cashier side.** Proposed: variants become a required single-choice option group on the cashier, bundles become a single named line. Cashier decides how it stores them; the wire format above carries both.
- **Q2 Table numbers.** The Menu knows plain numbers; the cashier has areas. Proposed: the order carries `tableNumber` only and the cashier maps it to a table (its numbers must be unique across areas for linked tables, or it refuses `TABLE_UNKNOWN`). Optionally the cashier could expose `GET /tables` so the Studio can create the matching Menu tables and QR codes.
- **Q3 Promotions.** Guest orders carry the discounted price in the snapshot; the catalog feed carries `basePrice` only, so a cashier-entered order after a promotion starts is priced without it. Accept for v1, or add `effectivePrice` per product to the feed.
- **Q4 Hidden menu items.** Hidden products are not sent; a restaurant that wants cashier-only items must add them to the Menu and hide them from guests, which this feed cannot express. Probably a later `cashierOnly` flag.
- **Q5 Cashier-only → Menu import** (spec section 7): later, as a cashier export file the Menu's sheet importer reads, not a live API.
- **Q6 Webhook** for catalog changes: pull only in v1.
- **Q7 Pairing initiator.** Proposed: Menu side creates the code (Super Admin), cashier owner pastes it. If the cashier prefers to generate the secret, the roles swap but the signing is unchanged.
- **Q8 Order limits** (3 pending per table, 5 per 10 minutes, 300 per business per hour in the cashier's plan 4) stay the cashier's; the Menu only does the IP limit.
