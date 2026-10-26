import { describe, expect, it } from 'vitest';
import { ringProgress, tableStatus } from '@/server/domain/pos/table-status';

describe('tableStatus', () => {
  it('is FREE with no order', () => {
    expect(tableStatus(null)).toBe('FREE');
  });
  it('maps the four live statuses to themselves', () => {
    expect(tableStatus({ status: 'PENDING_APPROVAL' })).toBe('PENDING_APPROVAL');
    expect(tableStatus({ status: 'OPEN' })).toBe('BUSY');
    expect(tableStatus({ status: 'READY' })).toBe('READY');
    expect(tableStatus({ status: 'BILL_REQUESTED' })).toBe('BILL_REQUESTED');
  });
  it('is FREE for finished orders', () => {
    expect(tableStatus({ status: 'PAID' })).toBe('FREE');
    expect(tableStatus({ status: 'CANCELLED' })).toBe('FREE');
    expect(tableStatus({ status: 'REJECTED' })).toBe('FREE');
  });
  it('is PENDING_APPROVAL for a free table with a pending customer request; a busy table keeps its status', () => {
    expect(tableStatus(null, { hasPendingRequest: true })).toBe('PENDING_APPROVAL');
    expect(tableStatus({ status: 'PAID' }, { hasPendingRequest: true })).toBe('PENDING_APPROVAL');
    expect(tableStatus({ status: 'OPEN' }, { hasPendingRequest: true })).toBe('BUSY');
    expect(tableStatus({ status: 'BILL_REQUESTED' }, { hasPendingRequest: true })).toBe('BILL_REQUESTED');
    expect(tableStatus(null, { hasPendingRequest: false })).toBe('FREE');
  });
});

describe('ringProgress', () => {
  const t0 = new Date('2026-10-23T12:00:00Z');
  const after = (min: number) => new Date(t0.getTime() + min * 60_000);
  it('is 0 at the same instant', () => {
    expect(ringProgress(t0, t0, 60)).toBe(0);
  });
  it('is 0.5 after 30 minutes', () => {
    expect(ringProgress(t0, after(30), 60)).toBe(0.5);
  });
  it('with maxMinutes 90 is 0.5 at 45 minutes and capped at 1', () => {
    expect(ringProgress(t0, after(45), 90)).toBe(0.5);
    expect(ringProgress(t0, after(200), 90)).toBe(1);
  });
  it('is clamped to 1 after 90 minutes', () => {
    expect(ringProgress(t0, after(90), 60)).toBe(1);
  });
  it('is 0 when seatedAt is in the future', () => {
    expect(ringProgress(after(10), t0, 60)).toBe(0);
  });
  it('honours a custom maxMinutes', () => {
    expect(ringProgress(t0, after(15), 30)).toBe(0.5);
  });
  it('has no default: the business setting must always be passed (a missing one would be a silent wrong ring)', () => {
    // @ts-expect-error maxMinutes is required
    const missing = () => ringProgress(t0, t0);
    expect(typeof missing).toBe('function');
  });
});
