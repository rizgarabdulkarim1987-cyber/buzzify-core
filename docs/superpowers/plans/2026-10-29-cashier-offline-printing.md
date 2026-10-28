# Cashier Offline Printing Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans (inline) to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The offline till prints receipts and kitchen rounds through the local print bridge, opens the drawer, and leaves audit rows when it syncs.

**Architecture:** The snapshot carries the printers and business details; pure builders turn the local order into `PaperDoc`s; `OfflineTill` prints through the existing `printDoc`; two new queueable operations record manual drawer opens and receipt copies.

**Tech Stack:** as Batch 4 (`docs/superpowers/plans/2026-10-28-cashier-printing.md`), plus the existing sync queue (`src/lib/pos-sync/*`).

**Spec:** `docs/superpowers/specs/2026-10-29-cashier-offline-printing-design.md`

## Global Constraints

- Tests need `BUZZIFY_DB_PORT=54351`; never `prisma migrate deploy`, never reset the shared databases.
- No motion in the cashier. All till text translated en, ar, ckb (`src/studio/messages/pos-till/*`, parity enforced).
- Printing never blocks or undoes a sale; browser print stays the fallback.
- The online till does not change behavior.
- Commits end with `Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>`.

## Review Focus

- 60+ character Arabic names on an offline receipt.
- Bridge off at the moment of the offline sale.
- An old stored snapshot with no `printers`/`business`.
- Replay of `receiptCopy` for an order the server never saw.

---

### Task 1: Snapshot carries printers and business details

**Files:**
- Modify: `src/lib/pos-sync/snapshot.ts` (types), `src/server/pos/sync-snapshot.ts` (builder), `src/lib/pos-sync/local-state.ts` only if the types flow through
- Test: `tests/pos/sync-snapshot.test.ts` (extend; find the existing file first)

**Interfaces:**
- Produces: `SyncSnapshot.printers?: PrinterView[]` and `SyncSnapshot.business?: { name: string; address: string; phone: string; taxNumber: string; footer: string }` (optional so a stored old snapshot still parses).

- [ ] **Step 1: Write failing tests:** `the snapshot lists the restaurant's printers`; `the snapshot carries the receipt details`; `another restaurant's printers never appear`.
- [ ] **Step 2: Run** `BUZZIFY_DB_PORT=54351 npx vitest run tests/pos/sync-snapshot.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement** the two fields in the builder using `listPrinters` and the same business source the receipt uses (`src/server/pos/payments.ts` receipt `business`).
- [ ] **Step 4: Run** the test plus `tsc`. Expected: PASS.
- [ ] **Step 5: Commit** `feat(pos): offline snapshot carries printers and receipt details`.

### Task 2: Offline paper builders

**Files:**
- Create: `src/server/domain/pos/offline-docs.ts`
- Modify: pos-till catalogs (`pos.offlineReceipt.provisional`)
- Test: `tests/pos/offline-docs.test.ts`

**Interfaces:**
- Consumes: `LocalOrder`, `localTotals`, `payableOf` (`src/lib/pos-sync/local-state.ts`), `PaperText`, `PaperFormat`, `receiptDoc` row helpers.
- Produces: `offlineReceiptDoc(order: LocalOrder, snapshot: Pick<SyncSnapshot,'rates'|'business'|'user'>, t, fmt): PaperDoc` (provisional number, lines, subtotal/service/tax, rounding, total, cash received and change, the provisional line) and `offlineKitchenDocs(order: LocalOrder, snapshot, t, fmt, printedSlips): { sectionId: string | null; doc: PaperDoc; slipKey?: string }[]` for the lines not yet sent.

- [ ] **Step 1: Write failing tests:** `offlineReceiptDoc shows the provisional number and the provisional line`; `offlineReceiptDoc totals equal the on-screen totals`; `offlineReceiptDoc without business details still prints`; `offlineKitchenDocs groups unsent lines by section`; `offlineKitchenDocs makes no ticket when everything was sent`.
- [ ] **Step 2: Run.** Expected: FAIL.
- [ ] **Step 3: Implement** both builders reusing `receiptDoc`/`kitchenDocs` row helpers (export them from `paper-docs.ts` if needed).
- [ ] **Step 4: Run** the test, `tests/pos/paper-docs.test.ts`, `tests/studio/messages.test.ts`, tsc.
- [ ] **Step 5: Commit** `feat(pos): paper for the offline receipt and kitchen round`.

### Task 3: Operations for drawer opens and receipt copies

**Files:**
- Modify: `src/lib/pos-sync/op-schema.ts` (`drawerOpen`, `receiptCopy`), `src/lib/pos-sync/queue.ts`/`replay.ts` if they switch on kinds, `src/server/pos/sync.ts` (apply), `tests/studio/cross-tenant.test.ts` only if sync ops are swept
- Test: `tests/pos/sync-print-ops.test.ts`

**Interfaces:**
- Produces: `{ kind: 'drawerOpen', payload: { reason: string } }` and `{ kind: 'receiptCopy', ...onOrder, payload: {} }`; server answers `done` after writing audit `pos.drawer.open` / `pos.receipt.reprint`.

- [ ] **Step 1: Write failing tests:** `a drawerOpen operation writes the drawer audit row once, also when replayed`; `a receiptCopy for a paid order writes the reprint row`; `a receiptCopy for an unknown order answers unknownRef`; `a drawerOpen needs a reason`; `another restaurant's order is unknownRef`.
- [ ] **Step 2: Run.** Expected: FAIL.
- [ ] **Step 3: Implement** schema, apply and the queue's accepted kinds.
- [ ] **Step 4: Run** the test, `tests/pos/sync*.test.ts`, `tests/studio/cross-tenant.test.ts`, tsc.
- [ ] **Step 5: Commit** `feat(pos): sync drawer opens and receipt copies`.

### Task 4: Print from the offline till

**Files:**
- Modify: `src/app/pos/_ui/sync/OfflineTill.tsx`, `src/app/pos/_ui/print/PrintProvider.tsx` (let `PrintProvider` take printers from the snapshot; add `printOfflineReceipt`/`printOfflineRound`), `src/app/pos/_ui/sync/SyncProvider.tsx` if the snapshot is read there
- Test: `tests/pos/offline-print-wiring.test.ts` (pure helpers; the screen is checked in the browser)

**Interfaces:**
- Consumes: Task 1 snapshot fields, Task 2 builders, Task 3 operation kinds, `printDoc`, `kickDrawer`, `printerForReceipt`, `printerForSection`, `receiptPrintOptions`.
- Produces: after an offline cash payment: print the provisional receipt and kick the drawer (when a receipt printer exists); after "Send to kitchen": print the round; buttons "Print a copy" (queues `receiptCopy`) and "Open drawer" (reason dialog, queues `drawerOpen`); failure shows `printFailureText` with Retry and the existing browser print.

- [ ] **Step 1: Write failing tests** for the pure decision helper `offlinePrintPlan(snapshot, event)` (returns which docs print and whether the drawer kicks): `a paid order prints one receipt and kicks the drawer`; `no receipt printer prints nothing and says to use the browser`; `an old snapshot without printers prints nothing`.
- [ ] **Step 2: Run.** Expected: FAIL.
- [ ] **Step 3: Implement** the helper and wire the screen.
- [ ] **Step 4: Run** the new test, `tests/pos`, tsc, eslint.
- [ ] **Step 5: Browser check:** open the offline route at 375 and 1024 px in en and ar with the bridge off; confirm the sale completes and the retry message shows. Record the result.
- [ ] **Step 6: Commit** `feat(pos): print and open the drawer from the offline till`.
