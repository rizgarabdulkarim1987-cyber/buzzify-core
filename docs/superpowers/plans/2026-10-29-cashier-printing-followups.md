# Cashier Printing Follow-ups Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Close what Batch 4's review left open in the cashier: long Arabic and Kurdish text on narrow paper, the delivery slip through the print bridge, the drawer on refunds, and the small review minors. Verify with a real printer.

**Architecture:** Changes stay inside the print pipeline (`paper.ts`, `paper-docs.ts`, `render-doc.ts`, `print-client.ts`, `PrintProvider.tsx`) and the till screens that call it. No new tables.

**Tech Stack:** as the Batch 4 plan, `docs/superpowers/plans/2026-10-28-cashier-printing.md`.

**Spec:** `docs/superpowers/specs/2026-10-28-cashier-printing-design.md` (goal 1 names the delivery slip; the review's findings 9 and 10 and the listed minors are the source).

## Global Constraints

- Tests need `BUZZIFY_DB_PORT=54351`; never `prisma migrate deploy`.
- No motion in the cashier. All till text translated en, ar, ckb (`src/studio/messages/pos-till/*`, parity enforced).
- Printing never blocks or undoes a sale; browser print stays the fallback.
- Offline printing and the drawer for the offline till are NOT in this plan: they need their own design (the offline till has no server for audit rows). Listed as the next spec.
- Commits end with `Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>`.

## Review Focus

- Arabic and Kurdish item names of 60+ characters with no spaces and with joined letters on 58 mm (384 dots) and 80 mm (576 dots) paper: wrapped, never cut, letters stay joined.
- A name wider than the line with a right-hand price column: the price keeps its place, the name wraps under itself.
- An empty delivery address, a very long address note, a phone with `+` and spaces.
- A refund of a split payment where card is the larger leg but part was cash: the drawer opens.

---

### Task 1: Wrap rows by words in the rasteriser

**Files:**
- Modify: `src/app/pos/_ui/print/render-doc.ts`, `src/server/domain/pos/paper.ts` (only if the row type needs a `wrap` flag)
- Test: `tests/pos/render-doc.test.ts` (new; canvas is stubbed with a `measureText` that returns `text.length * 10`)

**Interfaces:**
- Produces: `wrapRow(text: string, maxWidth: number, measure: (s: string) => number): string[]` exported from `render-doc.ts`: breaks at spaces, and inside a single word wider than the line breaks at the last character that fits (never splitting a surrogate pair); `layoutRows(rows, widthDots, measure)` returns rows expanded so no text row is wider than its space, the right column's width reserved first.

- [ ] **Step 1: Write failing tests:** `wrapRow keeps a short line whole`; `wrapRow breaks at spaces`; `wrapRow breaks a 60-character word at the line width`; `wrapRow never splits a surrogate pair`; `layoutRows reserves the right column and wraps the left text under itself`; `layoutRows keeps right-to-left text in logical order so the canvas joins the letters`.
- [ ] **Step 2: Run** `BUZZIFY_DB_PORT=54351 npx vitest run tests/pos/render-doc.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement** `wrapRow` and `layoutRows` and call `layoutRows` before the canvas height is computed, replacing the `fillText(..., maxWidth)` squeeze.
- [ ] **Step 4: Run** the new test and `tests/pos/paper-docs.test.ts tests/pos/escpos.test.ts tests/pos/print-client.test.ts`. Expected: PASS.
- [ ] **Step 5: Commit** `fix(pos): wrap long receipt text instead of squeezing it`.

### Task 2: Delivery slip through the bridge

**Files:**
- Modify: `src/server/domain/pos/paper-docs.ts` (`deliveryDoc`), `src/app/pos/_ui/DeliverySlip.tsx`, `src/app/pos/_ui/print/PrintProvider.tsx` (`printDelivery`), pos-till catalogs if new words are needed
- Test: `tests/pos/paper-docs.test.ts`

**Interfaces:**
- Consumes: the data `DeliverySlip.tsx` shows today (read it first); `printDoc`, `printerForReceipt`.
- Produces: `deliveryDoc(slip, t, fmt): PaperDoc` (order number, customer name, phone left-to-right, zone and address, note, driver, total to collect), `usePrint().printDelivery(slip): Promise<PrintResult>`; the screen gets a "Print" button that uses it when a receipt printer exists, `window.print()` otherwise (kept as the fallback).

- [ ] **Step 1: Write failing tests:** `deliveryDoc lists customer, phone, address, note, driver and the amount to collect`; `deliveryDoc omits empty parts`; `deliveryDoc never prints a card number or reference`.
- [ ] **Step 2: Run.** Expected: FAIL.
- [ ] **Step 3: Implement** and wire the button; the browser-print path stays as is.
- [ ] **Step 4: Run** `tests/pos/paper-docs.test.ts tests/studio/messages.test.ts`, typecheck, lint.
- [ ] **Step 5: Commit** `feat(pos): print the delivery slip through the bridge`.

### Task 3: Drawer on refund, and the review minors

**Files:**
- Modify: `src/app/pos/_ui/ReverseDialog.tsx` (use `drawerShouldKick(legs)`; the dialog needs the payment's legs, check what the receipt page can pass), `src/server/studio/actions/pos.ts` (`.max(200, 'Use at most 200 characters')`), `src/app/pos/_ui/print/PrintProvider.tsx` (`printKitchenRound(orderId, batch?)` takes the batch returned by `sendPosToKitchen`), `src/app/pos/_ui/print/print-client.ts` (map `reason: 'bridge' | 'printer'` to translated text `pos.print.reason.bridge|printer`), `src/server/pos/till-catalog.ts` or the barcode action (turn a unique-index `P2002` into the same `refuse` as the pre-check), `src/server/pos/printers.ts` (partial unique index on `isDefault` per restaurant and role RECEIPT in a new migration `prisma/migrations/20261029130000_printer_default_unique`, and the action catches the conflict)
- Test: `tests/pos/print-wiring.test.ts`, `tests/pos/barcode.test.ts`, `tests/pos/printers.test.ts`, `tests/pos/print-client.test.ts`

- [ ] **Step 1: Write failing tests:** `a refund whose payment had cash and a larger card leg asks for the drawer` (pure helper over `drawerShouldKick`); `the address length message says 200`; `two simultaneous saves of one barcode give the barcode refusal, never a raw error` (`Promise.all`); `two simultaneous saves of a default receipt printer leave exactly one default`; `a bridge failure shows the translated bridge text and a printer failure the printer text`; `printKitchenRound prints the given batch, not the latest`.
- [ ] **Step 2: Run.** Expected: FAIL on each.
- [ ] **Step 3: Implement each fix minimally.**
- [ ] **Step 4: Run** the four test files plus `tests/studio/messages.test.ts`, typecheck, lint, then the full suite into the scratchpad file (only the known ai-import failure allowed).
- [ ] **Step 5: Commit** `fix(pos): refund drawer, concurrent saves and print error texts`.

### Task 4: Real-printer and browser verification (manual, with the owner's printer)

- [ ] **Step 1:** On the till PC install Node, run `print-bridge/start-bridge.cmd --origin https://studio.buzzify-menu.online`, add the printer in Settings (network `192.168.x.x:9100`, or a USB printer shared as `\\localhost\NAME`), press "Print test".
- [ ] **Step 2:** Sell a cash order: the receipt prints silently and the drawer opens; press "Print a copy": marked copy, no drawer, one audit row; refresh the receipt page: nothing prints again.
- [ ] **Step 3:** Send an order with two sections to two kitchen printers; cancel a line and send again: the cancellation slip prints once.
- [ ] **Step 4:** Scan a barcode with a keyboard-wedge scanner while a product tile is focused: one product added.
- [ ] **Step 5:** Record what failed or looked wrong (a photo of the receipt in Arabic and Kurdish on 58 and 80 mm) and open a fix list.

### Next spec (not in this plan)

Printing and drawer kick for the offline till (queue the print job with the offline operation, print on reconnect or print locally through the bridge, reprint audit on replay).
