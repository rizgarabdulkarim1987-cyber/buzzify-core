export type Fulfillment = 'NEW' | 'PREPARING' | 'READY' | 'OUT' | 'DELIVERED' | 'PICKED_UP';
export type OffPremiseKind = 'TAKEAWAY' | 'DELIVERY';

const FORWARD: Record<OffPremiseKind, Partial<Record<Fulfillment, readonly Fulfillment[]>>> = {
  TAKEAWAY: { NEW: ['PREPARING'], PREPARING: ['READY'], READY: ['PICKED_UP'] },
  DELIVERY: { NEW: ['PREPARING'], PREPARING: ['READY'], READY: ['OUT'], OUT: ['DELIVERED'] },
};

/** Only a step back to the kitchen (READY) or back from the road (OUT) exists; everything else is final. */
const BACK: Partial<Record<Fulfillment, Fulfillment>> = { READY: 'PREPARING', OUT: 'READY' };

/** The moves open from this state: one forward step and, where one exists, one step back. */
export function nextSteps(kind: OffPremiseKind, from: Fulfillment): { forward: Fulfillment | null; back: Fulfillment | null } {
  return { forward: FORWARD[kind][from]?.[0] ?? null, back: BACK[from] ?? null };
}

export function canAdvance(kind: OffPremiseKind, from: Fulfillment, to: Fulfillment): boolean {
  const steps = nextSteps(kind, from);
  return steps.forward === to || steps.back === to;
}

/** A finished fulfillment: nothing is left to do for the customer. */
export const isFinished = (fulfillment: Fulfillment): boolean => fulfillment === 'DELIVERED' || fulfillment === 'PICKED_UP';
