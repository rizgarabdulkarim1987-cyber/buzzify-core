export type OrderStatus =
  | 'PENDING_APPROVAL'
  | 'OPEN'
  | 'READY'
  | 'BILL_REQUESTED'
  | 'PAID'
  | 'CANCELLED'
  | 'REJECTED';

// PAID, CANCELLED and REJECTED are locked: no transitions out. An order can be paid without asking for the bill first
// (a takeaway paid at the counter), but not before it is approved.
const TRANSITIONS: Record<OrderStatus, readonly OrderStatus[]> = {
  PENDING_APPROVAL: ['OPEN', 'REJECTED'],
  OPEN: ['READY', 'BILL_REQUESTED', 'PAID', 'CANCELLED'],
  READY: ['OPEN', 'BILL_REQUESTED', 'PAID', 'CANCELLED'],
  BILL_REQUESTED: ['OPEN', 'PAID', 'CANCELLED'],
  PAID: [],
  CANCELLED: [],
  REJECTED: [],
};

export function canTransition(from: OrderStatus, to: OrderStatus): boolean {
  return TRANSITIONS[from].includes(to);
}
