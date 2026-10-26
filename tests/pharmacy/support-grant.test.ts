import { describe, expect, it } from 'vitest';
import { grantAllows, grantStatus, validateGrantRequest } from '@/server/domain/pharmacy/support-grant';

const now = new Date('2026-10-27T10:00:00Z');
const hours = (h: number, from = now) => new Date(from.getTime() + h * 3_600_000);
const base = {
  scopes: ['catalog.read'],
  reason: 'Investigating a stock mismatch',
  startsAt: now,
  expiresAt: hours(24),
  now,
  sensitiveConfirmed: false,
};

describe('support grant rules', () => {
  it('72 hours is the longest grant and 72h plus one minute is refused', () => {
    expect(validateGrantRequest({ ...base, expiresAt: hours(72) })).toEqual({ ok: true });
    const over = new Date(hours(72).getTime() + 60_000);
    expect(validateGrantRequest({ ...base, expiresAt: over })).toEqual({ ok: false, code: 'TOO_LONG' });
  });

  it('a reason shorter than 10 characters is refused', () => {
    expect(validateGrantRequest({ ...base, reason: 'too short' })).toEqual({ ok: false, code: 'REASON_REQUIRED' });
    expect(validateGrantRequest({ ...base, reason: '          ' })).toEqual({ ok: false, code: 'REASON_REQUIRED' });
  });

  it('an unknown scope is refused', () => {
    expect(validateGrantRequest({ ...base, scopes: ['catalog.read', 'db.write'] })).toEqual({
      ok: false,
      code: 'UNKNOWN_SCOPE',
    });
    expect(validateGrantRequest({ ...base, scopes: [] })).toEqual({ ok: false, code: 'NO_SCOPE' });
  });

  it('a sensitive scope needs sensitiveConfirmed', () => {
    expect(validateGrantRequest({ ...base, scopes: ['rx.read'] })).toEqual({
      ok: false,
      code: 'SENSITIVE_NOT_CONFIRMED',
    });
    expect(validateGrantRequest({ ...base, scopes: ['patients.read'], sensitiveConfirmed: true })).toEqual({ ok: true });
  });

  it('a grant that is already over is refused as past', () => {
    expect(validateGrantRequest({ ...base, startsAt: hours(-5), expiresAt: hours(-1) })).toEqual({
      ok: false,
      code: 'PAST',
    });
  });

  it('a grant is expired exactly at expiresAt (the boundary instant is expired)', () => {
    const grant = { startsAt: now, expiresAt: hours(1), revokedAt: null };
    expect(grantStatus(grant, new Date(hours(1).getTime() - 1))).toBe('active');
    expect(grantStatus(grant, hours(1))).toBe('expired');
  });

  it('a revoked grant is never active even inside its window', () => {
    const grant = { startsAt: now, expiresAt: hours(2), revokedAt: hours(0.5) };
    expect(grantStatus(grant, hours(1))).toBe('revoked');
    expect(grantAllows({ ...grant, scopes: ['catalog.read'] }, 'catalog.read', hours(1))).toBe(false);
  });

  it('grantAllows is false for a scope the grant does not list', () => {
    const grant = { startsAt: now, expiresAt: hours(2), revokedAt: null, scopes: ['catalog.read'] };
    expect(grantAllows(grant, 'catalog.read', hours(1))).toBe(true);
    expect(grantAllows(grant, 'stock.read', hours(1))).toBe(false);
  });

  it('a grant that starts in the future is pending', () => {
    const grant = { startsAt: hours(1), expiresAt: hours(2), revokedAt: null };
    expect(grantStatus(grant, now)).toBe('pending');
  });
});
