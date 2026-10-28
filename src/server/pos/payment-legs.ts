import type { PosLegMethodKey, PosPaymentMethodKey } from '@/server/domain/pos/payment-methods';
import { StudioError } from '@/server/studio/framework/result';
import { refuse } from './errors';

export interface LegInput {
  method: PosPaymentMethodKey;
  /** Integer IQD applied to the bill by this method. */
  amount: number;
  /** What a cash customer handed over; at least the cash the bill and tip need. Absent for other methods. */
  tendered?: number;
  reference?: string;
}

export interface TipInput {
  amount: number;
  method: PosPaymentMethodKey;
}

export interface CheckedLeg {
  method: PosLegMethodKey;
  amount: number;
  tendered: number | null;
  reference: string | null;
}

export interface CheckedPayment {
  legs: CheckedLeg[];
  tip: TipInput | null;
  change: number;
  /** Everything handed over, change included: cash tendered, plus the other methods' amounts and tip. */
  amountReceived: number;
  /** Integer IQD that stays in the drawer: the cash leg plus a cash tip. */
  cash: number;
}

const field = (name: string, text: string) => ({ [name]: text });

/**
 * Checks how a bill is paid: the legs add up to the total, each method appears once, only cash may be handed over in
 * excess (and gives the change), the other methods are switched on and exact, and a tip is between 0 and the total.
 * Throws a till refusal; returns the legs to store and the figures the receipt and the drawer need.
 */
export function checkLegs(total: number, legs: readonly LegInput[], tip: TipInput | null, enabled: readonly PosPaymentMethodKey[]): CheckedPayment {
  if (new Set(legs.map((leg) => leg.method)).size !== legs.length) throw refuse('INVALID', 'Use each payment method once', field('legs', 'Use each payment method once'));
  if (legs.reduce((sum, leg) => sum + leg.amount, 0) !== total) throw refuse('INVALID', 'The payments must add up to the total', field('legs', 'The payments must add up to the total'));
  if (tip !== null && (tip.amount < 0 || tip.amount > total)) throw refuse('INVALID', 'The tip cannot be more than the bill', field('tip', 'The tip cannot be more than the bill'));
  const methodsUsed = [...legs.map((leg) => leg.method), ...(tip && tip.amount > 0 ? [tip.method] : [])];
  for (const method of methodsUsed) {
    if (method !== 'CASH' && !enabled.includes(method)) throw refuse('CONFLICT', 'This payment method is switched off');
  }

  const cashTip = tip && tip.method === 'CASH' ? tip.amount : 0;
  const checked: CheckedLeg[] = [];
  let change = 0;
  let received = 0;
  for (const leg of legs) {
    if (leg.method === 'CASH') {
      const due = leg.amount + cashTip;
      const tendered = leg.tendered ?? due;
      if (tendered < due) throw new StudioError('INVALID', 'The amount is less than the total', { amountReceived: 'The amount is less than the total' });
      change = tendered - due;
      received += tendered;
      checked.push({ method: 'CASH', amount: leg.amount, tendered, reference: null });
    } else {
      if (leg.tendered !== undefined && leg.tendered !== leg.amount) {
        throw new StudioError('INVALID', 'Card and wallet payments take the exact total', { amountReceived: 'Card and wallet payments take the exact total' });
      }
      received += leg.amount;
      checked.push({ method: leg.method, amount: leg.amount, tendered: null, reference: leg.reference ?? null });
    }
  }
  // A cash tip with no cash leg (the bill went on a card): the tip itself is the cash handed over.
  if (cashTip > 0 && !legs.some((leg) => leg.method === 'CASH')) received += cashTip;
  if (tip && tip.method !== 'CASH') received += tip.amount;
  const cashLeg = checked.find((leg) => leg.method === 'CASH');
  return {
    legs: checked,
    tip: tip && tip.amount > 0 ? tip : null,
    change,
    amountReceived: received,
    cash: (cashLeg?.amount ?? 0) + cashTip,
  };
}

type StoredPayment = Parameters<typeof legsOf>[0] & { tipAmount: number; tipMethod: PosLegMethodKey | null };

/** Integer IQD of a payment that stays in the drawer: its cash legs plus a cash tip. */
export function cashIn(payment: StoredPayment, total: number): number {
  const cash = legsOf(payment, total)
    .filter((leg) => leg.method === 'CASH')
    .reduce((sum, leg) => sum + leg.amount, 0);
  return cash + (payment.tipMethod === 'CASH' ? payment.tipAmount : 0);
}

/** What a reversal gave back, by method: each leg of the payment it reversed, or the reversal's own method for an old row. */
export function refundLegs(reversal: { method: PosLegMethodKey; amount: number; payment?: { legs: { method: PosLegMethodKey; amount: number }[] } | null }): { method: PosLegMethodKey; amount: number }[] {
  const legs = reversal.payment?.legs ?? [];
  return legs.length > 0 ? legs.map((leg) => ({ method: leg.method, amount: leg.amount })) : [{ method: reversal.method, amount: reversal.amount }];
}

/** The legs of a stored payment; a payment from before legs existed is one leg of its own method for its snapshot total. */
export function legsOf(payment: { method: PosLegMethodKey; amountReceived: number; reference: string | null; legs?: { method: PosLegMethodKey; amount: number; tendered: number | null; reference: string | null }[] }, total: number): CheckedLeg[] {
  if (payment.legs && payment.legs.length > 0) return payment.legs.map((leg) => ({ method: leg.method, amount: leg.amount, tendered: leg.tendered, reference: leg.reference }));
  return [{ method: payment.method, amount: total, tendered: payment.method === 'CASH' ? payment.amountReceived : null, reference: payment.reference }];
}
