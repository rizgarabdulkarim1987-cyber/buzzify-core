# Cashier phase 4: QR customer orders (inside Core)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans (inline) to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A guest scans the table's QR (the Menu's `/{address}/t/{n}`), builds a cart on the Menu, taps "Send to the waiter"; the order waits as a **request** on the cashier's requests screen; the cashier edits quantities, accepts (it becomes a normal `PosOrder` or joins the table's open one) or rejects with a reason; the guest sees waiting / accepted / rejected. A menu-only restaurant runs no cashier code.

**Architecture:** `PosCustomerOrder` (+ `PosCustomerOrderLine`) hold a request with name, price and option snapshots, separate from `PosOrder`, so the one-live-order-per-table index and the order state machine are untouched. The guest's endpoints are two public routes beside the quote route (`/api/[tenant]/qr-order`), protected by the shared per-IP limiter (`handleTenantRequest`) plus database limits. The cashier side is Studio-framework actions (`pos: 'order.handle'`, `{ kind: 'pos' }` target) over small services in `src/server/pos/customer-orders.ts`; the board reads pending counts in the same constant number of queries. Prices are recomputed on the server with the Menu's own `quoteCart` over the published catalog, so the guest pays what the Menu showed.

**Tech Stack:** Next 16, React 19, Prisma 7, Zod 4, Vitest, the existing QR renderer (`src/server/qr/render.ts`).

**Spec:** `docs/superpowers/plans/2026-10-24-cashier-unified-plan.md` (phase 4); behaviour from `buzzify-restaurant/docs/superpowers/plans/2026-10-24-cashier-4-qr.md` (frozen reference); real code of phase 3 (`src/server/pos/*`, `src/app/pos/*`).

## Rulings (each with its cost if wrong)

1. **One QR per table: the Menu's `/{address}/t/{n}`.** The cashier repo's `/m/<token>` page and `qrToken` are dropped. `PosTable.number` is the Menu table number. Cost: a printed code cannot be rotated per table (rotating needs a new slug); acceptable for v1.
2. **The order button shows only when all hold:** the restaurant has a live `cashier` subscription (`effectiveStatus` live, grace counted), `PosSettings.qrOrderingEnabled`, the menu being viewed **is** `PosSettings.catalogMenuId`, and a `PosTable` with that number exists. The check reads `Subscription` first and touches a `Pos*` table only when that is live, so a menu-only restaurant issues no `Pos*` statement (isolation test).
3. **Pricing = the Menu's quote** (`quoteCart` over the published catalog: promotions and dayparts included). The request stores `unitPriceSnapshot` = product base price, `optionsSnapshot` = variant (first) + options with deltas, and `promoDiscountPerUnit` = (base + deltas) − quoted unit price (≥ 0). Accepting writes a `PosOrderLine` with the same base and options and, when `promoDiscountPerUnit > 0`, a line `AMOUNT` discount of `promoDiscountPerUnit × quantity`. So the cashier charges what the guest saw, and the discount is visible. Cost: a promotion shows as a line discount at the till.
4. **Bundles are not orderable by QR in v1** (the till has none): a cart with a bundle is refused with `BUNDLES_UNSUPPORTED`; the button explains it.
5. **Limits (database counts, plus the per-IP limiter):** at most 3 PENDING per table, 5 requests per table per 10 minutes, 300 per restaurant per hour, at most 30 lines, quantity 1..20, note 300 chars, table note 300; a PENDING request expires 60 minutes after creation (computed on read: `createdAt <= now − 60 min`; no cron; accepting an expired one is refused). Per-IP: 10 submissions per minute per restaurant+IP. Over a limit: HTTP 429 `TOO_MANY_REQUESTS`.
6. **The guest sends ids, quantities and notes only.** The schema is strict: a price field is rejected (400). Unknown, hidden, sold-out (including the till's `soldOutOverride`), out-of-daypart or other-menu products, other-product options and unmet required groups are refused by the same rules as `quoteCart` plus the till's sold-out switch.
7. **The guest reads a request only with its random `publicId` (cuid, unguessable) AND the matching table number and slug.** The status response contains status, reject reason and line names/quantities of that request only; no other table, no staff, no prices of other things.
8. **Accept:** table free → `openOrderIn` then lines; table has a live order → lines join it and the UI passes the order's `expectedVersion` (stale → `CONFLICT`, screen reloads); a PENDING_APPROVAL/locked order is never joined. Decision guard is `updateMany({ status: 'PENDING' })` so two cashiers cannot both decide (the second gets `CONFLICT`). Lines resolve their kitchen section from the product's current till setting (none if the product was deleted). Accepting a request with no lines is refused.
9. **Editing a request = quantity change and line removal.** Adding an item is done on the order screen after accepting (the order screen already does it). Cost: one extra step for "add item"; avoids a second catalog picker.
10. **Reject needs no reason but may have one (≤ 200 chars);** it is shown to the guest.
11. **Table delete cascades its requests** (a request with no table is meaningless); `deleteTableIn` already refuses live orders.
12. **No sound/beep and no localStorage sound preference in this phase** (deferred, listed in the report). The requests screen polls every 5 s while visible, like the board.
13. **A lapsed subscription closes the guest path too** (gate re-checked on every submit and every status read).
14. **Audit:** guest submission writes an `AuditLog` row `pos.request.submit` with `actorId: null` directly (no Studio actor); cashier decisions use `ctx.audit` (`pos.request.accept|reject|edit`).

## Global Constraints

- Private database only (own `BUZZIFY_DB_PORT`, never 54329); the migration is applied to it only. No push to `main`, no production, Hostinger or Neon main. The PR body says the migration must be rehearsed on a Neon branch before merge (a push to `main` runs `prisma migrate deploy`).
- Money integer IQD. ar/ckb/en message trees identical (`tests/studio/messages.test.ts`, Menu `src/lib/messages` trees too); RTL logical CSS; 48px touch targets; stamps via `formatStamp` (Baghdad time); typed numeric fields accept Arabic-Indic digits; `useNow(start)` from the server read time (no hydration mismatch).
- Every new table has `restaurantId`, is in `RESTAURANT_SCOPED_MODELS`, and every new action/query is in the TILL list of `tests/studio/cross-tenant.test.ts`.
- Server refusals are English `StudioError` sentences present in `POS_TEXT` and `SERVER_TEXT` with ar/ckb/en messages.
- LF line endings (check `git diff --stat` for whole-file churn). Commit trailer `Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>`.

## Review Focus

1. A guest cannot read or change anything beyond the menu and their own request (wrong table number, another restaurant's slug, another request's `publicId`, other menu's product id) — Tasks 2, 3.
2. Price tampering and flooding: strict body, server totals only, limits stop at the stated numbers without breaking a legitimate guest — Task 2.
3. Accept races: two cashiers, accept while someone opened the table, stale order version, product deleted/sold out meanwhile, expired request — Task 1.
4. A menu-only restaurant (and a cashier restaurant with QR off, or whose subscription lapsed) shows no order button, answers 404 on the routes, runs no `Pos*` statement on the Menu page/quote route — Tasks 2, 5.
5. Worst-case text: 120-char Arabic product names, 300-char notes with newlines, 30 lines at 375px; Arabic-Indic digits typed into quantity — Tasks 4, 5.

## File structure

| File | Responsibility |
|---|---|
| `prisma/schema.prisma`, migration `…_pos_customer_orders` | enum `PosCustomerOrderStatus`; `PosCustomerOrder`, `PosCustomerOrderLine` |
| `src/server/domain/pos/customer-order-rules.ts` (+ test) | pure: limits constants, `isExpired`, `promoDiscountPerUnit`, strict body schema |
| `src/server/pos/customer-orders.ts` | gate `qrOrderGate`, `submitCustomerOrder`, `readGuestRequest`, cashier `listRequests`, `readRequest`, `setRequestLineQuantity`, `removeRequestLine`, `acceptRequest`, `rejectRequest`, `pendingByTable` |
| `src/app/api/[tenant]/qr-order/route.ts`, `…/[publicId]/route.ts`, `…/availability/route.ts` | guest endpoints (POST submit, GET status, GET availability) |
| `src/server/studio/actions/pos-requests.ts`, `queries/pos-requests.ts` | cashier definitions; exports in `src/app/studio/_actions/pos.ts` |
| `src/server/pos/board.ts` | `pendingRequests` per table, blue state |
| `src/app/pos/(till)/requests/page.tsx`, `src/app/pos/_ui/RequestsScreen.tsx` | requests screen |
| `src/app/pos/(till)/qr/page.tsx`, `src/app/pos/_ui/QrSheet.tsx` | QR per table, print sheet |
| `src/app/pos/_ui/TablesBoard.tsx`, `TillNav.tsx` | blue state, badge, nav entry |
| `src/ui/cart/CartView.tsx`, `src/ui/cart/SendToWaiter.tsx`, `src/ui/AppProviders.tsx`, `src/lib/messages/{ar,ckb,en}.ts` | the Menu's order button, status panel |
| `src/studio/messages/pos-till/{ar,ckb,en}.ts`, `src/studio/errors.ts` | texts |
| tests: `tests/pos/customer-orders.test.ts`, `customer-order-rules.test.ts`, `qr-order-routes.test.ts`, `isolation.test.ts` (extended), `schema.test.ts`, cross-tenant lists | |

---

### Task 1: Schema, pure rules and cashier-side services

**Files:** Modify `prisma/schema.prisma`, `src/server/data/tenant-db.ts` (add both models to `RESTAURANT_SCOPED_MODELS`), `src/server/domain/audit-actions.ts`, `src/server/pos/board.ts`, `src/server/pos/errors.ts`; Create migration, `src/server/domain/pos/customer-order-rules.ts`, `src/server/pos/customer-orders.ts`; Test `tests/pos/customer-order-rules.test.ts`, `tests/pos/customer-orders.test.ts`, `tests/pos/schema.test.ts`, `tests/pos/board.test.ts`.

**Interfaces — Produces:**
- Prisma: `enum PosCustomerOrderStatus { PENDING ACCEPTED REJECTED }`; `PosCustomerOrder { id, restaurantId, tableId (→PosTable cascade), tableNumber Int, publicId String @unique @default(cuid()), status, customerNote String @default(""), locale String, rejectReason String @default(""), orderId String? (plain), decidedAt DateTime?, decidedByUserId String? (plain), createdAt }` indexes `(restaurantId,status)`, `(tableId,status,createdAt)`; `PosCustomerOrderLine { id, restaurantId, requestId (cascade), productId String? (→Product SetNull), nameSnapshot, unitPriceSnapshot Int, optionsSnapshot Json, promoDiscountPerUnit Int @default(0), quantity Int, note String @default("") }`.
- Pure (`customer-order-rules.ts`): `QR_LIMITS = { pendingPerTable: 3, perTablePer10Min: 5, perRestaurantPerHour: 300, maxLines: 30, maxQuantity: 20, maxNote: 300, expiryMinutes: 60, perIpPerMinute: 10 }`; `isExpired(createdAt: Date, now: Date): boolean`; `promoDiscountPerUnit(base: number, optionsTotal: number, quotedUnit: number): number`.
- Services (`customer-orders.ts`, all take `db: AnyDb, restaurantId`):
  - `type RequestSummary = { id; tableId; tableNumber; createdAt: Date; lineCount: number; total: number }`; `type RequestDetail = RequestSummary & { customerNote; locale; lines: { id; name; quantity; note; options: OptionSnapshot[]; unitPrice; promoDiscountPerUnit; lineTotal }[]; liveOrderId: string | null; liveOrderVersion: number | null }`
  - `listPendingRequests(db, restaurantId, now?): Promise<RequestSummary[]>` (PENDING, not expired, oldest first); `readRequest(db, restaurantId, id, now?): Promise<RequestDetail>`
  - `pendingByTable(db, restaurantId, now?): Promise<Map<string, number>>`
  - `setRequestLineQuantityIn(db, restaurantId, { lineId, quantity })`, `removeRequestLineIn(db, restaurantId, { lineId })`
  - `acceptRequestIn(db, restaurantId, { requestId, userId, expectedOrderVersion?, now? }): Promise<{ orderId; created: boolean; version: number }>`; `rejectRequestIn(db, restaurantId, { requestId, userId, reason })`
  - board: `readBoard` rows gain `pendingRequests: number`; status via `tableStatus(order, { hasPendingRequest })`.
- New `POS_TEXT` sentences: `'The request was already decided'`, `'The request is empty'`, `'The request expired'`.

- [ ] **Step 1: Failing tests (names are the assertions):** rules — `isExpired true at exactly 60 minutes and false at 59:59`, `promoDiscountPerUnit never negative`; services — `accept on a free table opens an OPEN order with the lines, base price and a line discount equal to the promo`, `accept onto a live order with the right version appends and the total equals both`, `accept with missing or stale expectedOrderVersion is refused and the request stays PENDING`, `two concurrent accepts: one wins, the other gets CONFLICT, one order`, `accept vs reject race`, `accept an expired request refused`, `accept an empty request refused`, `edits on a decided request refused`, `quantity above 20 refused`, `a deleted product keeps the line (name snapshot), accepted line has no section`, `a cashier of another restaurant gets NOT_FOUND for every function`, `list is oldest first, hides expired and decided`, `board: free table with a pending request is PENDING_APPROVAL, a busy table keeps its status and carries pendingRequests`, `deleting a table deletes its requests`; schema — `both models require restaurantId and are in the tenant registry` (existing registry test).
- [ ] **Step 2: Run** `npx vitest run tests/pos/customer-order-rules.test.ts tests/pos/customer-orders.test.ts` → FAIL.
- [ ] **Step 3: Implement** schema + migration (`npx prisma migrate dev --name pos_customer_orders` on the private DB; check the SQL by eye), rules, services (reuse `openOrderIn`, `bumpOrder`, `loadOrderForChange`, `chooseForLine` is not needed: options come from the snapshot), board.
- [ ] **Step 4: Run** the touched files + `tests/data/tenant-registry.test.ts` → PASS.
- [ ] **Step 5: Commit** `feat(pos): customer order requests - model, rules and cashier services`.

### Task 2: Guest services and public routes

**Files:** Modify `src/server/pos/customer-orders.ts`; Create `src/app/api/[tenant]/qr-order/route.ts`, `qr-order/[publicId]/route.ts`, `qr-order/availability/route.ts`; Modify `src/server/http/schemas.ts`; Test `tests/pos/qr-order-routes.test.ts`.

**Interfaces — Produces:**
- `qrOrderGate(prisma, tenant: TenantInfo, tableNumber: number, now?): Promise<{ open: true; tableId: string } | { open: false }>` — order of reads: `Subscription` (live) → `PosSettings` (`qrOrderingEnabled`, `catalogMenuId === tenant.id`) → `PosTable` by number; restaurant status ACTIVE.
- `submitCustomerOrder(prisma, tenant, input: { table: number; locale; lines: { productId; variantId: string | null; optionIds: string[]; quantity; note }[]; customerNote }, now?): Promise<{ publicId: string }>`; errors: `GateClosedError` (→404), `QrOrderRefusal(code)` with codes `INVALID_CART | BUNDLES_UNSUPPORTED | TOO_MANY_REQUESTS`.
- `readGuestRequest(prisma, tenant, table, publicId, now?): Promise<{ status: 'PENDING'|'ACCEPTED'|'REJECTED'|'EXPIRED'; rejectReason; lines: { name; quantity; options: string[]; note }[] } | null>`.
- Routes: `POST /api/{slug}/qr-order` body `{ table, locale, cart: { lines, bundles }, note }` (strict) → `201 { publicId }`; `GET /api/{slug}/qr-order/{publicId}?table=n` → `200 status` | 404; `GET /api/{slug}/qr-order/availability?table=n` → `200 { available: boolean }` (never 404; same shape when closed).

- [ ] **Step 1: Failing tests:** `unknown slug, QR off, other catalog menu, lapsed subscription, missing PosTable → 404 for submit and status; availability answers {available:false}`; `submit stores snapshots from the server and rejects a body with a price field (400)`; `product of another menu, sold-out, till soldOutOverride, option of another product, missing required option, 31 lines, quantity 21, 301-char note → 400/INVALID_CART`; `a cart with a bundle → BUNDLES_UNSUPPORTED`; `promo price: request stores promoDiscountPerUnit`; `limits: 4th pending on a table, 6th in 10 minutes, 301st per restaurant per hour → 429`; `after a decision or after 60 minutes the counters free up`; `per-IP: 11th submission in a minute → 429`; `status with the wrong table, wrong slug or another request's publicId → 404; status shows only that request's lines`; `EXPIRED after 60 minutes`; `submit writes an AuditLog row with actorId null`; `120-char Arabic name and 300-char note round trip`.
- [ ] **Step 2: Run** → FAIL. **Step 3: Implement** (use `handleTenantRequest` for POST; GETs use `getTenant` + `admitRequest` 60/min; quote through `getCatalog` + `quoteCart`, reject if `hasBlockingIssues`). **Step 4: Run** → PASS. **Step 5: Commit** `feat(pos): guest QR order endpoints with limits and server pricing`.

### Task 3: Cashier actions and queries

**Files:** Create `src/server/studio/actions/pos-requests.ts`, `src/server/studio/queries/pos-requests.ts`; Modify `src/app/studio/_actions/pos.ts`, `src/studio/errors.ts`, `src/studio/messages/pos-till/*`, `tests/studio/cross-tenant.test.ts`, `tests/pos/permissions.test.ts`; Test `tests/pos/customer-order-actions.test.ts`.

**Interfaces — Produces:** actions `pos.acceptRequest {requestId, expectedOrderVersion?}` → `{orderId, created, version}`, `pos.rejectRequest {requestId, reason}`, `pos.setRequestLineQuantity {lineId, quantity}`, `pos.removeRequestLine {lineId}`; queries `pos.requests` → `RequestSummary[]`, `pos.request {id}` → `RequestDetail`; server functions `acceptPosRequest`, `rejectPosRequest`, `setPosRequestLineQuantity`, `removePosRequestLine`.

- [ ] **Step 1: Failing tests:** `cashier and manager may use every request action, kitchen is refused`; `a cashier of restaurant B gets NOT_FOUND on restaurant A's request`; `a lapsed subscription closes the actions`; `audit rows are written in the same transaction (accept names order, reject names reason)`; `cross-tenant sweep lists the new names`.
- [ ] **Step 2–5:** run → FAIL, implement, run → PASS, commit `feat(pos): cashier request actions and queries`.

### Task 4: Cashier screens (requests, board blue state, QR sheet)

**Files:** Create `src/app/pos/(till)/requests/page.tsx`, `src/app/pos/_ui/RequestsScreen.tsx`, `src/app/pos/(till)/qr/page.tsx`, `src/app/pos/_ui/QrSheet.tsx`; Modify `TablesBoard.tsx`, `TillNav.tsx` (requests entry with count only when QR is on), `src/app/pos/(till)/tables/page.tsx`, messages, print CSS; Test `tests/pos/views.test.ts` additions.

Rules: the requests screen lists cards (table number, age via `formatStamp`/`useNow(start)`, lines with `-`/`+`/remove at 48px, note, total, banner when the table has a live order, Accept (`variant="primary"`) and Reject with an optional reason); it polls (`router.refresh()`) every 5 s while visible and navigates to `/pos/orders/<id>` after accept. The board shows a blue table with a "new order" badge and a count badge on busy tables, links a blue table to `/pos/requests`. The QR page (needs `settings.manage`) shows for every table the big number, the QR image of `{origin}/{slug}/t/{n}` from `src/server/qr/render.ts` and the URL in `dir="ltr"`, with "Print all" (4 per A4 page); it explains why the page is empty (QR off, no catalog menu). With QR ordering off nothing of this shows and nothing polls.

- [ ] Steps: failing view tests (`requests view of a restaurant with QR off is empty and nav hides the entry`, `qr page lists one code per table with the Menu address`) → implement → pass → commit `feat(pos): requests screen, board blue state and QR sheet`.

### Task 5: The Menu's order button and extended isolation

**Files:** Create `src/ui/cart/SendToWaiter.tsx`; Modify `src/ui/cart/CartView.tsx`, `src/ui/AppProviders.tsx` (expose `table`), `src/lib/messages/{ar,ckb,en}.ts` (`qr.*` keys), `tests/pos/isolation.test.ts`; Test `tests/pos/qr-order-routes.test.ts`, e2e check in the browser.

Rules: `SendToWaiter` renders only when `table !== null`, the cart has lines and no bundle, and `GET availability` said `available: true` (fetched once per cart page view). It posts the cart (ids, quantities, no prices), keeps the returned `publicId` in `sessionStorage` per slug (try/catch), clears the cart on success, then polls the status route every 5 s while visible and shows waiting / accepted / rejected (+ reason). Refusals show translated text and keep the cart. No cashier link or chrome on the page.
Isolation test: the logged-statement test adds `GET /t/[table]` page data path (`getTenant`, table lookup), the availability route and a `POST qr-order` for the menu-only restaurant, and asserts zero `"Pos…"` statements; plus a cashier restaurant with QR off issues at most the `Subscription` and `PosSettings` reads and answers `available:false`.

- [ ] Steps: failing isolation/route tests → implement → pass → commit `feat(menu): send-to-waiter button for QR orders and isolation test`.

### Task 6: Verification, review, PR

- [ ] Browser check on a private DB (ar, ckb RTL, en; 375px): guest flow end to end, cashier accept/reject, board blue state, QR sheet print preview.
- [ ] `npm test`, `npx tsc --noEmit`, `npx eslint src` clean; `git diff --stat` shows no whole-file CRLF churn.
- [ ] One whole-branch review by a fresh most-capable reviewer; one fix wave.
- [ ] Push the branch, open the PR to `main` through the prefilled compare URL (`gh` is not installed); PR body states the Neon-branch rehearsal requirement.

## Self-review

- Spec coverage: models with snapshots (T1); limits (rulings 5, T1–T2); requests screen accept/reject (T3–T4); board blue state (T1, T4); QR per table with the Menu's address (T4); order button gated by live subscription + QR switch (T2, T5); isolation test extended to Menu page and quote route (T5); tenant registry and sweep (T1, T3).
- Not in this phase (deferred, ledgered): beep, adding an item inside a request, bundles by QR, rotating a table's QR.
