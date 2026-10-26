# Cashier inside Core: the unified plan (phases 3 to 8)

**Replaces:** the separate roadmap `2026-10-23-cashier-roadmap.md` and the eleven plans written in `buzzify-restaurant` (1, 1-b, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11), for everything that still has to be built. Those plans stay as the description of the behaviour; this document says how each lands in this app and in what order.
**Spec:** `docs/superpowers/specs/2026-10-24-single-core-backend.md` (one app, one database) and `docs/superpowers/specs/2026-10-23-cashier-design.md` (the behaviour).
**Status when written (2026-10-24):** phases 1 and 2 of the single-Core spec are done, merged and on production (`1ce0061`): roles and the subscription gate, settings and staff, one catalog menu per restaurant, the till catalog page, CSV import, and the Super Admin **Cashier** area (`/studio/cashier`).

## 0. الخلاصة بالعراقي

- **الهدف النهائي (كلام المالك):** الكاشير كله ينتقل لـ Core ويصعد أونلاين. الصعود يتم مرحلة بمرحلة، وكل صعود على الإنتاج بموافقة المالك بعد بروفة الـ migration على فرع Neon.
- كل خطط الكاشير الإحدى عشر تتحول لمسار واحد داخل Core، مرتب بمراحل: 3 (طاولات وطلبات ودفع وورديات ومطبخ)، 4 (طلب QR)، 5 (سفري وتوصيل)، 6 (أوفلاين)، 7 (دفع بالتيرمنال وأدوار وPIN)، 8 (مخزون وشكاوى)، 9 (الذكاء الاصطناعي، اختياري).
- الخطة 10 (ربط المنيو بالكاشير عبر API) **تُلغى**: صارت بقاعدة واحدة، والمنتجات جدول واحد وقد أنجزناه بالمرحلة 2.
- قسم Cashier عند السوبر أدمن هو البوابة: كل ميزة تنضاف تظهر فيه (اشتراك، موظفين، حالة الإعداد، ثم أرقام الاستخدام).
- الكود موجود وجاهز بمستودع `buzzify-restaurant` (201 commit): ننقله خدمة خدمة مع اختباراته، مو نكتبه من جديد.
- قبل بدء المرحلة 3 لازم قرارات المالك بقسم 6.

## 1. Where each cashier plan lands

| Cashier plan (in `buzzify-restaurant`) | Tasks | Core phase | What changes in the port |
|---|---|---|---|
| 1 Foundation: totals, table states, orders, cash payment, tables board, setup | 11 | **3** | `Business` becomes `Restaurant`; products come from the catalog menu (done in phase 2), so its Task 6 product setup and Task 11 setup page are dropped; tables, orders, payments move to `Pos*` tables. |
| 1-b Staff, setup editing, receipt, menu CSV import, README | 9 | **3** (receipt, per-line discount, move table) | Staff and CSV import are already done in phase 2; README and deploy notes are not needed (one app). |
| 2 Shifts, cash drawer, daily report | 8 | **3** | Tables `PosShift`, `PosCashExpense`; `PosPayment.shiftId`. |
| 3 Kitchen: sections, ticket, screen, cancellation notice | 5 | **3** | Kitchen sections already exist (phase 2 side table); port the send/ready/notice services and screen. |
| 4 QR menu and customer orders | 4 | **4** | Customer order is written straight into `PosCustomerOrder` by a server function on the Menu's own page; the cashier's own `/m/<token>` page is dropped (one QR per table, the Menu's `/t/<n>`). |
| 5 Takeaway and delivery | 7 | **5** | Port as is: `OrderKind.DELIVERY`, zones, drivers (`PosDeliveryZone`, `PosDriver`). |
| 6 Offline (queue, sync, conflicts) | 8 | **6** | The sync route and the service worker move unchanged in shape; the endpoint is re-pointed at the unified services; the service worker must not cache Studio pages. |
| 7 Terminal payments, refunds, roles, PIN | 8 | **7** | `cashierActive` and its operator script are not ported (the live `cashier` subscription is the gate); PIN extends the staff model of phase 1. |
| 8 Inventory, suppliers, purchases, cost report | 9 | **8** | Recipes tie to the Menu's `Product` through a side table. |
| 9 Complaints box | 7 | **8** | Public pages move under the Menu's host routes. |
| **10 Menu link (cashier half)** | 10 | **cancelled** | Replaced by the single catalog and the direct guest order. The link code (signing, pairing, feed) stays only on the branch history. |
| 11 Buzzify AI package (optional) | 10 | **9** | A separate package behind a per-restaurant switch, after everything else is stable. |

Total still to port: about 85 tasks across seven phases.

## 2. Phases

### Phase 3: tables, orders, payments, shifts, kitchen (cashier plans 1, 1-b, 2, 3)

- Tables `PosArea`, `PosTable`, `PosOrder`, `PosOrderLine`, `PosPayment`, `PosShift`, `PosCashExpense`; kitchen state on the order lines (`sentAt`, `batch`, `readyAt`).
- Pure money and table-state functions move first (they have no database); then services one file at a time, each with its tests running against this schema.
- Every service becomes a Studio-framework action or query with the `pos` permission and the `{ kind: 'pos' }` target (phase 1 pattern), audit in the same transaction.
- Screens under `/pos`: tables board (time rings), order screen, payment, shift, daily report, kitchen screen, receipt and kitchen ticket print.
- Exit check: a cashier opens a shift, takes an order for a table, sends it to the kitchen, the cook marks it ready, the cashier pays cash, closes the shift and the daily report matches.

### Phase 4: QR orders (plan 4)

- `PosCustomerOrder(+Line)` with price and name snapshots, limits (3 pending per table, 5 per 10 minutes, 300 per restaurant per hour, expiry 60 minutes), the cashier requests screen, board blue state, QR setup per table.
- The Menu page's order button works only when the restaurant has a live `cashier` subscription and QR ordering on; a menu-only restaurant is unchanged (the isolation test of phase 2 extended to the Menu page).

### Phase 5: takeaway and delivery (plan 5)

### Phase 6: offline (plan 6)

- `PosSyncOperation` (exactly-once by `operationId`), `/api/pos/sync`, IndexedDB queue, service worker scoped to `/pos`.
- Server stays the authority on order state (spec 17).

### Phase 7: terminal payments, refunds, roles, PIN, final settings (plan 7)

### Phase 8: inventory, suppliers, purchases, complaints (plans 8, 9)

### Phase 9: the AI package (plan 11), only if the owner still wants it then.

### Phase 10: cut-over and production

- The cashier repo has no production data, so nothing is migrated.
- Archive `buzzify-restaurant` and `buzzify-business-core` only after the owner confirms the till works in Core.
- Production steps follow `docs/deploy/hostinger.md`: a Neon snapshot, a rehearsal of every new migration on a Neon branch, then a deploy on the owner's explicit word. A push to `main` already runs `prisma migrate deploy` on production, so **every phase is merged to `main` only after its rehearsal**.

## 3. How a phase is run

1. Write the detailed plan for the phase (files, signatures, tests) from the cashier plan's text and the real code of the previous phase.
2. Port in the cashier plan's task order; tests move with the code and must pass on the private database before the next task.
3. One final whole-branch review, then one fix wave.
4. Merge to `main` locally; push and production steps only on the owner's word.

## 4. Constraints for every phase

- No push, deploy or production change without the owner's explicit word; no migration on the shared 54329; the private database per worktree.
- Money in integer IQD; no invented financial data; no payment gateway for Buzzify subscriptions.
- ar / ckb / en trees identical, RTL logical CSS, touch targets at least 48px.
- A menu-only restaurant must run no cashier code (tested).
- Every new table carries `restaurantId` and is listed in the tenant registry; every definition is covered by the cross-tenant sweep.
- The cashier repo is frozen from the start of phase 3.

## 5. Review Focus

- A restaurant with a menu only: no `Pos*` query on public pages, the quote route or the Studio overview (the isolation test grows with each phase).
- A cashier of restaurant A and a designer of restaurant B: no leak either way (the cross-tenant sweep).
- A payment taken twice (double tap, offline replay): one payment (idempotency by `operationId`).
- An order paid while the subscription lapses: the open shift can be closed and reported; new shifts cannot open.
- A 1,000-product catalog and a 200-table floor: the board and order screen stay fast.

## 6. Decisions the owner must make before phase 3

1. **Draft rows at the till:** the till currently reads draft catalog rows (the unpublished catalog menu). Keep, or require publish?
2. **Promotions and bundles** from the Menu: not at the till in v1, unless the owner says so.
3. **QR:** one QR per table opening the Menu's page; the cashier's own customer page is dropped. OK?
4. **Staff model:** email and password accounts plus a PIN for shared tablets (phase 7). OK?
5. **Freeze** the `buzzify-restaurant` repo from the start of phase 3.
6. **Product editor limit:** sizes, options and photos stay in the Studio editor; the till edits names, prices, categories, availability and kitchen section. OK for v1?
7. **AI package** (plan 11): keep as phase 9, or drop?

## 7. Not in this plan

Splitting a bill, coupons, driver map tracking, extra themes, online payment from the guest's phone (spec section 3): later projects.
