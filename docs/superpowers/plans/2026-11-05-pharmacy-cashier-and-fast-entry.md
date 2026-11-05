# Pharmacy cashier and fast entry Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the pharmacy sell screen with the approved one-screen cashier (open-receipt tabs, unit-convert button, detailed lines table, inline flows, inquiry mode) and add a one-screen fast product entry with product history.

**Architecture:** Pure, tested logic first (`sell-receipts.ts` wraps the existing `CartState` per open receipt; `sell-keys.ts`; unit cycling), then one server query for the header chips, then the UI composed from small components that reuse the existing cart reducer, estimate, payment, hold, shift and prescription code in `sell-logic.ts`. The old `SellWorkspace`/`SellDialogs` are removed only after parity. Fast entry builds one draft receiving document per session in the existing stock-receive model.

**Tech Stack:** Next.js (App Router, server components + client workspace), TypeScript, Vitest (`npm test`), zod, existing studio message files `src/studio/messages/pharmacy/{ar,ckb,en}.ts`.

**Spec:** `docs/superpowers/specs/2026-11-05-pharmacy-cashier-and-fast-entry-design.md`. Prototypes (source of truth for every label, column, message and behaviour): `docs/pharmacy/prototypes/cashier-layouts-2026-11-05.html` (layout A only), `docs/pharmacy/prototypes/product-entry-2026-11-05.html`. Read all three before starting. Every task below must also check its area against the prototype; if a prototype behaviour is deliberately left out, list it in the PR description.

## Global Constraints

- No motion anywhere in the cashier and entry screens; no dialogs, modals or toasts on them: inline work panel and inline message line only. Destructive actions use a two-tap "armed" button.
- RTL; 44px minimum touch targets; keypad physically at the RIGHT of the page (side column first in an RTL grid); keypad digits read 1 2 3 left to right (`direction: ltr` on the keys).
- Messages in `src/studio/messages/pharmacy/ar.ts`, `ckb.ts`, `en.ts` (Arabic wording from the prototype is final; ckb and en are translations). Keys under `pharmacy.cashier.*` and `pharmacy.entry.*`.
- The pharmacy audit guard forbids fields named address, phone and similar; no patient fields on the device.
- Cost, profit and price edit are enforced on the server and only rendered for roles with the permission; the prototype's role dropdown is simulation only.
- USD is display only: the customer does not pay in USD; the exchange rate is a pharmacy setting the pharmacist edits in settings; shift and drawer totals stay in the shift's currency (IQD).
- Max 6 open receipts; a receipt with items cannot be closed with its tab's X.
- Hotkeys: F2 pay cash, F3 pay credit, F4 new receipt, F6 or `*` cycle unit, F7 inquiry, F8 hold, F9 receipt discount, `/` focus scan, Esc back, Alt+1..6 and Alt+Left/Right switch receipt. In the search field the scanner wins; `*`, `/`, `+`, `-` are hotkeys only outside a text field (except `*` and `/` on an empty search field).
- The old `/sell` behaviour must survive: shift gating, device draft cart, hold/resume, prescription recording, payment and discount drafts, idempotency keys, offline notice.
- Open points the owner postponed (record, do not decide): how a pharmacist confirms a prescription item at a cashier's till; whether tablets are a target (build desktop-first, no collapsed layout).
- Run `npm run typecheck`, `npm run lint` (src only), `npm test` before each commit.

## Review Focus

- A scan arrives while a different receipt tab is active or while focus is in the quantity cell: the item goes to the active receipt; quantity cell keeps its typed digits.
- Reload with 3 open receipts, one with a blocked line (product archived since): all 3 restore, the blocked line is marked, Pay and Hold stay blocked for that receipt only.
- Two tabs with the same product: stock check at payment, not reservation; the second payment fails with the existing shortage message, not a crash.
- Unit button on a line whose next unit has no price or is not sellable: it skips to the next valid unit; with one valid unit it does nothing and says so inline.
- A very long item name, 200 lines (MAX_LINES), a 1,000,000 quantity: table scrolls, no layout break, totals stay correct.

---

## File Structure

- Create `src/app/pharmacy/_ui/sell-receipts.ts`: pure open-receipts state and device persistence.
- Create `src/app/pharmacy/_ui/sell-keys.ts`: pure keyboard mapping for the cashier.
- Modify `src/app/pharmacy/_ui/sell-logic.ts`: add `nextUnitId`.
- Create `src/server/pharmacy/queries/pulse.ts`: header chips query.
- Modify pharmacy settings (`src/app/pharmacy/_ui/PharmacySettings.tsx` and its server action/query) for `usdRate`.
- Create `src/app/pharmacy/_ui/cashier/`: `CashierScreen.tsx`, `PulseStrip.tsx`, `ReceiptTabs.tsx`, `SaleLinesTable.tsx`, `SideColumn.tsx` (total, customer, `Keypad.tsx`, pay buttons), `WorkPanel.tsx` (inline flows), `InquiryPanel.tsx`, `LinePanels.tsx` (batches, details, substitutes).
- Modify `src/app/pharmacy/(app)/sell/page.tsx` to render `CashierScreen`; delete `SellWorkspace.tsx`, `SellDialogs.tsx`, `SellLookPicker.tsx` after parity (Task 11).
- Create `src/app/pharmacy/(app)/stock/entry/page.tsx` and `src/app/pharmacy/_ui/entry/`: `EntryScreen.tsx`, `EntryForm.tsx`, `ProductHistory.tsx`, `entry-logic.ts`.
- Create `src/server/pharmacy/queries/product-history.ts` and an entry server action in `src/server/pharmacy/actions/`.
- Tests under `tests/pharmacy/`.

---

### Task 1: Open-receipts state

**Files:**
- Create: `src/app/pharmacy/_ui/sell-receipts.ts`
- Test: `tests/pharmacy/ui-sell-receipts.test.ts`

**Interfaces:**
- Consumes: `CartState`, `emptyCart`, `Currency` from `sell-logic.ts`.
- Produces:
  - `export const MAX_RECEIPTS = 6`
  - `export interface OpenReceipt { key: string; cart: CartState; customerId: string | null; fromHoldId: string | null; prescriptionId: string | null; done: boolean }`
  - `export interface ReceiptsState { receipts: OpenReceipt[]; active: number }`
  - `export type ReceiptsAction = { type: 'open' } | { type: 'switch'; index: number } | { type: 'close'; index: number } | { type: 'cart'; cart: CartState } | { type: 'customer'; customerId: string | null } | { type: 'done' } | { type: 'replace'; receipt: OpenReceipt }`
  - `export const initialReceipts = (): ReceiptsState`
  - `export function receiptsReducer(state: ReceiptsState, action: ReceiptsAction): ReceiptsState`
  - `export const canClose = (r: OpenReceipt): boolean` (empty cart or done)

- [ ] **Step 1: Write failing tests** in `tests/pharmacy/ui-sell-receipts.test.ts`: `open` adds a receipt and activates it; `open` at 6 returns the same state; `switch` out of range is ignored; `close` of a receipt with lines and not done is ignored; closing the only receipt replaces it with a fresh empty one; closing a receipt before the active index decrements `active`; `done` marks active, and `open` or first use afterwards replaces a done active receipt instead of leaving it; each receipt keeps its own cart after switching back and forth.
- [ ] **Step 2: Run** `npx vitest run tests/pharmacy/ui-sell-receipts.test.ts`. Expected: FAIL (module missing).
- [ ] **Step 3: Implement** the reducer and `canClose` exactly as specified; keys come from `newClientKey('rc')` in `sell-logic.ts`.
- [ ] **Step 4: Run** the same command. Expected: PASS.
- [ ] **Step 5: Commit** `feat(pharmacy): open-receipts state for the cashier`.

### Task 2: Device persistence of receipts

**Files:**
- Modify: `src/app/pharmacy/_ui/sell-receipts.ts`
- Test: `tests/pharmacy/ui-sell-receipts-draft.test.ts`

**Interfaces:**
- Consumes: `serializeDraft`/`parseDraft` helpers and validators in `sell-logic.ts` (reuse the cart validation used for the v2 draft; export the validator if it is private), `draftKey`.
- Produces:
  - `export const RECEIPTS_VERSION = 3`
  - `export const receiptsKey = (restaurantId: string, branchId: string, userId: string, currency: Currency): string` (`ph-sell-receipts:v3:...`)
  - `export function serializeReceipts(state: ReceiptsState): string`
  - `export function parseReceipts(raw: string | null, legacyDraftRaw: string | null): ReceiptsState` (never throws; invalid input returns `initialReceipts()`; a valid v2 single-cart draft becomes receipt 1)

- [ ] **Step 1: Write failing tests**: round trip of 3 receipts with the active index; corrupt JSON returns one empty receipt; a receipt with an invalid line is dropped, others kept; more than 6 receipts truncated to 6; legacy v2 draft migrates into one receipt with its `fromHoldId` and `prescriptionId`; `done` receipts are not persisted.
- [ ] **Step 2: Run** `npx vitest run tests/pharmacy/ui-sell-receipts-draft.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement** the three functions; per-receipt validation reuses the existing line validators.
- [ ] **Step 4: Run.** Expected: PASS.
- [ ] **Step 5: Commit** `feat(pharmacy): persist open receipts on the device`.

### Task 3: Cashier keyboard mapping

**Files:**
- Create: `src/app/pharmacy/_ui/sell-keys.ts`
- Test: `tests/pharmacy/ui-sell-keys.test.ts`

**Interfaces:**
- Produces:
  - `export type CashierKey = { kind: 'cash' | 'credit' | 'new' | 'unit' | 'inquiry' | 'hold' | 'discount' | 'focusScan' | 'escape' | 'addTop' | 'qtyUp' | 'qtyDown' | 'remove' | 'lineUp' | 'lineDown' } | { kind: 'switch'; index: number } | { kind: 'switchRel'; delta: 1 | -1 }`
  - `export function cashierKeyOf(event: KeyEventLike, ctx: { inSearch: boolean; inTextField: boolean; searchEmpty: boolean; modalOpen: boolean }): CashierKey | null` where `KeyEventLike` is the same shape `shortcutOf` takes.

- [ ] **Step 1: Write failing tests** (assertions): `F2` → cash, `F3` → credit, `F4` → new, `F6` → unit, `F7` → inquiry, `F8` → hold, `F9` → discount; `*` → unit only when not in a text field or the search is empty; `/` → focusScan only when not in a text field or search empty; `+`/`-` → qtyUp/qtyDown only outside text fields; `Alt+3` → switch index 2; `Alt+ArrowLeft` → switchRel +1 (RTL: left is next), `Alt+ArrowRight` → -1; key repeat, composing, `defaultPrevented` and `modalOpen` all return null; Enter in search without shift → addTop; plain `Alt+x` → null.
- [ ] **Step 2: Run** `npx vitest run tests/pharmacy/ui-sell-keys.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement** `cashierKeyOf`; keep the guards from `shortcutOf` (repeat, composing/229, defaultPrevented, modal). `shortcutOf` stays until Task 11 deletes the old screen.
- [ ] **Step 4: Run.** Expected: PASS.
- [ ] **Step 5: Commit** `feat(pharmacy): cashier keyboard mapping`.

### Task 4: Unit cycling

**Files:**
- Modify: `src/app/pharmacy/_ui/sell-logic.ts`
- Test: `tests/pharmacy/ui-sell-units.test.ts`

**Interfaces:**
- Consumes: `CartLine`, `CartUnit`, `unitOf`.
- Produces: `export function nextUnitId(line: CartLine, currency: Currency): string | null` returns the next unit after `line.unitId` (wrapping) that has a price in `currency` (`priceMinor !== null`) and is sellable; `null` when there is no other valid unit.

- [ ] **Step 1: Write failing tests**: tablet → strip → packet → tablet; a unit with `priceMinor` null is skipped; one valid unit returns null; the current unit being the only priced one returns null; works for lines with 1, 2 and 3 units.
- [ ] **Step 2: Run** `npx vitest run tests/pharmacy/ui-sell-units.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement** `nextUnitId`; the cart action that changes unit already exists (`CartAction`), reuse it (the screen dispatches the existing unit-change action with the returned id).
- [ ] **Step 4: Run.** Expected: PASS.
- [ ] **Step 5: Commit** `feat(pharmacy): unit cycling skips units without a price`.

### Task 5: Header chips query and exchange-rate setting

**Files:**
- Create: `src/server/pharmacy/queries/pulse.ts`
- Modify: pharmacy settings server query/action and `src/app/pharmacy/_ui/PharmacySettings.tsx` (add `usdRate`, positive integer IQD per USD, default 1450, editable by roles that already edit settings)
- Test: `tests/pharmacy/pulse.test.ts`

**Interfaces:**
- Produces: `export const pulse` (a studio `query` like the others in `queries/shifts.ts`) taking `placeInput`, requiring `shift.use`, returning `{ shiftNetMinor: string; receiptsDone: number; drawerCashMinor: string; nearExpiry: { count: number; firstProductName: string | null; firstProductId: string | null }; lowStock: { count: number; firstProductName: string | null; firstProductId: string | null }; usdRate: number }`.
- Near-expiry window 90 days (setting if one already exists); low stock uses the product's existing reorder level, fallback 5 packets.

- [ ] **Step 1: Write failing tests** (follow the data-test style used for other pharmacy queries in `tests/pharmacy/`): net equals cash + credit + card − returns for the open shift; a batch expiring in 89 days counts, 91 does not; a product at its reorder level counts as low; no open shift returns zeros; another branch's data never counts; actor without `shift.use` is refused.
- [ ] **Step 2: Run** `npx vitest run tests/pharmacy/pulse.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement** the query over the existing shift totals, batch and reorder-level tables; add the `usdRate` setting with validation (integer 1..1,000,000).
- [ ] **Step 4: Run.** Expected: PASS.
- [ ] **Step 5: Commit** `feat(pharmacy): header chips query and exchange-rate setting`.

### Task 6: Cashier frame, header strip and receipt tabs

**Files:**
- Create: `src/app/pharmacy/_ui/cashier/CashierScreen.tsx`, `PulseStrip.tsx`, `ReceiptTabs.tsx`
- Test: `tests/pharmacy/ui-cashier-frame.test.ts` (render with the project's existing React test helper, see `tests/pharmacy/ui-sell.test.ts`)

**Interfaces:**
- Consumes: `receiptsReducer`, `receiptsKey`/`parseReceipts`/`serializeReceipts`, `cashierKeyOf`, `pulse` result type, the props `SellWorkspace` takes today (`restaurantId`, `branchId`, `userId`, `shift`, `settings`, `perms`).
- Produces: `CashierScreen(props: SellWorkspaceProps)` (same props as the old workspace plus `pulse`), keeps the existing `aside` and `phoneAside` AI Doctor slots (rendered only when the Doctor is enabled, never taking space from the table); grid `"side main"` in RTL with side column 370px; `ReceiptTabs` shows number, running total (`estimateCart`), item count, a `＋` button, X per tab; `PulseStrip` shows the six chips from the prototype; clicking a warning chip puts that product's name in the search field.

- [ ] **Step 1: Write failing tests**: tabs render one per receipt with totals; `＋` at 6 receipts is absent; X is disabled on a receipt with items; Alt+2 switches; the side column is the first grid child; no element with `role="dialog"`.
- [ ] **Step 2: Run** `npx vitest run tests/pharmacy/ui-cashier-frame.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement** the frame; hold the receipts reducer state, persist on change through Task 2 helpers; follow prototype layout A and the project's tokens (not the prototype's colours); no motion.
- [ ] **Step 4: Run** the test, then open the screen in the browser pane at desktop width and check it against the prototype.
- [ ] **Step 5: Commit** `feat(pharmacy): cashier frame with open-receipt tabs`.

### Task 7: Sale-lines table

**Files:**
- Create: `src/app/pharmacy/_ui/cashier/SaleLinesTable.tsx`
- Test: `tests/pharmacy/ui-cashier-lines.test.ts`

**Interfaces:**
- Consumes: `CartLine`, `unitOf`, `estimateCart` line results, `perms`.
- Produces: `SaleLinesTable({ lines, selected, onSelect, onQty, onRemove, canSeeCost, canEditPrice })`. Columns exactly as the spec and prototype: row, item code, item name, qty, unit, unit price, line total, discount, unit price after discount, line total after discount, batch, expiry, balance; cost and profit only when `canSeeCost`. Arrow keys move selection, `+`/`-` change quantity, `Delete` removes (via Task 3 mapping). Blocked and over-stock lines are marked inline.

- [ ] **Step 1: Write failing tests**: 13 columns for a cashier, 15 with cost and profit for `canSeeCost`; blocked line shows its mark; selected row has `aria-selected`; a 200-line cart renders in a scroll container; a very long name truncates without widening the table.
- [ ] **Step 2: Run** `npx vitest run tests/pharmacy/ui-cashier-lines.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement** the table; cost and profit values come from the server only when permitted (props are absent otherwise).
- [ ] **Step 4: Run.** Expected: PASS. Compare against the prototype in the browser pane.
- [ ] **Step 5: Commit** `feat(pharmacy): cashier sale-lines table`.

### Task 8: Scan field, unit button, side column and keypad

**Files:**
- Create: `src/app/pharmacy/_ui/cashier/SideColumn.tsx`, `Keypad.tsx`; modify `CashierScreen.tsx`
- Test: `tests/pharmacy/ui-cashier-side.test.ts`

**Interfaces:**
- Consumes: `nextUnitId`, `parseQtyText`, scan queue (`createScanQueue`, `scanOutcome`), `estimateCart`, `paymentPreview`, `cashShortcuts`.
- Produces: scan/search field with the unit button beside it (cycles the selected line, or the unit of the next scanned item when no line is selected; inline message when there is nothing to cycle) and the inquiry button; `SideColumn` with total box (amount due, USD equivalent from `usdRate`, discount, item count), customer picker (existing `CustomerPicker`), receipt number, `Keypad` (digits 1 2 3 left to right, `C`, `.`, enter-quantity), and pay buttons for cash and credit (F2, F3).

- [ ] **Step 1: Write failing tests**: keypad digits typed set the selected line's quantity via `parseQtyText`; the unit button changes the selected line's unit and shows the new unit's price; with no valid next unit the message line says so and the line is unchanged; USD equivalent equals total / `usdRate`; credit button disabled without `perms.credit`.
- [ ] **Step 2: Run** `npx vitest run tests/pharmacy/ui-cashier-side.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement**; reuse existing scan handling from `SellWorkspace.tsx` (move, do not copy-paste, shared pieces into the new files).
- [ ] **Step 4: Run.** Expected: PASS.
- [ ] **Step 5: Commit** `feat(pharmacy): cashier scan field, unit button, side column and keypad`.

### Task 9: Inline work panel (payment, discount, hold, receipt)

**Files:**
- Create: `src/app/pharmacy/_ui/cashier/WorkPanel.tsx`
- Modify: `CashierScreen.tsx`
- Test: `tests/pharmacy/ui-cashier-flows.test.ts`

**Interfaces:**
- Consumes: the flows now in `SellDialogs.tsx` (cash and card/transfer payment, credit, discount with reason, held list, receipt after sale, prescription drawer `SellRx.tsx`/`PrescriptionDrawer.tsx`), `buildCartRequest`, `buildPayment`, `saleAttemptFor`, `holdSignature`, `outcomeUnknown`, receipt printing and drawer opening on the existing server paths.
- Produces: `WorkPanel({ flow, ... })` switching between idle, cash, credit, discount, held, ops, receipt, prescription; no `role="dialog"`. Armed two-tap buttons for discard and for closing a non-empty flow. After a successful sale the active tab is marked done; `F4`/`＋` or first scan replaces it.

- [ ] **Step 1: Write failing tests** over the pure parts (flow transitions and payload building) and one render test per flow: cash flow shows change due and cash shortcuts; payment blocked while a line is blocked or over stock or a prescription line lacks its record; discount above the limit asks for a reason; a held receipt returns into a new tab and keeps `fromHoldId`; done tab shows ✓; a lost response (`outcomeUnknown`) retries with the same keys (no double sale).
- [ ] **Step 2: Run** `npx vitest run tests/pharmacy/ui-cashier-flows.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement** by moving logic out of `SellDialogs.tsx` into panel sections; keep every server call and idempotency key identical to the old screen.
- [ ] **Step 4: Run** the test and the existing `tests/pharmacy/ui-sell.test.ts`. Expected: PASS.
- [ ] **Step 5: Commit** `feat(pharmacy): cashier inline work panel`.

### Task 10: Inquiry mode, line panels and return mode

**Files:**
- Create: `src/app/pharmacy/_ui/cashier/InquiryPanel.tsx`, `LinePanels.tsx`; modify `CashierScreen.tsx`
- Test: `tests/pharmacy/ui-cashier-inquiry.test.ts`

**Interfaces:**
- Consumes: product search query in `queries/sell.ts` (`search`), the existing substitutes-by-ingredient query if present (otherwise add `substitutes` to `queries/sell.ts`: same active ingredient, in stock, sellable), existing returns logic and slip in `queries/returns.ts` and `ReturnWorkspace.tsx`.
- Produces: inquiry mode (F7) shows price per unit ladder, stock, batches nearest-expiry first, substitutes; adds nothing to the receipt unless the user chooses "add"; `LinePanels` under the table shows batches, item details, substitutes for the selected line; return mode is a return against an original sale (lookup by receipt number, same batch and price, quantity cap) routed to the existing return actions; no drawer opens on return; a return slip prints; return without an original sale requires an approval role.

- [ ] **Step 1: Write failing tests**: inquiry does not change the cart; substitutes exclude the item itself and out-of-stock items; batches sorted by expiry; return quantity above the sold quantity is refused; return mode never calls the drawer-open path.
- [ ] **Step 2: Run** `npx vitest run tests/pharmacy/ui-cashier-inquiry.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run.** Expected: PASS.
- [ ] **Step 5: Commit** `feat(pharmacy): cashier inquiry, line panels and returns`.

### Task 11: Swap the sell route and remove the old screen

**Files:**
- Modify: `src/app/pharmacy/(app)/sell/page.tsx` (render `CashierScreen`, pass `pulse` and `usdRate`)
- Delete: `SellWorkspace.tsx`, `SellDialogs.tsx`, `SellLookPicker.tsx` and `sell-look` only if nothing else imports it (check with graphify/grep first)
- Modify: `tests/pharmacy/ui-sell.test.ts`, `ui-rx-credit-logic.test.ts`, `ui-shifts-returns.test.ts` (migrate to the new components; none may be deleted without an equivalent)
- Create: `docs`-level parity checklist in the PR description

**Interfaces:**
- Consumes: everything above.

- [ ] **Step 1: Parity check.** List every behaviour of the old `SellWorkspace`/`SellDialogs` (read both files) and tick each against the new screen; any gap becomes a failing test in the relevant earlier test file.
- [ ] **Step 2: Swap the page**, remove the old files, fix imports.
- [ ] **Step 3: Run** `npm run typecheck && npm run lint -- src && npm test`. Expected: all pass (known unrelated failures on main are listed in the PR).
- [ ] **Step 4: Browser check** at desktop width: sell, hold, resume, credit, discount, return, inquiry, 3 tabs, reload; screenshots for the PR.
- [ ] **Step 5: Commit** `feat(pharmacy): the cashier replaces the old sell screen`.

### Task 12: Messages in three languages

**Files:**
- Modify: `src/studio/messages/pharmacy/ar.ts`, `ckb.ts`, `en.ts`
- Test: the existing message-parity test (find it with grep for the pharmacy messages test); add keys under `pharmacy.cashier.*` and `pharmacy.entry.*`

- [ ] **Step 1:** Run the parity test after Tasks 6 to 10 and 13 add keys; it must fail on missing keys.
- [ ] **Step 2:** Add every Arabic label from the prototypes verbatim, then ckb and en translations.
- [ ] **Step 3:** Run `npm test`. Expected: parity passes.
- [ ] **Step 4: Commit** `feat(pharmacy): cashier and entry messages in ar, ckb, en`.

Note: do this task continuously, adding keys in the task that introduces each string, so no user-facing string is hardcoded; Task 12 is the final audit that none remain (grep the new folders for Arabic literals).

### Task 13: Fast entry logic and server action

**Files:**
- Create: `src/app/pharmacy/_ui/entry/entry-logic.ts`, `src/server/pharmacy/queries/product-history.ts`, an entry action in `src/server/pharmacy/actions/` (follow how `receipts.ts` actions are written)
- Test: `tests/pharmacy/entry-logic.test.ts`, `tests/pharmacy/product-history.test.ts`, `tests/pharmacy/entry-action.test.ts`

**Interfaces:**
- Produces:
  - `export function parseExpiry(text: string, now: Date): { ok: true; month: number; year: number } | { ok: false }` (digits `0828` or `08/28`; invalid month, past month, malformed → `ok: false`; the current month is valid)
  - `export function formatExpiryInput(raw: string): string` (digits only, inserts `/` after two)
  - `export function requiredMissing(form: EntryForm, known: boolean): keyof EntryForm | null` (new product: name, sell price, quantity, expiry; known product: quantity, expiry, purchase price)
  - `export const productHistory` query: `{ purchases, sales, returns }` rows for one product in the branch, newest first, limited to 50 each
  - entry action `addEntryLine`: adds one batch line (known product) or creates the product with defaults plus a batch (new) into the user's draft receiving document in the existing stock-receive model, creating the draft on first use; `finishEntry` posts it. Supplier is a link to a supplier record. The selling price field is applied only for users with `price.change` and then writes the normal price-history row.

- [ ] **Step 1: Write failing tests**: `parseExpiry('0828')` ok for a future date, `parseExpiry('01/20')` not ok, current month ok, `13/28` not ok; `formatExpiryInput('0828')` is `08/28`; `requiredMissing` per case; history is branch-scoped and sorted; action refuses a user without receive permission, ignores a price from a user without `price.change`, creates one draft for several lines, and a new product with only the four required fields saves using catalog defaults that pass the existing catalog validation.
- [ ] **Step 2: Run** `npx vitest run tests/pharmacy/entry-logic.test.ts tests/pharmacy/product-history.test.ts tests/pharmacy/entry-action.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement** the three units; reuse existing receipt and product creation server code, do not duplicate validation.
- [ ] **Step 4: Run.** Expected: PASS.
- [ ] **Step 5: Commit** `feat(pharmacy): fast entry logic, history query and action`.

### Task 14: Fast entry screen

**Files:**
- Create: `src/app/pharmacy/(app)/stock/entry/page.tsx`, `src/app/pharmacy/_ui/entry/EntryScreen.tsx`, `EntryForm.tsx`, `ProductHistory.tsx`; add a link from stock and from the cashier's toolbar "جميع العمليات"
- Test: `tests/pharmacy/ui-entry.test.ts`

**Interfaces:**
- Consumes: Task 13 units, existing barcode lookup in `src/server/pharmacy/barcodes.ts` and product search.
- Produces: one screen exactly as the prototype: large scan field; status line known/new/idle; known-product summary and six-field batch form (quantity, expiry, purchase price pre-filled, selling price pre-filled and read-only without `price.change`, lot optional, supplier pre-filled); new-product form with the four required fields and the optional ones visible on the same screen; history tables under the form; "entered now" side list; Enter moves to next field, Enter in the last field or F2 saves, Esc clears; after save the scan field is empty and focused; a "finish" button posts the draft receipt.

- [ ] **Step 1: Write failing tests**: known barcode shows the six-field form pre-filled from the last purchase; unknown barcode shows the new form with 4 required fields marked; missing required field shows an inline message naming the field and focuses it; invalid expiry shows the expiry message; after save the side list has the line and the scan field is empty; no dialogs.
- [ ] **Step 2: Run** `npx vitest run tests/pharmacy/ui-entry.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement** from the prototype and project tokens.
- [ ] **Step 4: Run** the test, then in the browser pane scan a known and an unknown barcode and enter two products without leaving the page.
- [ ] **Step 5: Commit** `feat(pharmacy): fast product entry screen`.

### Task 15: Final verification and review

- [ ] **Step 1:** `npm run typecheck && npm run lint -- src && npm test`; record any failures that exist on main separately.
- [ ] **Step 2:** Run the Review Focus scenarios by hand in the browser pane and attach screenshots.
- [ ] **Step 3:** Run `code-review`, fix confirmed findings.
- [ ] **Step 4:** Open the PR through the browser compare URL (the `gh` CLI is not installed here); description lists parity checklist, prototype behaviours left out, and the open points (prescription confirmation, tablets).

### Task 16: Simplified side navigation

The owner finds the side menu too complex (Home, Sell, Stock, Expiry, Reports, AI Doctor, then More with Catalog, Shifts, Sales, Returns, Prescriptions, Customers, Stock counts, Receiving, Transfers, Purchasing, Stock movements). Routes stay unchanged; only the navigation shrinks.

**Files:**
- Modify: `src/app/pharmacy/_ui/Rail.tsx`, `NavLink.tsx`, `MoreSheet.tsx`, the nav definition they read, and nav counts if keyed per item
- Test: `tests/pharmacy/ui-nav.test.ts`

**Interfaces:**
- Produces: five primary items only: Sell, Stock, Products (catalog), Customers, Reports. The AI Doctor keeps its own item right after Reports whenever it is enabled for the pharmacy (it is postponed, not removed; hidden exactly as today when disabled). Everything else (Expiry, Shifts, Sales, Returns, Prescriptions, Stock counts, Receiving, Transfers, Purchasing, Stock movements) sits behind one "More" entry, grouped under three headings (Daily, Stock, Purchasing). The Stock item opens the new fast entry screen first, with links to expiry, counts, receiving, transfers and movements as secondary links on the stock page. The red count badges (stock, expiry) stay on the items they belong to or on "More" when hidden. No page is removed.

- [ ] **Step 1: Write failing tests**: primary list has exactly 5 entries in this order (plus AI Doctor as a sixth only when enabled); every previously reachable route is still reachable from More or Stock; count badges still show for stock and expiry; role-hidden items stay hidden.
- [ ] **Step 2: Run** `npx vitest run tests/pharmacy/ui-nav.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement** by editing the nav definition; ar/ckb/en labels for the new group headings.
- [ ] **Step 4: Run.** Expected: PASS; check the rail and the phone bottom bar in the browser pane.
- [ ] **Step 5: Commit** `feat(pharmacy): simplified side navigation`.
