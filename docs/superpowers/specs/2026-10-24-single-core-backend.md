# One backend for every Buzzify product: Core = this application

Status: proposal, waiting for the owner's approval. No code in this document's phases has been written. Nothing here touches production, `studio.buzzify-menu.online`, or any shared database.

## 0. الخلاصة بالعراقي

- القرار: **تطبيق واحد وقاعدة وحدة** هو Core. هذا التطبيق نفسه (اللي ينشر على `buzzify-menu.online` و`studio.buzzify-menu.online`، مستودع `buzzify-core`) يستضيف المنيو والكاشير والاشتراكات والمطاعم والموظفين. ما يبقى backend للمنيو لحاله ولا backend للكاشير لحاله.
- مستودع `buzzify-business-core` القديم يتوقف (فيه المرحلة الأولى بس، وما نُشر). مستودع `buzzify-restaurant` ينتقل كوده لهذا التطبيق بمراحل ثم يتوقف.
- المنتجات (مواد، تصنيفات، أسعار، إضافات) **جدول واحد**: نفس جداول المنيو. الكاشير يقرأ منها مباشرة. ما يبقى إدخال مزدوج ولا نسخة منفصلة ولا مزامنة.
- طلب الزبون من QR يُكتب مباشرة بجدول طلبات الكاشير بنفس القاعدة وينتظر موافقة الكاشير. ما يحتاج API بين سيرفرين.
- مطعم منيو فقط: يبقى كما هو. مطعم كاشير فقط: عنده كتالوج يديره من الكاشير (منيو غير منشور، ما له صفحة عامة)، ولو اشترك بالمنيو بعدين ينشره بدون إعادة إدخال.
- كل خطوة تنعمل أول على نسخة تجريبية وقاعدة خاصة. النشر على الإنتاج وأي migration عليه بموافقتك الصريحة وبعد نسخة احتياطية.

## 1. What the facts say (verified in both repositories)

| Fact | Consequence |
|---|---|
| The production app is this repository, deployed on Hostinger (`docs/deploy/hostinger.md`), Neon database, GitHub `buzzify-core` (renamed from `buzzify-menu`). | It is already the place the owner wants. We grow it, we do not start another. |
| Billing already lives here: `Application` (`menu`, `cashier`), `PlanPrice`, `Subscription`, `Payment` (by hand), `SubscriptionEvent`, a Billing page in the Studio. | The registry and subscriptions of "Core" exist. |
| The cashier repo uses the same stack and versions: Next 16.4.1, React 19.3.1, Prisma 7.10.0, Better Auth 1.7.10, Zod 4.6.7, Vitest 5.0.5. About 447 tracked files: 43 services, offline layer, kitchen, shifts, inventory, complaints, QR. | No framework port: files move and are adapted, not rewritten. |
| `buzzify-business-core` is milestone 1 only (identity, registry, plans, Super Admin), never deployed. Its billing half was already ported here. | It can stop. |
| The link I built (signing, pairing, catalog feed over HTTP, outbox, import) exists to connect **two** backends. | With one backend most of it is not needed; section 6 says what is kept. |

## 2. Target shape

```
buzzify-core (this app, one Neon database)
├── Registry & billing:  Restaurant, Application, Subscription, Payment            (exists)
├── Identity:            User/Session/Account/TwoFactor, Membership (roles)        (exists; roles extended)
├── Catalog (one source): Menu, Category, Product, ProductVariant, ModifierGroup/Option, translations
├── Menu product:        revisions, publish, QR menu, templates, motions, 3D        (exists)
└── Cashier product:     tables, orders, kitchen, shifts, payments, inventory, offline, complaints   (moved in)
```

Hosts: the Studio and public menus stay as they are. The cashier is served by the same app under its own route group (`/pos`, optionally a host `cashier.buzzify-menu.online` as an alias of the same Node app, the way the Studio already is). One deployment, one build, one set of env.

## 3. The catalog: one table, not a copy

- The cashier's `Category`, `Product`, `OptionGroup`, `Option` are **dropped**; the cashier reads the Menu's `Category`, `Product`, `ProductVariant`, `ModifierGroup`, `ModifierOption`.
- Cashier-only fields live in new small side tables keyed by product: kitchen section, recipe lines, local sold-out override. Nothing is added to `Product` that a menu-only restaurant would notice.
- A restaurant that has only the cashier gets a **catalog menu**: a `Menu` row that is never published (status DRAFT, no slug resolved publicly). The cashier's "products" page edits it. If the restaurant later buys the Menu, the designer publishes the same menu: no re-entry (this is what the cashier spec section 7 asks for).
- Guest-visible vs till-visible: the till shows every non-archived product (including ones hidden from guests, a flag the Menu already has: `isHidden`); guests see the live revision as today. This removes the "cashier-only items" open question of the link contract.
- Prices: the till uses `Product.basePrice` + variant + options (integer IQD). Menu promotions and bundles do not apply at the till in v1 (owner decision pending, same as the link contract).

## 4. Name collisions to resolve (cashier models → this schema)

| Cashier model | In this schema | Decision |
|---|---|---|
| `User`, `Session`, `Account`, `Verification` | same Better Auth tables | One set. Cashier `Staff` becomes `Membership` + a cashier profile (PIN hash, role). New member roles `MANAGER`, `CASHIER`, `KITCHEN` beside `OWNER`, `DESIGNER` (permissions in `domain/permissions.ts` stay the one place). |
| `Business` | `Restaurant` | `Business` fields (service/tax %, enabled payment methods, kitchen/QR/takeaway/delivery/complaints switches, ring minutes) move to a `CashierSettings` row per restaurant. `cashierActive` is replaced by the live `cashier` Subscription (no operator script). |
| `Category`, `Product`, `OptionGroup`, `Option` | exist | merged (section 3). |
| `Payment`, `PaymentReversal` | `Payment` is billing | cashier tables become `PosPayment`, `PosPaymentReversal`. |
| `AuditLog` | `AuditLog` | one table; cashier writes with its own actions through the existing framework. |
| `DiningTable`, `Area`, `Order`, `OrderLine`, `Shift`, `CashExpense`, `CustomerOrder*`, `KitchenSection`, `Delivery*`, `Driver`, `SharedDevice`, `PinAttempt`, `SyncOperation`, inventory and complaint models | no clash except `Table` (menu's QR table) | prefixed `Pos`. The Menu's `Table(menuId, number)` and the cashier's dining table become one concept: the QR table of the restaurant (`PosTable` keeps area, seats, ring state and a `menuTableNumber` link; the Menu's QR code opens `/t/<n>` as today). |

Every new table gets `restaurantId` and goes through the tenant registry test (`tests/data/tenant-registry.test.ts`) so isolation stays enforced by tests, and the Studio framework's enforcement test still forbids bypassing permissions.

## 5. Guest order: direct, no HTTP

The Menu page's order button (when the restaurant has an ACTIVE `cashier` subscription, a catalog menu or published menu, and QR ordering on) calls a server function that validates against the live catalog, prices it on the server, and inserts a `PosCustomerOrder` in the same database. Status polling reads the same row. Limits (3 pending per table, 5 per 10 minutes, 300 per business per hour) and the 60-minute expiry stay as the cashier's plan 4 defines. No signing, no pairing, no outbox.

## 6. What happens to the link code already written (branch `feat/cashier-link`)

| Piece | Fate |
|---|---|
| `domain/link/signing.ts`, `secret.ts`, `pairing-code.ts`, `base-url.ts`; tables `CashierLink`, `CashierPairingCode`, `CashierLinkEvent`, `CashierImportBatch`, `LinkRateLimit` | **Not needed** in a single backend. Not merged; kept on the branch only as a fallback if the owner ever sells the cashier as an independent product against a foreign menu. |
| `domain/link/catalog-feed.ts` | Not needed internally. Kept for a future public API for third parties if wanted. |
| Plan and contract documents | Superseded by this document; the contract stays as history. |
| The facts note `2026-10-24-cashier-link-menu-side.md` | Still correct as a description of the menu. |

Honest cost: about a day of work becomes unused. It was the right step while the owner's decision was "two products that connect"; the decision changed.

## 7. Phases (each ends with tests green on a private database; nothing deploys without approval)

1. **Foundation (this app).** Extend member roles and permissions for MANAGER/CASHIER/KITCHEN; `CashierSettings`; the `Application` row `cashier` becomes ACTIVE only through the existing billing screens; a `/pos` route group with the cashier's layout and sign-in (Better Auth, same users). Tests: permissions, isolation, a menu-only restaurant sees nothing new.
2. **Catalog unification.** Side tables (kitchen section, recipes, sold-out override); the catalog menu for cashier-only restaurants; the cashier's setup pages (categories, products, options) rewritten to edit the Menu's tables through the existing Studio services (draft edit framework). Import of the cashier's CSV (`lib/menu-csv`) onto them.
3. **Tables, orders, payments, shifts.** Move the cashier's plans 1 to 3 (tables floor, manual orders, cash, shifts, kitchen) onto `Pos*` tables and the unified catalog; port services and tests file by file (the cashier's `tests/services` run against this schema).
4. **QR orders.** Plan 4 on the Menu's public pages (section 5), with the existing `/t/<n>` QR as the entry; the cashier's own `/m/<token>` page is dropped (one QR, one page).
5. **Takeaway, delivery, offline sync, payments variety, roles, inventory, complaints** (cashier plans 5 to 9) in that order, each a port plus tests.
6. **Cut-over.** Data: the cashier has no production data yet, so nothing is migrated; if a development database matters, a one-off script reads it into the new tables. Then archive `buzzify-restaurant` and `buzzify-business-core`.
7. **Production.** Backup of Neon, a Neon branch rehearsal of every migration, then deploy on the owner's explicit word. `migrate deploy` on the production database is a separate approval.

Each phase is its own plan under `docs/superpowers/plans/` written when the previous one is done. Phases 1 and 2 are the first thing to plan in detail.

## 8. Risks

- **Size.** The cashier is ~450 files and nine plans of behaviour. Porting is mechanical but long; tests move with the code and are the safety net.
- **Production menu.** The menu keeps running during the move; every migration is additive, with no change to existing menu tables. A new test asserts that the existing public pages and Studio screens run no cashier code for a menu-only restaurant.
- **Collisions and isolation.** Section 4; the registry test fails the build on an unclassified model.
- **Offline cashier.** The offline layer talks HTTP to the same origin, so it moves unchanged; sync endpoints are re-pointed to the unified services.
- **Two repos meanwhile.** Until phase 6 the cashier repo keeps working on its own database; the cashier sessions must be told to stop adding features there once phase 3 starts, or the port chases a moving target.

## 9. Decisions for the owner

1. Approve this app (`buzzify-core`) as the one backend, and `buzzify-business-core` stopping. (Recommended.)
2. Cashier-only restaurants keep their catalog in an unpublished menu (section 3). OK?
3. One QR per table, opening the Menu's page (`/t/<n>`); the cashier's own customer page is dropped. OK?
4. The cashier's staff become members of the restaurant in the same user table, with PIN login on shared devices. OK?
5. Promotions and bundles apply at the till? (not in v1 unless the owner says so).
6. Freeze: the cashier repo stops getting new features once phase 3 begins.
