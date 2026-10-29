# Captain Role Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a `CAPTAIN` POS role, a per-restaurant "captain approves guest orders" switch, captain-placed orders, and a guest "I want my bill" call seen by the captain and the cashier together.

**Architecture:** Guest orders stay `PosCustomerOrder` rows. A snapshot flag `requiresCaptain` is stamped at submit time from the new `PosSettings.captainApproval`; `captainApprovedAt` releases the row. `acceptRequestIn` (server side) refuses while `requiresCaptain && captainApprovedAt === null`, so no screen, API or sync path can bypass it. Bill calls are a new small table, `PosBillCall`, plus the existing `BILL_REQUESTED` order state.

**Tech Stack:** Next.js (see `AGENTS.md` notice before touching routes), Prisma + Postgres, zod, `defineAction` framework, vitest (`tests/pos/*`, helpers in `tests/pos/fixture.ts`).

**Spec:** `docs/superpowers/specs/2026-10-28-captain-role-design.md`

## Global Constraints

- Work in a fresh worktree/branch `captain-role` (not `security-hardening`); see memory "worktree-setup" (npm ci, own `BUZZIFY_DB_PORT`, `next-env.d.ts`).
- Switch off (default) must leave every existing behaviour and test unchanged.
- No motion at all in cashier/captain screens; the captain's look must follow the cashier's layout (project memory: cashier-no-motion).
- Strings in three catalogs: `src/studio/messages/{ar,ckb,en}.ts` and `pos-till/` equivalents. Arabic is the primary review language.
- The approval rule lives in the server (`acceptRequestIn`), never only in a screen.
- Cashier never holds `request.approve`. Manager and Owner do (spec assumption 1).
- Every changed state is audited with `ctx.audit({...})` like the neighbouring actions.
- Run `graphify update .` after code changes; lint `src`, not `.`.

## Review Focus

1. Switch flipped off while orders wait for the captain: waiting rows keep `requiresCaptain=true` (snapshot) and still need approval; new rows do not.
2. Switch flipped on while a plain pending order exists: that row has `requiresCaptain=false` and is unaffected.
3. Two people approve or one approves while the other rejects at once: only one decision wins (same `updateMany` guard style as accept/reject).
4. Bill call on a table with no live order, with a PAID/CANCELLED order, and spammed repeatedly: one open call per table, no state corruption.
5. Captain edits a request that already expired (60 min) or was decided: refused like the cashier's edit today.

---

### Task 1: CAPTAIN role, permissions, navigation

**Files:**
- Modify: `prisma/schema.prisma` (enum `PosRole`: add `CAPTAIN`); create migration `prisma/migrations/20261029140000_captain_role/migration.sql` (`ALTER TYPE "PosRole" ADD VALUE 'CAPTAIN'`)
- Modify: `src/server/domain/pos/permissions.ts` (`POS_ROLES`, `POS_PERMISSIONS`, `MATRIX`)
- Modify: `src/server/domain/pos/nav.ts` (`TILL_PAGES`, landing function near line 56, `tillNav`)
- Modify: `src/app/pos/_ui/RolesMatrix.tsx`, `src/app/pos/(till)/staff/StaffForms.tsx` (role pickers/labels), message catalogs
- Test: `tests/pos/permissions.test.ts`, `tests/pos/domain/` nav test (follow the existing nav test file if present)

**Interfaces:**
- Produces: `PosRole` includes `'CAPTAIN'`; permissions `'request.handle'`, `'request.approve'`, `'captain.order'`; nav page key `'captain'` (href `/pos/captain`, permission `captain.order`).

- [ ] **Step 1: Write failing tests.** `canPos('CAPTAIN','request.approve') === true`; `canPos('CAPTAIN','payment.take') === false`; `canPos('CAPTAIN','report.view') === false`; `canPos('CASHIER','request.handle') === true`; `canPos('CASHIER','request.approve') === false`; `canPos('KITCHEN','request.handle') === false`; `canPos('MANAGER','request.approve')` and `OWNER` true; `tillNav('CAPTAIN',{qrOrdering:true})` keys equal `['captain','requests']`; landing page for `CAPTAIN` is `'captain'`.
- [ ] **Step 2: Run** `npx vitest run tests/pos/permissions.test.ts` — expect FAIL.
- [ ] **Step 3: Implement.** Matrix: `CAPTAIN: ['request.handle','request.approve','captain.order','pin.own']`; add `'request.handle'` to `CASHIER`. Change the `requests` page permission in `TILL_PAGES` from `order.handle` to `request.handle`; add `{ key:'captain', href:'/pos/captain', permission:'captain.order' }`. The captain page is listed even when QR ordering is off (the captain can still order by mouth); `requests` stays `needsQr`. Add `CAPTAIN` to the role pickers and the matrix view.
- [ ] **Step 4: Migrate and run** `npx prisma migrate dev --name captain_role`, then `npx vitest run tests/pos/permissions.test.ts tests/pos/domain` — expect PASS.
- [ ] **Step 5: Commit** `feat(pos): add the captain role and its permissions`.

### Task 2: The switch (`captainApproval`) and approval state on guest orders

**Files:**
- Modify: `prisma/schema.prisma`: `PosSettings.captainApproval Boolean @default(false)`; `PosCustomerOrder`: `requiresCaptain Boolean @default(false)`, `captainApprovedAt DateTime?`, `captainApprovedByUserId String?` (plain id), `createdByUserId String?` (set when a captain placed it). Migration `20261029141000_captain_approval`.
- Modify: `src/server/pos/settings.ts` (type `PosSettingsView`, defaults, row mapper near lines 17/45/70/96), `src/server/studio/actions/pos.ts` (`pos.updateSettings` input: `captainApproval: z.boolean().default(false)`), `src/app/pos/(till)/settings/SettingsForm.tsx` (add `['captainApproval','pos.settings.captainApproval']` to the switch list)
- Create: `src/server/studio/actions/pos-captain.ts` with `setPosCaptainApproval` (`name:'pos.setCaptainApproval'`, `permission` = the Studio permission the neighbouring `pos-ai.ts` Super Admin action uses, input `{restaurantId, enabled}`, audited); `src/app/studio/(studio)/(app)/cashier/CaptainApprovalControl.tsx` modelled on `AiPackageControl.tsx`, mounted on `cashier/page.tsx`; extend `posOverview` in `src/server/studio/queries/pos.ts` with `captainApproval: boolean`.
- Test: `tests/pos/captain-settings.test.ts`

**Interfaces:**
- Produces: `PosSettings.captainApproval`; `PosCustomerOrder.requiresCaptain/captainApprovedAt/captainApprovedByUserId/createdByUserId`.

- [ ] **Step 1: Failing tests.** Manager sets `captainApproval:true` via `pos.updateSettings` and it reads back true; a cashier is refused; a Super Admin sets it via `setPosCaptainApproval`; an Owner (membership) can; default for a new restaurant is false; the change is audited.
- [ ] **Step 2: Run** `npx vitest run tests/pos/captain-settings.test.ts` — FAIL.
- [ ] **Step 3: Implement** the schema, migration, settings mapper, action, form switch and Studio control. Copy catalog strings: `pos.settings.captainApproval` and `cashierOverview.captain*` in ar/ckb/en.
- [ ] **Step 4: Run** the test again plus `npx vitest run tests/pos/settings*` — PASS.
- [ ] **Step 5: Commit** `feat(pos): captain approval switch for owners, managers and the super admin`.

### Task 3: Server-side approval gate, approve action, captain edits

**Files:**
- Modify: `src/server/pos/customer-orders-guest.ts` (`submitCustomerOrder`: read `captainApproval` in the same transaction that locks `posSettings` and write `requiresCaptain` on the created row; `GuestRequestView` gets `awaitingCaptain: boolean`, computed in `readGuestRequest`)
- Modify: `src/server/pos/customer-orders.ts`: add `approveRequestIn(db, restaurantId, input:{requestId:string;userId:string}, now?: Date)`; add `addRequestLineIn(db, restaurantId, input:{requestId:string;productId:string;quantity:number;note?:string}, now?: Date)` (prices from the catalog as `submitCustomerOrder` does; refuse sold-out; respects `QR_LIMITS.maxLines/maxQuantity`); in `acceptRequestIn` refuse with `refuse('CONFLICT','Waiting for the captain')` when `requiresCaptain && captainApprovedAt === null` — checked inside the same guarded update, before any order is touched; extend `RequestSummary` with `awaitingCaptain: boolean` and `RequestDetail` lines unchanged.
- Modify: `src/server/studio/actions/pos-requests.ts`: `setPosRequestLineQuantity`, `removePosRequestLine`, `rejectPosRequest` change `pos: 'order.handle'` to `'request.handle'`; add `approvePosRequest` (`pos:'request.approve'`, audit `pos.request.approve`) and `addPosRequestLine` (`pos:'request.handle'`). `acceptPosRequest` stays `order.handle`.
- Test: `tests/pos/captain-approval.test.ts` (reuse the fixture setup of `tests/pos/customer-orders.test.ts`)

**Interfaces:**
- Consumes: Task 2 columns; Task 1 permissions.
- Produces: `approveRequestIn`, `addRequestLineIn`, actions `approvePosRequest`, `addPosRequestLine`.

- [ ] **Step 1: Failing tests.** (a) switch off: guest order accepted by cashier exactly as before. (b) switch on: row has `requiresCaptain=true`; cashier `acceptPosRequest` is refused with CONFLICT and no `PosOrder` is created; captain `approvePosRequest` succeeds, then cashier accept succeeds. (c) cashier calling `approvePosRequest` is FORBIDDEN; manager succeeds. (d) captain `setPosRequestLineQuantity`, `removePosRequestLine`, `addPosRequestLine`, and `rejectPosRequest` work on a waiting row; replace = remove + add. (e) switch turned off after submit: the waiting row still needs approval; a row submitted after is free. (f) approve twice, and approve-after-reject: second call fails and nothing changes. (g) expired row (advance `now` past `QR_LIMITS.expiryMinutes`): approve and edits refused. (h) guest `readGuestRequest` shows `awaitingCaptain:true` until approval. (i) a captain calling `acceptPosRequest` is FORBIDDEN (no `order.handle`).
- [ ] **Step 2: Run** `npx vitest run tests/pos/captain-approval.test.ts` — FAIL.
- [ ] **Step 3: Implement** the functions and actions above. `approveRequestIn` uses one `updateMany` guarded by `waiting(now)` and `requiresCaptain:true, captainApprovedAt:null`, then `whyNotPending` for the error, like `rejectRequestIn`.
- [ ] **Step 4: Run** the new test and `npx vitest run tests/pos/customer-orders.test.ts tests/pos/qr-order-routes.test.ts` — all PASS.
- [ ] **Step 5: Commit** `feat(pos): captain approval gate on guest orders`.

### Task 4: Captain places an order by mouth

**Files:**
- Modify: `src/server/pos/customer-orders.ts`: `createCaptainRequestIn(db, restaurantId, input:{userId:string;tableNumber:number;lines:{productId:string;quantity:number;note?:string}[];note?:string}, now?: Date): Promise<{requestId:string}>` — creates a `PosCustomerOrder` with `requiresCaptain:false`, `captainApprovedAt:now`, `captainApprovedByUserId:userId`, `createdByUserId:userId`, `locale` of the restaurant; same line pricing and limits as `addRequestLineIn`; table must exist.
- Modify: `src/server/studio/actions/pos-captain.ts`: add `placeCaptainOrder` (`name:'pos.placeCaptainOrder'`, `pos:'captain.order'`, target `CATALOG`, audited `pos.request.captain`). Works even when `qrOrderingEnabled` is off? No: the requests list is only shown with QR ordering (`needsQr`), so the action returns a clear refusal `QR_OFF` when `qrOrderingEnabled` is false and the captain page shows a hint.
- Test: `tests/pos/captain-order.test.ts`

**Interfaces:**
- Consumes: `addRequestLineIn` line-pricing helper from Task 3 (extract a shared `priceLines` function there).
- Produces: `createCaptainRequestIn`, `placeCaptainOrder`.

- [ ] **Step 1: Failing tests.** Captain order appears in `posRequests` with `awaitingCaptain:false`; cashier accepts it and a `PosOrder` with the lines exists; unknown table, empty lines, sold-out product and over-limit quantity are refused; a cashier cannot call `placeCaptainOrder`; works with `captainApproval` on and off; QR ordering off is refused.
- [ ] **Step 2: Run** `npx vitest run tests/pos/captain-order.test.ts` — FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** it plus `tests/pos/customer-orders.test.ts` — PASS.
- [ ] **Step 5: Commit** `feat(pos): captain orders for a table by mouth`.

### Task 5: Bill call (guest button, captain and cashier notice)

**Files:**
- Modify: `prisma/schema.prisma`: `model PosBillCall { id, restaurantId, tableId, tableNumber Int, createdAt, seenAt DateTime?, seenByUserId String?; @@index([restaurantId, seenAt]) }` + migration `20261029142000_bill_call`.
- Create: `src/server/pos/bill-calls.ts`: `callForBill(prisma, tenant, input:{table:number}, now?: Date): Promise<{ok:true}>` (uses `qrOrderGate`; if an unseen call exists for the table returns ok without a new row; at most 3 calls per table in 10 minutes else `QrOrderRefusal('TOO_MANY_REQUESTS')`; if the table has a live OPEN/READY order, moves it to `BILL_REQUESTED` using `loadOrderForChange` + `bumpOrder` with the freshly read version; other states leave the order alone); `listOpenBillCalls(db, restaurantId): Promise<{id:string;tableNumber:number;createdAt:Date}[]>`; `markBillCallSeenIn(db, restaurantId, input:{id:string;userId:string})`.
- Create: `src/app/api/[tenant]/bill-call/route.ts` (POST `{table:int}`, same per-address limit and error mapping as `qr-order/route.ts`).
- Modify: `src/server/studio/actions/pos-captain.ts`: `markBillCallSeen` (`pos:'request.handle'`, audited). `src/server/studio/queries/pos-requests.ts` (or `qr-sheet.ts` `posQrFlags`): include `billCalls` count so the nav badge adds it.
- Modify: the guest table menu (`src/app/[tenant]/[locale]/t/[table]/page.tsx` and the cart/QR-order UI that shows the order status; find it with `graphify query "guest qr order status UI"`): add a "Bill" button, shown only when QR ordering is open for that table, with success and too-many states and strings in all three menu locales.
- Test: `tests/pos/bill-call.test.ts`, extend `tests/pos/qr-order-routes.test.ts` style for the route.

**Interfaces:**
- Consumes: `qrOrderGate`, `QrOrderRefusal` from `customer-orders-guest.ts`.
- Produces: `callForBill`, `listOpenBillCalls`, `markBillCallSeenIn`, action `markBillCallSeen`.

- [ ] **Step 1: Failing tests.** Call on a table with an OPEN order sets it `BILL_REQUESTED` and creates one unseen call; second call creates none; call on a table with no live order creates a call and no order; PAID/CANCELLED orders untouched; 4th call within 10 minutes (after marking earlier ones seen) refused; `markBillCallSeen` by captain and by cashier works, by kitchen FORBIDDEN; closed gate (QR off or unknown table) refused; works identically with `captainApproval` on and off; route returns 429 style refusal like the order route.
- [ ] **Step 2: Run** `npx vitest run tests/pos/bill-call.test.ts` — FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** it plus `tests/pos/orders.test.ts tests/pos/kitchen.test.ts` — PASS.
- [ ] **Step 5: Commit** `feat(pos): guests can ask for the bill`.

### Task 6: Screens (captain page, requests screen, guest status text)

**Files:**
- Create: `src/app/pos/(till)/captain/page.tsx` and `src/app/pos/_ui/CaptainScreen.tsx`: server page gated by `captain.order`; lists tables with their waiting requests awaiting approval, open bill calls (with "seen" button), and a "new order" form (table number + product picker from the till catalog, quantity, note) calling `placeCaptainOrder`. Follow the layout and components of `TablesBoard.tsx` and `RequestsScreen.tsx`; no motion.
- Modify: `src/app/pos/_ui/RequestsScreen.tsx`: for rows with `awaitingCaptain`: label "waiting for captain"; for holders of `request.approve` show "Approve"; for others (cashier) disable accept with that label; always show open bill calls on top with "seen"; captain can edit lines (quantity, remove, add, replace), reject. `src/app/pos/(till)/layout.tsx` badge: `pendingRequests + billCalls`.
- Modify: the guest order status view (where `readGuestRequest` is shown): when `awaitingCaptain`, show the "with the captain" line from the menu locale files.
- Test: component/model tests in the style of `tests/pos/pay-panel-model.test.ts` (keep logic in a pure model file `src/lib/pos-requests-model.ts` exporting `requestActions(role, request): {approve:boolean;accept:boolean;edit:boolean;reject:boolean}`); e2e smoke only if the repo's existing pos e2e setup makes it cheap.

**Interfaces:**
- Consumes: actions from Tasks 3-5, `RequestSummary.awaitingCaptain`.
- Produces: `requestActions` pure model.

- [ ] **Step 1: Failing model tests.** `requestActions('CASHIER',{awaitingCaptain:true})` → accept false, approve false, edit true, reject true; `('CASHIER',{awaitingCaptain:false})` → accept true; `('CAPTAIN',{awaitingCaptain:true})` → approve true, accept false, edit true; `('MANAGER',{awaitingCaptain:true})` → approve true, accept false until approved; `('KITCHEN',…)` → all false.
- [ ] **Step 2: Run** the new test file — FAIL.
- [ ] **Step 3: Implement** the model, then the screens against it; add all strings in ar/ckb/en (Arabic first).
- [ ] **Step 4: Run** `npx vitest run tests/pos`, `npx tsc --noEmit`, `npx eslint src`; then use the preview (`preview_start`) to walk it: switch on, guest order, cashier sees locked, captain approves, cashier accepts; check Arabic RTL and a phone width. Take a screenshot as proof.
- [ ] **Step 5: Commit** `feat(pos): captain screen and approval states in the requests screen`.

### Task 7: Offline-sync guard and isolation sweep

**Files:**
- Inspect: `src/lib/pos-sync/op-schema.ts`, `src/server/pos/sync.ts`, `sync-operation.ts` — confirm no sync operation can accept a customer request. If one exists, route it through the same guard.
- Test: `tests/pos/captain-isolation.test.ts`, extend `tests/pos/isolation.test.ts` and `tests/studio/cross-tenant.test.ts` patterns.

- [ ] **Step 1: Failing/guarding tests.** A captain of restaurant A cannot approve, edit, see bill calls or place orders for restaurant B; a bill call of B is invisible to A; no sync op type accepts a request (assert on the op schema's list of kinds).
- [ ] **Step 2: Run** `npx vitest run tests/pos/captain-isolation.test.ts` — FAIL or, for the sync assertion, PASS by construction; fix any leak found.
- [ ] **Step 3: Full verification:** `npx vitest run`, `npx tsc --noEmit`, `npx eslint src`, `graphify update .`; confirm `git diff --stat` shows no whole-file CRLF churn (memory: crlf-commit-trap).
- [ ] **Step 4: Commit** `test(pos): captain isolation and sync guard`.

---

## Self-review notes

- Spec coverage: role (T1), switch for SA/Owner/Manager (T2), simultaneous visibility and cashier lock (T3, T6), edits/cancel (T3), captain by mouth (T4), bill call to both (T5), assumptions 1-5 (T3 manager approval; T6 captain screen lists all tables; T5 seen mark and rate limit; T6 guest text; "no captain on shift" works because Manager/Owner approve).
- Names used across tasks: `requiresCaptain`, `captainApprovedAt`, `approveRequestIn`, `addRequestLineIn`, `createCaptainRequestIn`, `callForBill`, `markBillCallSeenIn`, `requestActions`, permissions `request.handle`/`request.approve`/`captain.order`.
- Known open call for the executor: if the guest menu's order UI lives in several template bodies, add the bill button once in the shared place, not per style.
