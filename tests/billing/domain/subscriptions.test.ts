import { describe, expect, it } from 'vitest';
import { dueTransition, effectiveStatus, graceEndsAt, isLive, type LifecycleView } from '@/server/domain/billing/subscriptions';

const end = new Date('2027-03-01T00:00:00Z');
const view = (over: Partial<LifecycleView>): LifecycleView => ({ status: 'ACTIVE', trialEndsAt: null, currentPeriodEnd: end, graceDays: 7, ...over });
const plus = (d: Date, ms: number) => new Date(d.getTime() + ms);
const DAY = 86_400_000;

describe('subscription lifecycle', () => {
  it('moves ACTIVE to GRACE once the period has ended', () => {
    expect(dueTransition(view({}), new Date('2027-03-01T00:00:01Z'))).toEqual({ to: 'GRACE', event: 'ENTERED_GRACE' });
    expect(dueTransition(view({}), end)).toBeNull();
  });

  it('moves GRACE to EXPIRED exactly when grace ends', () => {
    const grace = view({ status: 'GRACE' });
    expect(graceEndsAt(grace)).toEqual(plus(end, 7 * DAY));
    expect(dueTransition(grace, plus(end, 7 * DAY - 1000))).toBeNull();
    expect(dueTransition(grace, plus(end, 7 * DAY))).toEqual({ to: 'EXPIRED', event: 'EXPIRED' });
  });

  it('expires a trial with no grace', () => {
    const trialEndsAt = new Date('2027-02-10T00:00:00Z');
    const trial = view({ status: 'TRIAL', trialEndsAt });
    expect(dueTransition(trial, plus(trialEndsAt, 1000))).toEqual({ to: 'EXPIRED', event: 'EXPIRED' });
    expect(dueTransition(trial, trialEndsAt)).toBeNull();
  });

  it('leaves CANCELLED and EXPIRED alone', () => {
    const later = plus(end, 100 * DAY);
    expect(dueTransition(view({ status: 'CANCELLED' }), later)).toBeNull();
    expect(dueTransition(view({ status: 'EXPIRED' }), later)).toBeNull();
  });

  it('knows which statuses are live', () => {
    expect(isLive('TRIAL')).toBe(true);
    expect(isLive('ACTIVE')).toBe(true);
    expect(isLive('GRACE')).toBe(true);
    expect(isLive('EXPIRED')).toBe(false);
    expect(isLive('CANCELLED')).toBe(false);
  });

  it('resolves the effective status across several missed steps', () => {
    expect(effectiveStatus(view({}), plus(end, 30 * DAY))).toBe('EXPIRED');
    expect(effectiveStatus(view({}), plus(end, 3_600_000))).toBe('GRACE');
    expect(effectiveStatus(view({}), plus(end, -DAY))).toBe('ACTIVE');
  });
});
