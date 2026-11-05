# Pharmacy thermal receipt + cash drawer Implementation Plan

> **For agentic workers:** execute with superpowers:executing-plans, task by task, TDD.

**Goal:** A cash sale in Pharmacy Sell prints a thermal receipt through the local print bridge and kicks the cash drawer, exactly like the restaurant cashier (Menu POS).

**Architecture:** Reuse the POS stack unchanged (`print-client.ts`, `render-doc.ts`, `escpos.ts`, `bridge-protocol.ts`, `print-bridge/`). Add (1) an optional `receiptPrinter` block in the per-workstation settings (`PhSettings.print` JSON, no migration), (2) a pure converter `ReceiptModel -> PaperDoc`, (3) a thin client module that builds a `PrinterView` from the workstation and prints/kicks, (4) wiring in the Sell receipt dialog, the reprint dialog and the settings form. Browser print stays as the fallback. A failed print never touches the sale.

**Tech Stack:** Next.js, TypeScript, zod, vitest. Messages in `src/studio/messages/pharmacy/{ar,ckb,en}.ts`.

**Spec:** user approval in chat 2026-11-05 (reuse the cashier's proven answers: same bridge, same ESC/POS raster, same drawer pins 2/5).

## Global Constraints
- Pharmacy rules: no motion, RTL, ar/ckb/en messages, 44px targets (`TOUCH_BTN`).
- Barcode scanning in Sell is not touched.
- Reprints marked COPY and logged (already done server side by `reprintReceipt`); a copy never kicks the drawer.
- No push, merge or deploy.

## Review Focus
- Mixed cash + credit sale: drawer opens (some cash was taken). Credit-only / card-only: no drawer.
- Bridge down or printer offline: calm message, sale and receipt dialog intact, browser print still available.
- Stored settings from before this change (no `receiptPrinter`) still parse; a bad address is refused on save.
- Return slip prints on the thermal printer but never kicks the drawer.
- Autoprint fires once per sale, not again on width change or re-render.

### Task 1: Settings shape
**Files:** Modify `src/server/domain/pharmacy/print-settings.ts`; Test `tests/pharmacy/print-settings.test.ts`.
**Produces:** `receiptPrinter` schema, type `ReceiptPrinterSettings = { transport:'NETWORK'|'FILE'; address:string; paperWidth:58|80; cut:boolean; drawerPin:2|5|null; drawerOnCash:boolean }`, `DEFAULT_RECEIPT_PRINTER`; `WorkstationSettings.receiptPrinter?` optional.
- [ ] Failing tests (pure, in a new `tests/pharmacy/receipt-printer-settings.test.ts`): old object without the key parses; valid network `192.168.1.50:9100` parses; `8.8.8.8:9100` refused; `\\localhost\XP80` FILE parses; unknown key refused.
- [ ] Implement with `printerAddressAllowed` refine. Commit.

### Task 2: Receipt as paper
**Files:** Create `src/server/domain/pharmacy/receipt-paper.ts`; Test `tests/pharmacy/receipt-paper.test.ts`.
**Produces:** `receiptPaperDoc(m: ReceiptModel): PaperDoc`, `tookCash(m: ReceiptModel): boolean`.
- [ ] Tests: copy model has a bold COPY row first and `doc.copy`; shop name is size 2; each line yields a name row and a qty x price / total pair row; total row bold size 2; Rx marker present when `m.rx`; change row only when `change !== null`; `tookCash` true for CASH + CREDIT mix, false for CREDIT-only and for a return.
- [ ] Implement; no customer field exists in the model. Commit.

### Task 3: Client printing module
**Files:** Create `src/app/pharmacy/_ui/thermal-print.ts`; Test `tests/pharmacy/ui-thermal-print.test.ts`.
**Produces:** `printerOf(ws: WorkstationSettings): PrinterView | null`; `printReceipt(model, ws, opts?: {fetchImpl, render, bridgeUrl, dir}) : Promise<PrintResult | {ok:false; reason:'none'}>` (kicks drawer only when `!model.copy && model.kind==='sale' && drawerOnCash && drawerPin!==null && tookCash(model)`); `openDrawer(ws, opts?)`; `testPrint(ws, opts?)`.
- [ ] Tests with injected fetch/render (pattern of `tests/pos/print-client.test.ts`): kick bytes `1b 70 00 3c 78` present for cash sale, absent for copy, credit-only, return, and `drawerOnCash:false`; no printer configured returns `reason:'none'`; bridge failure returns ok:false without throwing. Commit.

### Task 4: Settings form
**Files:** Modify `src/app/pharmacy/_ui/PrintSettingsForm.tsx`, messages ar/ckb/en; extend `tests/pharmacy/ui-print-settings.test.ts`.
- [ ] Section "Receipt printer": connection (network / shared USB), address, paper 58/80, cut, drawer pin (none/2/5), "open drawer on cash sales", bridge status (`bridgeAlive`), buttons: test print, open drawer. Replace the "browser only" sentence. Commit.

### Task 5: Sell + reprint wiring
**Files:** Modify `src/app/pharmacy/(app)/sell/page.tsx` (pass `print`), `SellWorkspace.tsx`, `SellDialogs.tsx` (ReceiptDialog), `PrintDialog.tsx`, `SaleActions`/return pages as needed; messages.
- [ ] ReceiptDialog: when the workstation has `receiptPrinter` and the receipt model loads for a new sale (first load only, ref-guarded), auto print + drawer; show success/calm failure note; "Print" button prints through the bridge when a printer is set, else browser print. Reprint: server copy then bridge print with COPY. PrintDialog (sale/return) same. Commit.

### Task 6: Docs + verification
- [ ] `print-bridge/README.md`: pharmacy section (same bridge, same origin). Run `npx vitest run tests/pharmacy` (own DB port 54437), `npm run typecheck`, `npx eslint src tests`. Browser check of settings form. Code review (code-review skill). Commit.
