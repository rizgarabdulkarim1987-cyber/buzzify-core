# Cashier Printing Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Silent printing on any ESC/POS thermal printer, cash drawer kick, barcode scanning and a kitchen Expo screen for the Menu POS.

**Architecture:** Pure modules turn a document (`PaperRow[]`) into ESC/POS bytes (raster image, so Arabic and Kurdish work on any model). A zero-dependency local print bridge forwards raw bytes to a TCP printer or a Windows-shared USB printer. Printers are restaurant data in `PosPrinter`; the till draws rows on a canvas and posts bytes to the bridge after a payment is saved.

**Tech Stack:** Next.js, Prisma 7 (hand-written SQL migrations), vitest in `tests/pos`, Studio action framework, Node `net`/`http` for the bridge.

**Spec:** `docs/superpowers/specs/2026-10-28-cashier-printing-design.md`

## Global Constraints

- Tests run with `BUZZIFY_DB_PORT=54351` after `npm run db:up`; never `prisma migrate deploy` (it hits the shared DB). `npx prisma generate` is fine.
- `refuse(code, text)` texts are registered in `POS_TEXT` (`src/server/pos/errors.ts`) and as `error.text.*` in all three `src/studio/messages/pos-till/{en,ar,ckb}.ts`; screen keys go in `src/studio/messages/{en,ar,ckb}.ts`. `tests/studio/messages.test.ts` enforces translations.
- No motion at all in the cashier. Browser print stays as fallback.
- Printing never blocks or undoes a sale.
- Commits end with `Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>`.

## Review Focus

- Arabic/Kurdish rows with LTR numbers, on 58 mm (384 dots) and 80 mm (576 dots).
- Width not a multiple of 8; an all-white document; a very tall document (banded raster).
- Bridge down / printer off / timeout: sale stays paid, retry offered.
- Cash payment kicks the drawer once; card-only never; each cash part of a split bill.
- Barcode scan while typing in a field; leading zeros; duplicate code refused at save.
- A section with no printer; a printer deleted while a section points at it.

---

### Task 1: Paper document model and ESC/POS builder

**Files:**
- Create: `src/server/domain/pos/paper.ts`, `src/server/domain/pos/escpos.ts`
- Test: `tests/pos/escpos.test.ts`

**Interfaces:**
- Produces in `paper.ts`: `type PaperRow = { kind: 'text'; align: 'start'|'center'|'end'; left: string; right?: string; size?: 1|2; bold?: boolean } | { kind: 'rule' } | { kind: 'gap' } | { kind: 'barcode'; value: string }`; `type PaperDoc = { rows: PaperRow[]; copy?: boolean }`.
- Produces in `escpos.ts`: `packRaster(rgba: Uint8ClampedArray, width: number, height: number): { widthBytes: number; height: number; data: Uint8Array }` (threshold on luminance < 128 → black bit, MSB first, width padded to a multiple of 8, transparent counts as white); `rasterJob(bitmap, opts: { cut: boolean; drawerPin: 2|5|null }): Uint8Array` returning `ESC @`, banded `GS v 0 0 xL xH yL yH …` (256 lines per band), feed, optional `GS V 66 3` cut, optional `ESC p m 60 120` kick (`m` 0 for pin 2, 1 for pin 5); `drawerKickOnly(pin: 2|5): Uint8Array`; `PAPER_DOTS = { 58: 384, 80: 576 }`.

- [ ] **Step 1: Write failing tests** in `tests/pos/escpos.test.ts`: `packRaster` of a 10×1 image with pixels 0 and 9 black gives `widthBytes` 2 and `data` `[0b10000000, 0b01000000]`; a fully transparent 8×2 image gives all-zero data; `rasterJob` starts with `[0x1b,0x40]`, contains `[0x1d,0x76,0x30,0x00]`, a 600-line bitmap yields 3 raster commands (256+256+88) whose `yL/yH` encode those heights; `cut: true` ends with `[0x1d,0x56,0x42,0x03]`; `drawerPin: 2` contains `[0x1b,0x70,0x00,0x3c,0x78]` and pin 5 contains `[0x1b,0x70,0x01,0x3c,0x78]`; `drawerKickOnly(2)` is exactly those 5 bytes.
- [ ] **Step 2: Run** `BUZZIFY_DB_PORT=54351 npx vitest run tests/pos/escpos.test.ts` — Expected: FAIL, modules missing.
- [ ] **Step 3: Implement** both files per the signatures above. Pure functions, no DOM.
- [ ] **Step 4: Run** the same command — Expected: PASS.
- [ ] **Step 5: Commit** `feat(pos): paper model and ESC/POS raster builder`.

### Task 2: Row builders for receipt, kitchen ticket and slips

**Files:**
- Create: `src/server/domain/pos/paper-docs.ts`
- Test: `tests/pos/paper-docs.test.ts`

**Interfaces:**
- Consumes: `PaperDoc` (Task 1); `Receipt` from `src/server/pos/payments.ts`; `KitchenTicket` from `src/server/pos/kitchen.ts`; `ShiftSummary` from `src/server/pos/shifts.ts`.
- Produces: `type PaperText = (key: string, vars?: Record<string, string|number>) => string` and `receiptDoc(receipt, t: PaperText, money: (n: number) => string, opts: { copy: boolean }): PaperDoc`, `kitchenDocs(ticket, t): { sectionId: string | null; doc: PaperDoc }[]` (one per sheet), `shiftDoc(summary, t, money): PaperDoc`.

- [ ] **Step 1: Write failing tests**: `receiptDoc` for a fixture receipt contains in order the business name (centered, size 2), order heading, one text row per line with `quantity × name` left and money right, a rule, the total row, a rounding row only when `snapshot.rounding !== 0`, a dollar leg row showing dollars, a change row when a CASH or CASH_USD leg exists, the footer; `{copy:true}` puts a first row with `t('pos.receipt.copy')`; `kitchenDocs` returns one doc per sheet with `sectionId` set and lines `N × name` at size 2 and option/note rows below; an empty business block adds no rows. Use `t = (key) => key` in tests.
- [ ] **Step 2: Run** `BUZZIFY_DB_PORT=54351 npx vitest run tests/pos/paper-docs.test.ts` — Expected: FAIL.
- [ ] **Step 3: Implement** mirroring `Receipt.tsx` and `KitchenTicket.tsx` row for row (read both first; the printed paper and the on-screen receipt must agree). Add `pos.receipt.copy` to the three message catalogs.
- [ ] **Step 4: Run** the test and `npx vitest run tests/studio/messages.test.ts` — Expected: PASS.
- [ ] **Step 5: Commit** `feat(pos): paper documents for receipt, ticket and shift slip`.

### Task 3: Print bridge

**Files:**
- Create: `print-bridge/bridge.mjs`, `print-bridge/start-bridge.cmd`, `print-bridge/README.md`, `src/server/domain/pos/bridge-protocol.ts`
- Test: `tests/pos/print-bridge.test.ts`

**Interfaces:**
- Produces in `bridge-protocol.ts`: `type BridgeTarget = { transport: 'NETWORK'|'FILE'; address: string }`; `parseTarget(target: string): BridgeTarget` (accepts `tcp://host:port`, `file://<path>`, throws `Error('bad target')` otherwise); `targetOf(printer: { transport; address }): string`.
- Produces in `bridge.mjs`: `startBridge({ port, allowedOrigins, send }): Promise<{ close(): Promise<void>; port: number }>` where `send(target, bytes)` defaults to a TCP write (net socket, 5 s timeout) or `fs.writeFile`; `POST /print` body `{ target, dataBase64 }` → `200 {"ok":true}` or `502 {"ok":false,"error":...}`; `GET /health` → `200 {"ok":true}`; CORS echoes the origin only when allowed, `OPTIONS` answered; anything else 404; bodies over 8 MB refused with 413.

- [ ] **Step 1: Write failing tests** with a fake `send`: posting a job from an allowed origin calls `send` with the decoded bytes and target and returns ok; a disallowed origin gets no CORS header and the job is refused (403); a `send` that throws returns 502 with the message; `parseTarget` accepts both forms and rejects `http://x`; oversized body → 413; `GET /health` ok. One test starts a real `net` server on an ephemeral port and checks the default TCP sender delivers the exact bytes.
- [ ] **Step 2: Run** `BUZZIFY_DB_PORT=54351 npx vitest run tests/pos/print-bridge.test.ts` — Expected: FAIL.
- [ ] **Step 3: Implement** with `node:http`, `node:net`, `node:fs/promises` only; `start-bridge.cmd` runs `node bridge.mjs --origin <url>`; the README says how to share a USB printer in Windows (`\\localhost\NAME`) and the starter for Windows startup.
- [ ] **Step 4: Run** the test — Expected: PASS.
- [ ] **Step 5: Commit** `feat(pos): local print bridge`.

### Task 4: PosPrinter data and settings actions

**Files:**
- Modify: `prisma/schema.prisma`, `src/server/studio/actions/pos.ts`, `src/server/pos/errors.ts`, `src/studio/messages/pos-till/{en,ar,ckb}.ts`
- Create: `prisma/migrations/20261028220000_cashier_printers/migration.sql`, `src/server/pos/printers.ts`
- Test: `tests/pos/printers.test.ts`

**Interfaces:**
- Produces: enums `PosPrinterRole`, `PosPrinterTransport`; model `PosPrinter` (fields as in the spec); `listPrintersIn(db, restaurantId): PrinterView[]`; `savePrinterIn(tx, restaurantId, input: PrinterInput): { id }`; `removePrinterIn(tx, id)`; `printerForReceipt(printers): PrinterView | null` and `printerForSection(printers, sectionId): PrinterView | null` (section's printer, else a KITCHEN printer without a section, else null) as pure helpers; actions `savePosPrinter`, `removePosPrinter` (manager and owner only, audited `pos.printer.save|remove`). Section delete sets `sectionId` null (foreign key `ON DELETE SET NULL`).

- [ ] **Step 1: Write failing tests**: saving a second default RECEIPT printer clears the first; paper width other than 58/80 refused; drawer pin other than 2/5/null refused; `printerForSection` picks the section's printer, falls back to the unsectioned KITCHEN printer, then null; deleting a section keeps the printer with `sectionId` null; a cashier cannot save a printer.
- [ ] **Step 2: Run** `BUZZIFY_DB_PORT=54351 npx vitest run tests/pos/printers.test.ts` — Expected: FAIL.
- [ ] **Step 3: Implement** schema, hand-written migration, `npx prisma generate`, service and actions, refusal texts in all catalogs.
- [ ] **Step 4: Run** the test and `tests/studio/messages.test.ts` — Expected: PASS.
- [ ] **Step 5: Commit** `feat(pos): printers as restaurant data`.

### Task 5: Settings screen for printers and a test print

**Files:**
- Create: `src/app/pos/_ui/print/PrintersForm.tsx`, `src/app/pos/_ui/print/bridge-url.ts`
- Modify: `src/app/pos/(till)/settings/page.tsx`, `src/studio/messages/{en,ar,ckb}.ts`
- Test: `tests/pos/bridge-url.test.ts`

**Interfaces:**
- Produces: `readBridgeUrl(): string` and `writeBridgeUrl(url: string): void` (localStorage in try/catch, default `http://127.0.0.1:9101`, only `http://127.0.0.1` / `http://localhost` accepted, otherwise the default); the form lists printers, adds, edits, removes, edits the bridge URL for this device, shows bridge status from `GET /health`, and a "Test print" button per printer that sends `receiptDoc` of a fixture.

- [ ] **Step 1: Write failing tests** for `bridge-url.ts`: default when storage is empty or throws; a remote URL is rejected; a saved localhost URL round-trips.
- [ ] **Step 2: Run** `BUZZIFY_DB_PORT=54351 npx vitest run tests/pos/bridge-url.test.ts` — Expected: FAIL.
- [ ] **Step 3: Implement** `bridge-url.ts`, the form (Field/Input/Button primitives from `@/studio/ui`, no motion, 48 px touch targets), message keys in the three catalogs.
- [ ] **Step 4: Run** the test, `npm run typecheck`, `npx eslint src` — Expected: clean.
- [ ] **Step 5: Commit** `feat(pos): printers in settings with a test print`.

### Task 6: Canvas renderer and silent print client

**Files:**
- Create: `src/app/pos/_ui/print/render-doc.ts`, `src/app/pos/_ui/print/print-client.ts`
- Test: `tests/pos/print-client.test.ts`

**Interfaces:**
- Consumes: `PaperDoc`, `rasterJob`, `packRaster`, `PAPER_DOTS`, `targetOf`, `readBridgeUrl`.
- Produces: `renderDoc(doc: PaperDoc, widthDots: number, dir: 'rtl'|'ltr', font: string): { rgba: Uint8ClampedArray; width: number; height: number }` (canvas; the only DOM-bound file; rows laid out per `align`, `left`/`right` on one line, bidi left to the browser); `printDoc(doc, printer: PrinterView, opts: { drawer: boolean; fetchImpl?: typeof fetch; render?: typeof renderDoc }): Promise<{ ok: true } | { ok: false; reason: 'bridge' | 'printer'; message: string }>` — builds the job (cut and pin from the printer, kick only when `opts.drawer && printer.drawerPin`), posts to `${bridgeUrl}/print`, maps network failure to `reason: 'bridge'` and a 502 to `reason: 'printer'`.

- [ ] **Step 1: Write failing tests** with fake `fetchImpl` and fake `render`: success posts `{ target: 'tcp://10.0.0.5:9100', dataBase64 }` whose bytes start with `ESC @`; `drawer: true` with pin 2 includes the kick bytes, `drawer: false` does not; a `fetchImpl` that rejects returns `{ ok:false, reason:'bridge' }`; a 502 returns `reason:'printer'` with the bridge's error text; a printer without a pin never kicks.
- [ ] **Step 2: Run** `BUZZIFY_DB_PORT=54351 npx vitest run tests/pos/print-client.test.ts` — Expected: FAIL.
- [ ] **Step 3: Implement** both files. `renderDoc` uses `OffscreenCanvas` when present, else a detached `<canvas>`, white background, black text.
- [ ] **Step 4: Run** the test — Expected: PASS.
- [ ] **Step 5: Commit** `feat(pos): render documents and print through the bridge`.

### Task 7: Wire receipts, kitchen tickets, shift slip and the drawer

**Files:**
- Modify: `src/app/pos/_ui/Receipt.tsx`, `src/app/pos/_ui/KitchenTicket.tsx`, `src/app/pos/_ui/ShiftScreen.tsx`, `src/app/pos/_ui/PayPanel.tsx` (or the component that finishes a payment), `src/app/pos/_ui/OrderScreen.tsx` (send to kitchen), `src/server/studio/actions/pos.ts` (`openPosDrawer`, `logPosReprint`), `src/studio/messages/{en,ar,ckb}.ts`
- Create: `src/app/pos/_ui/print/usePrint.ts`
- Test: `tests/pos/print-wiring.test.ts`

**Interfaces:**
- Produces: `usePrint(printers: PrinterView[])` returning `{ printReceipt(receipt, opts: { copy: boolean }), printKitchen(ticket), printShift(summary), openDrawer(reason), status }`; `drawerShouldKick(legs: { method: string }[]): boolean` (pure: true if any leg is `CASH` or `CASH_USD`); actions `openPosDrawer({ reason })` (manager-or-shift permission, audit `pos.drawer.open`) and `logPosReprint({ paymentId })` (audit `pos.receipt.reprint`).

- [ ] **Step 1: Write failing tests**: `drawerShouldKick` true for CASH, CASH_USD and mixed, false for card-only and empty; `openPosDrawer` without a reason is refused and with one writes an audit row; `logPosReprint` writes an audit row; a cashier without the permission cannot open the drawer.
- [ ] **Step 2: Run** `BUZZIFY_DB_PORT=54351 npx vitest run tests/pos/print-wiring.test.ts` — Expected: FAIL.
- [ ] **Step 3: Implement.** After a payment succeeds, print the receipt on the default RECEIPT printer with `drawer: drawerShouldKick(legs)`; each cash part of a split bill kicks once. Sending lines to the kitchen prints each sheet on `printerForSection`; a sheet with no printer is skipped (the screen stays). The Receipt page keeps the browser "Print" button as "Print with the browser" and adds "Print" (bridge) and, on a paid receipt, "Reprint" which prints with `copy: true` and logs the reprint. A failed job shows the message with Retry. A "Open drawer" button sits in the shift screen for those allowed.
- [ ] **Step 4: Run** the test, `npm run typecheck`, `npx eslint src` — Expected: PASS and clean.
- [ ] **Step 5: Commit** `feat(pos): silent printing, drawer kick and reprint audit`.

### Task 8: Barcode scanning

**Files:**
- Modify: `prisma/schema.prisma`, `src/server/pos/catalog-edit.ts`, `src/server/pos/till-catalog.ts`, `src/server/pos/sync-snapshot.ts`, `src/app/pos/(till)/catalog/CatalogEditor.tsx`, `src/app/pos/_ui/OrderScreen.tsx`, `src/app/pos/_ui/sync/OfflineTill.tsx`, `src/server/pos/errors.ts`, message catalogs
- Create: `prisma/migrations/20261028230000_cashier_barcode/migration.sql`, `src/server/domain/pos/scan.ts`
- Test: `tests/pos/barcode.test.ts`

**Interfaces:**
- Produces in `scan.ts`: `createScanner(onScan: (code: string) => void, now?: () => number): { key(event: { key: string; targetIsField: boolean }): void }` — a code is the characters typed with under 40 ms between keys and at least 4 long, ended by Enter, ignored when `targetIsField`; `productByBarcode(products: { id: string; barcode: string | null }[], code: string): string | null`. Server: `PosProductSetting.barcode String?` with unique `(restaurantId, barcode)` when set, saving a duplicate refused with a registered text; the till catalog and the offline snapshot carry `barcode`.

- [ ] **Step 1: Write failing tests**: a fast burst `4 0 0 6 Enter` calls `onScan('4006')`; slow typing never scans; a burst while `targetIsField` never scans; leading zeros `00123` are kept; saving the same barcode on two products is refused, on the same product again is fine; `productByBarcode` finds an exact match and returns null for an unknown code; the till catalog rows include `barcode`.
- [ ] **Step 2: Run** `BUZZIFY_DB_PORT=54351 npx vitest run tests/pos/barcode.test.ts` — Expected: FAIL.
- [ ] **Step 3: Implement** schema, migration, service, editor field, scanner hook on the order screen and the offline till (adds one of the product, or opens its options sheet when it has required options; unknown code shows `pos.scan.unknown`).
- [ ] **Step 4: Run** the test, `tests/pos/sync-snapshot.test.ts`, `tests/pos/till-catalog.test.ts`, typecheck, eslint — Expected: PASS and clean.
- [ ] **Step 5: Commit** `feat(pos): barcode scanning`.

### Task 9: Kitchen Expo

**Files:**
- Create: `src/server/domain/pos/expo.ts`, `src/app/pos/(till)/kitchen/expo/page.tsx`, `src/app/pos/_ui/ExpoScreen.tsx`
- Modify: `src/server/domain/pos/nav.ts`, `src/app/pos/_ui/TillNav.tsx`, message catalogs
- Test: `tests/pos/expo.test.ts`

**Interfaces:**
- Consumes: `KitchenCard` from `src/server/pos/kitchen.ts`.
- Produces: `groupExpo(cards: KitchenCard[]): ExpoOrder[]` where `ExpoOrder = { orderId; orderNumber; label; sections: { sectionId: string | null; name: string; ready: boolean }[]; allReady: boolean; oldestAt: Date }`, sorted all-ready first then oldest first.

- [ ] **Step 1: Write failing tests**: two cards of one order in different sections, one ready, give `allReady: false`; both ready give `allReady: true` and sort first; a single-section order is all-ready when that card is ready; cancelled lines do not count as waiting; orders sort oldest first within each group.
- [ ] **Step 2: Run** `BUZZIFY_DB_PORT=54351 npx vitest run tests/pos/expo.test.ts` — Expected: FAIL.
- [ ] **Step 3: Implement** `expo.ts`, the page (same permission as the kitchen page, `useLiveRefresh(5_000)`), the screen (one tile per order, sections as waiting/ready chips with words not only colour, "ready to run" label, no motion) and a nav entry.
- [ ] **Step 4: Run** the test, typecheck, `npx eslint src`, then the full `BUZZIFY_DB_PORT=54351 npm test` — Expected: only the known ai-import enforcement failure.
- [ ] **Step 5: Commit** `feat(pos): kitchen expo screen`.
