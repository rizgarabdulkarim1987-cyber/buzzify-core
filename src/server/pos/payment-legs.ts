import type { PosLegMethodKey, PosPaymentMethodKey } from '@/server/domain/pos/payment-methods';
import { usdChange, usdNeeded } from '@/server/domain/pos/usd';
import { StudioError } from '@/server/studio/framework/result';
import { refuse } from './errors';

export interface LegInput {
  method: PosLegMethodKey;
  /** Integer IQD applied to the bill by this method. */
  amount: number;
  /** What a cash customer handed over; at least the cash the bill and tip need. Absent for other methods. */
  tendered?: number;
  reference?: string;
  /** Whole dollars handed over, for a CASH_USD leg only. */
  tenderedUsd?: number;
  /** The dinars per dollar the screen showed, for a CASH_USD leg only; the server's own rate must match it. */
  rate?: number;
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
  /** Whole dollars handed over (CASH_USD only; null otherwise and on legs stored before dollars). */
  tenderedUsd: number | null;
  /** The dinars per dollar the leg was taken at (CASH_USD only). */
  rate: number | null;
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
export function checkLegs(
  total: number,
  legs: readonly LegInput[],
  tip: TipInput | null,
  enabled: readonly PosPaymentMethodKey[],
  usd: { enabled: boolean; rate: number } = { enabled: false, rate: 0 },
): CheckedPayment {
  if (new Set(legs.map((leg) => leg.method)).size !== legs.length) throw refuse('INVALID', 'Use each payment method once', field('legs', 'Use each payment method once'));
  if (legs.reduce((sum, leg) => sum + leg.amount, 0) !== total) throw refuse('INVALID', 'The payments must add up to the total', field('legs', 'The payments must add up to the total'));
  if (tip !== null && (tip.amount < 0 || tip.amount > total)) throw refuse('INVALID', 'The tip cannot be more than the bill', field('tip', 'The tip cannot be more than the bill'));
  const methodsUsed = [...legs.map((leg) => leg.method), ...(tip && tip.amount > 0 ? [tip.method] : [])];
  for (const method of methodsUsed) {
    if (method === 'CASH_USD') {
      if (!usd.enabled || usd.rate <= 0) throw refuse('CONFLICT', 'This payment method is switched off');
    } else if (method !== 'CASH' && !enabled.includes(method)) throw refuse('CONFLICT', 'This payment method is switched off');
  }

  const cashTip = tip && tip.method === 'CASH' ? tip.amount : 0;
  const checked: CheckedLeg[] = [];
  let change = 0;
  let received = 0;
  for (const leg of legs) {
    if (leg.method !== 'CASH_USD' && (leg.tenderedUsd !== undefined || leg.rate !== undefined)) {
      throw refuse('INVALID', 'A dollar payment needs the dollars handed over and the rate', field('legs', 'A dollar payment needs the dollars handed over and the rate'));
    }
    if (leg.method === 'CASH_USD') {
      if (leg.tenderedUsd === undefined || leg.tenderedUsd < 1 || leg.rate === undefined || leg.tendered !== undefined) {
        throw refuse('INVALID', 'A dollar payment needs the dollars handed over and the rate', field('legs', 'A dollar payment needs the dollars handed over and the rate'));
      }
      if (leg.rate !== usd.rate) throw refuse('CONFLICT', 'The dollar rate changed. Check the bill and try again.');
      if (leg.tenderedUsd < usdNeeded(leg.amount, usd.rate)) {
        throw refuse('INVALID', 'The dollars handed over are less than the amount', field('legs', 'The dollars handed over are less than the amount'));
      }
      // The overpayment comes back in dinars from the dinar drawer, at the same rate.
      change += usdChange(leg.tenderedUsd, usd.rate, leg.amount);
      received += leg.tenderedUsd * usd.rate;
      checked.push({ method: 'CASH_USD', amount: leg.amount, tendered: null, reference: null, tenderedUsd: leg.tenderedUsd, rate: usd.rate });
    } else if (leg.method === 'CASH') {
      const due = leg.amount + cashTip;
      const tendered = leg.tendered ?? due;
      if (tendered < due) throw new StudioError('INVALID', 'The amount is less than the total', { amountReceived: 'The amount is less than the total' });
      change += tendered - due;
      received += tendered;
      checked.push({ method: 'CASH', amount: leg.amount, tendered, reference: null, tenderedUsd: null, rate: null });
    } else {
      if (leg.tendered !== undefined && leg.tendered !== leg.amount) {
        throw new StudioError('INVALID', 'Card and wallet payments take the exact total', { amountReceived: 'Card and wallet payments take the exact total' });
      }
      received += leg.amount;
      checked.push({ method: leg.method, amount: leg.amount, tendered: null, reference: leg.reference ?? null, tenderedUsd: null, rate: null });
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
export function legsOf(payment: { method: PosLegMethodKey; amountReceived: number; reference: string | null; legs?: { method: PosLegMethodKey; amount: number; tendered: number | null; reference: string | null; tenderedUsd?: number | null; rate?: number | null }[] }, total: number): CheckedLeg[] {
  if (payment.legs && payment.legs.length > 0) return payment.legs.map((leg) => ({ method: leg.method, amount: leg.amount, tendered: leg.tendered, reference: leg.reference, tenderedUsd: leg.tenderedUsd ?? null, rate: leg.rate ?? null }));
  return [{ method: payment.method, amount: total, tendered: payment.method === 'CASH' ? payment.amountReceived : null, reference: payment.reference, tenderedUsd: null, rate: null }];
}

/** The dinars given back for a stored payment: the cash leg's change after a cash tip, plus the change for any dollars. */
export function changeOf(legs: readonly CheckedLeg[], cashTip: number): number {
  const cash = legs.find((leg) => leg.method === 'CASH');
  const dinars = cash ? Math.max(0, (cash.tendered ?? 0) - cash.amount - cashTip) : 0;
  const dollars = legs.filter((leg) => leg.method === 'CASH_USD').reduce((sum, leg) => sum + usdChange(leg.tenderedUsd ?? 0, leg.rate ?? 0, leg.amount), 0);
  return dinars + dollars;
}

type UsdLegs = { legs?: { method: PosLegMethodKey; amount: number; tenderedUsd?: number | null; rate?: number | null }[] };

const usdOf = (payment: UsdLegs) => {
  const legs = (payment.legs ?? []).filter((leg) => leg.method === 'CASH_USD');
  return {
    dollars: legs.reduce((sum, leg) => sum + (leg.tenderedUsd ?? 0), 0),
    change: legs.reduce((sum, leg) => sum + usdChange(leg.tenderedUsd ?? 0, leg.rate ?? 0, leg.amount), 0),
  };
};

/**
 * What cash in dollars did to a drawer. A sale puts its dollars in and sends its dinar change out; reversing it is the exact
 * opposite (the dollars go back out at what was handed over, the dinar change comes back), so the two drawers stay balanced.
 */
export function usdDrawer(sold: readonly UsdLegs[], reversed: readonly UsdLegs[]) {
  const sales = sold.map(usdOf);
  const refunds = reversed.map(usdOf);
  const sum = (rows: { dollars: number; change: number }[], key: 'dollars' | 'change') => rows.reduce((total, row) => total + row[key], 0);
  return {
    received: sum(sales, 'dollars'),
    refunded: sum(refunds, 'dollars'),
    expectedUsd: sum(sales, 'dollars') - sum(refunds, 'dollars'),
    /** Dinars that left the drawer as change for dollars, net of the change a reversal took back. */
    dinarChange: sum(sales, 'change') - sum(refunds, 'change'),
  };
}
