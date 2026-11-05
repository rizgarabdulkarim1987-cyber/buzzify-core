import { canPh, type PhRole } from '@/server/domain/pharmacy/permissions';
import { phNav, type PhNavKey } from '../nav';
import { blockedLines, type CartState, type Estimate } from '../sell-logic';
import { MAX_RECEIPTS, type OpenReceipt, type ReceiptsState } from '../sell-receipts';

/**
 * The cashier's other inline flows, pure: the discount limit, where a resumed hold and an item handed in land, why a receipt
 * cannot be held, and the "all operations" entries a role may open.
 */

// The discount -------------------------------------------------------------------------------------------------------------

/**
 * Whether the receipt's discounts (its lines' and its own together) are above the pharmacy's limit, the way the sale judges it
 * (`discountPolicy`: discount × 10000 > gross × limit in basis points). The server stays the authority: it also knows whether
 * this person may go over the limit at all.
 */
export function discountOverLimit(estimate: Pick<Estimate, 'grossMinor' | 'lineDiscountMinor' | 'invoiceDiscountMinor'>, maxPercent: number): boolean {
  const given = estimate.lineDiscountMinor + estimate.invoiceDiscountMinor;
  if (given <= 0n) return false;
  const limitBp = BigInt(Math.round(Math.min(100, Math.max(0, maxPercent)) * 100));
  return given * 10_000n > estimate.grossMinor * limitBp;
}

/** The sale will ask for a reason (at least 3 characters, the server's rule): the discount is over the limit and none is given. */
export const discountReasonNeeded = (cart: CartState, estimate: Pick<Estimate, 'grossMinor' | 'lineDiscountMinor' | 'invoiceDiscountMinor'>, maxPercent: number): boolean =>
  discountOverLimit(estimate, maxPercent) && cart.discountReason.trim().length < 3;

// Hold ------------------------------------------------------------------------------------------------------------------------

/**
 * Why the active receipt cannot be held, as a message key; `'nothing'` when there is nothing to hold (the key then keeps its
 * browser meaning); null when it can be held. A receipt with a sale in flight is never held (its lines are the lines being
 * paid); a marked line stops the hold as it did on the old screen.
 */
export function holdBlockKey(receipt: OpenReceipt): string | null {
  if (receipt.done || receipt.cart.lines.length === 0) return 'nothing';
  if (receipt.attempt) return 'pharmacy.cashier.hold.frozen';
  if (blockedLines(receipt.cart).length > 0) return 'pharmacy.sell.blocked.heldLines';
  return null;
}

/** A receipt that may be replaced as it is: empty or paid, with no sale in flight. */
const free = (r: OpenReceipt | undefined): boolean => !!r && r.attempt === null && (r.done || r.cart.lines.length === 0);

/**
 * Where a resumed hold opens: the receipt it is already open on (switch to it, never twice), the active receipt when that one is
 * empty or paid, else a new receipt; `'full'` when all MAX_RECEIPTS are open and the active one is in use.
 */
export function resumePlace(state: ReceiptsState, holdId: string): 'active' | 'new' | 'full' | { switchTo: number } {
  const open = state.receipts.findIndex((r) => !r.done && r.fromHoldId === holdId);
  if (open >= 0) return { switchTo: open };
  if (free(state.receipts[state.active])) return 'active';
  return state.receipts.length < MAX_RECEIPTS ? 'new' : 'full';
}

/** Where an item handed in from another screen lands: the active receipt, or (frozen by its sale) a new one; `'full'` when none can open. */
export function handInPlace(state: ReceiptsState): 'active' | 'new' | 'full' {
  const r = state.receipts[state.active];
  if (!r || r.done || (r.attempt === null && state.holding !== r.key)) return 'active';
  return state.receipts.length < MAX_RECEIPTS ? 'new' : 'full';
}

// All operations ------------------------------------------------------------------------------------------------------------

export type CashierOpKey = 'sales' | 'returns' | 'debt' | 'cash' | 'closeShift';
export interface CashierOp {
  key: CashierOpKey;
  href: string;
}

/**
 * The prototype's "all operations" list in its order, each routed to the existing screen that does it: today's sales, returns,
 * a customer paying debt, cash paid in or out and closing the shift (both on the shift screen). An entry shows only when the nav
 * lets this role open its screen. The prototype's "open the drawer without a sale" has no screen yet and is left out.
 */
const OPS: readonly { key: CashierOpKey; nav: PhNavKey; shift?: true }[] = [
  { key: 'sales', nav: 'sales' },
  { key: 'returns', nav: 'returns' },
  { key: 'debt', nav: 'customers' },
  // The shift screen also opens for reports; paying cash in or out and closing the shift need a person who works a shift.
  { key: 'cash', nav: 'shifts', shift: true },
  { key: 'closeShift', nav: 'shifts', shift: true },
];

export function cashierOps(role: PhRole | null): CashierOp[] {
  if (role === null) return [];
  const { primary, more } = phNav(role, { branchCount: 1, doctorEnabled: false });
  const allowed = new Map([...primary, ...more].map((item) => [item.key, item.href]));
  return OPS.flatMap((op) => {
    const href = allowed.get(op.nav);
    return href && (!op.shift || canPh(role, 'shift.use')) ? [{ key: op.key, href }] : [];
  });
}
