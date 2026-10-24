import { describe, expect, it } from 'vitest';
import { canTransition } from '@/server/domain/pos/order-state';

describe('canTransition', () => {
  it('allows the normal flow', () => {
    expect(canTransition('OPEN', 'READY')).toBe(true);
    expect(canTransition('OPEN', 'BILL_REQUESTED')).toBe(true);
    expect(canTransition('BILL_REQUESTED', 'PAID')).toBe(true);
  });
  it('allows paying an OPEN or READY order without a bill request', () => {
    expect(canTransition('OPEN', 'PAID')).toBe(true);
    expect(canTransition('READY', 'PAID')).toBe(true);
  });
  it('never pays an order that is still waiting for approval', () => {
    expect(canTransition('PENDING_APPROVAL', 'PAID')).toBe(false);
  });
  it('handles approval', () => {
    expect(canTransition('PENDING_APPROVAL', 'OPEN')).toBe(true);
    expect(canTransition('PENDING_APPROVAL', 'REJECTED')).toBe(true);
  });
  it('locks PAID, CANCELLED and REJECTED orders', () => {
    expect(canTransition('PAID', 'OPEN')).toBe(false);
    expect(canTransition('PAID', 'CANCELLED')).toBe(false);
    expect(canTransition('CANCELLED', 'OPEN')).toBe(false);
    expect(canTransition('REJECTED', 'OPEN')).toBe(false);
  });
  it('rejects skipping approval and same-state moves', () => {
    expect(canTransition('PENDING_APPROVAL', 'PAID')).toBe(false);
    expect(canTransition('OPEN', 'OPEN')).toBe(false);
  });
});
