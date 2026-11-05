import { creditPaymentsOf } from '../credit-logic';
import { prescriptionGate, type RxLine } from '../prescription-logic';
import {
  blockedLines,
  buildCartRequest,
  buildPayment,
  overSellable,
  parseMoney,
  plainMinor,
  unitOf,
  type CartState,
  type Currency,
  type Estimate,
  type PayDraft,
  type PayMethod,
  type SaleAttempt,
} from '../sell-logic';

/**
 * The cashier's payment flows, pure: why Pay is held back, the drafts the cash and credit flows send, and the sale request.
 * The request is the old sale screen's (`SellWorkspace.submitPay`) to the letter: same cart body, same payments, same keys.
 */

/** The payment flows of the work panel (discount, held receipts, prescription and the rest come with Task 9b). */
export type WorkFlow = 'cash' | 'credit';

/** The receipt's lines as the prescription rules read them. */
export const rxLinesOf = (cart: CartState): RxLine[] => cart.lines.map((l) => ({ productId: l.productId, name: l.name, rxLevel: l.rxLevel, qty: l.qty, unitBaseQty: unitOf(l).baseQty }));

/**
 * Why Pay is held back, as a message key; null when the receipt can be paid. The old screen's reasons in its order, plus a
 * quantity over the stock (the cashier blocks it before the server does). The prescription gate is the existing one: a
 * controlled line needs its recorded prescription, and any prescription line needs the dispensing permission.
 */
export function payBlockKey(
  cart: CartState,
  estimate: Pick<Estimate, 'unpricedCount' | 'invalidCount' | 'totalMinor'>,
  opts: { mayDispense: boolean; prescriptionId: string | null; controlledMaxQty: number; controlledEnabled: boolean },
): string | null {
  if (cart.lines.length === 0) return 'pharmacy.sell.blocked.empty';
  if (blockedLines(cart).length > 0) return 'pharmacy.sell.blocked.heldLines';
  if (estimate.unpricedCount > 0) return 'pharmacy.sell.blocked.unpriced';
  if (estimate.invalidCount > 0) return 'pharmacy.sell.blocked.invalid';
  if (overSellable(cart).size > 0) return 'pharmacy.cashier.blocked.overStock';
  const rx = rxLinesOf(cart);
  if (!opts.mayDispense && rx.some((l) => l.rxLevel === 'RX' || l.rxLevel === 'RESTRICTED')) return 'pharmacy.sell.blocked.rx';
  const gate = prescriptionGate(rx, opts.prescriptionId, opts.controlledMaxQty, opts.controlledEnabled);
  if (gate) return `pharmacy.sell.blocked.${gate}`;
  if (cart.lines.some((l) => l.batchId && l.batchReason.trim().length < 3)) return 'pharmacy.sell.batch.reasonNeeded';
  if (estimate.totalMinor <= 0n) return 'pharmacy.sell.blocked.zero';
  return null;
}

/** The flow a sale in flight was sent from: a retry opens it again, filled in as it was sent (so its keys still match). */
export const flowOfAttempt = (attempt: SaleAttempt): WorkFlow => (attempt.credit ? 'credit' : 'cash');

/** The cash flow's starting draft: empty (the exact total), or the payment of a cash attempt in flight as it was sent. */
export function cashDraftOf(attempt: SaleAttempt | null, currency: Currency): PayDraft {
  if (!attempt || attempt.credit) return { method: 'CASH', tendered: '', reference: '' };
  return { method: attempt.method, tendered: plainMinor(BigInt(attempt.amountMinor), currency), reference: attempt.reference };
}

/** What the credit flow asks: what is paid now (by `method`), the rest goes on the customer's account. */
export interface CreditInput {
  method: PayMethod;
  /** Paid now, as typed; empty = nothing now. */
  now: string;
  reference: string;
}

/** The credit flow's starting input: nothing paid now, or the part paid now of a credit attempt in flight. */
export function creditInputOf(attempt: SaleAttempt | null, currency: Currency): CreditInput {
  if (!attempt?.credit) return { method: 'CASH', now: '', reference: '' };
  return { method: attempt.method, now: attempt.amountMinor === '0' ? '' : plainMinor(BigInt(attempt.amountMinor), currency), reference: attempt.reference };
}

/**
 * The credit flow as the old payment's draft: the account takes the total less what is paid now, and what is paid now is handed
 * over exactly (no change). Null when what is paid now cannot be read. The limit and the rest are judged by `creditPreview`.
 */
export function creditDraftOf(input: CreditInput, customerId: string, totalMinor: bigint, currency: Currency): PayDraft | null {
  const now = input.now.trim() === '' ? 0n : parseMoney(input.now, currency);
  if (now === null) return null;
  const onAccount = totalMinor - now;
  return {
    method: input.method,
    tendered: now === 0n ? '' : plainMinor(now, currency),
    reference: input.reference,
    credit: { customerId, amount: plainMinor(onAccount > 0n ? onAccount : 0n, currency) },
  };
}

/**
 * The sale request, exactly as the old screen sent it: the cart body with the attempt's sale key, then one payment with the
 * attempt's payment key, or (part on account) the other method first and CREDIT with its own key, the customer, the recorded
 * prescription and the hold it completes. Null when the cart cannot be built.
 */
export function saleRequestOf(
  cart: CartState,
  currency: Currency,
  attempt: SaleAttempt,
  draft: PayDraft,
  amountMinor: bigint,
  onAccount: { minor: bigint } | null,
  prescriptionId: string | null,
  fromHoldId: string | null,
) {
  const base = buildCartRequest(cart, currency, '');
  if (!base) return null;
  return {
    ...base,
    clientKey: attempt.key,
    payments:
      draft.credit && onAccount && attempt.creditKey
        ? creditPaymentsOf(draft, onAccount.minor, amountMinor, { paymentKey: attempt.paymentKey, creditKey: attempt.creditKey })
        : [buildPayment(draft, amountMinor, attempt.paymentKey)],
    ...(draft.credit && onAccount ? { customerId: draft.credit.customerId } : {}),
    ...(prescriptionId ? { prescriptionId } : {}),
    ...(fromHoldId ? { fromHoldId } : {}),
  };
}

/** Refusals that mean the recorded prescription cannot be used any more: the receipt lets go of it (as the old screen did). */
export const RX_DROP_CODES: readonly string[] = ['PRESCRIPTION_NOT_FOUND', 'PRESCRIPTION_USED', 'RX_EXPIRED', 'RX_DATE_FUTURE', 'PATIENT_REQUIRED'];
