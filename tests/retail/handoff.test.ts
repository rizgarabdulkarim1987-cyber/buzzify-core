import { describe, expect, it } from 'vitest';
import { checkReturn, checkStateAndNonce, HANDOFF_TTL_SECONDS, signHandoff, type HandoffClaims } from '@/server/retail/handoff';
import { handoffNonce, verifyHandoff } from './contract-oracle';

/** The sign-in handoff's pure parts, judged by Retails' own `verifyHandoff` (the oracle). */

const SECRET = 'the-handoff-secret-shared-with-retails';
const CALLBACK = 'https://retail.test/api/core/v1/handoff/callback';
const NOW = new Date('2026-11-01T10:00:00.000Z');
const STATE = 'Zm9vYmFyYmF6cXV4cXV1eHF1dXhxdXV4cXV1eHF1dXg';

function claims(over: Partial<HandoffClaims> = {}): HandoffClaims {
  const iat = Math.floor(NOW.getTime() / 1000);
  return {
    aud: 'retail',
    iat,
    exp: iat + HANDOFF_TTL_SECONDS,
    nonce: handoffNonce(STATE),
    jti: '5f0c9a3e-8a6b-4f37-9d3c-0a1b2c3d4e5f',
    coreUserId: 'user-1',
    email: 'owner@example.test',
    emailVerified: true,
    name: 'Owner',
    coreBusinessId: 'shop-1',
    ...over,
  };
}

describe('signHandoff', () => {
  it("a token Studio signs passes Retails' verifyHandoff (oracle)", () => {
    const token = signHandoff(claims(), SECRET);
    const verdict = verifyHandoff(token, [SECRET], NOW);
    expect(verdict).toEqual({ ok: true, claims: claims() });
    expect(verifyHandoff(token, ['another-secret-of-enough-length'], NOW)).toEqual({ ok: false, reason: 'SIGNATURE' });
  });

  it('a staff token without coreBusinessId passes the oracle and carries no business', () => {
    const staff: HandoffClaims = claims();
    delete staff.coreBusinessId;
    const verdict = verifyHandoff(signHandoff(staff, SECRET), [SECRET], NOW);
    expect(verdict.ok).toBe(true);
    expect(verdict.ok && 'coreBusinessId' in verdict.claims).toBe(false);
  });

  it('nonce is copied byte for byte', () => {
    const nonce = handoffNonce(STATE);
    const verdict = verifyHandoff(signHandoff(claims({ nonce }), SECRET), [SECRET], NOW);
    expect(verdict.ok && verdict.claims.nonce).toBe(nonce);
  });

  it('exp - iat is 60', () => {
    expect(HANDOFF_TTL_SECONDS).toBe(60);
    const verdict = verifyHandoff(signHandoff(claims(), SECRET), [SECRET], new Date(NOW.getTime() + 61_000));
    expect(verdict).toEqual({ ok: false, reason: 'EXPIRED' });
  });
});

describe('checkReturn', () => {
  it('accepts the configured callback, exactly', () => {
    expect(checkReturn(CALLBACK, CALLBACK)).toBe(true);
  });

  it.each([
    ['nothing', null],
    ['empty', ''],
    ['another host', 'https://evil.test/api/core/v1/handoff/callback'],
    ['a sub-domain host', 'https://retail.test.evil.test/api/core/v1/handoff/callback'],
    ['a longer path', `${CALLBACK}/x`],
    ['a shorter path', 'https://retail.test/api/core/v1/handoff'],
    ['a query', `${CALLBACK}?x=1`],
    ['a fragment', `${CALLBACK}#x`],
    ['//host', '//retail.test/api/core/v1/handoff/callback'],
    ['a relative path', '/api/core/v1/handoff/callback'],
    ['userinfo', 'https://user@retail.test/api/core/v1/handoff/callback'],
    ['userinfo pointing elsewhere', 'https://retail.test@evil.test/api/core/v1/handoff/callback'],
    ['http instead of https', 'http://retail.test/api/core/v1/handoff/callback'],
    ['a case change in the host', 'https://RETAIL.test/api/core/v1/handoff/callback'],
    ['a case change in the path', 'https://retail.test/api/core/v1/handoff/Callback'],
    ['an explicit port', 'https://retail.test:443/api/core/v1/handoff/callback'],
    ['a trailing slash', `${CALLBACK}/`],
    ['whitespace around it', ` ${CALLBACK} `],
    ['a trailing dot host', 'https://retail.test./api/core/v1/handoff/callback'],
    ['an encoded path', 'https://retail.test/api/core/v1/handoff/%63allback'],
  ])('refuses %s', (_label, raw) => {
    expect(checkReturn(raw, CALLBACK)).toBe(false);
  });
});

describe('checkStateAndNonce', () => {
  const nonce = handoffNonce(STATE);

  it("accepts Retails' state and its nonce", () => {
    expect(checkStateAndNonce(STATE, nonce)).toBe(true);
  });

  it.each([
    ['no state', null, nonce],
    ['no nonce', STATE, null],
    ['a state shorter than 16', 'abcdefghijklmno', handoffNonce('abcdefghijklmno')],
    ['a state longer than 256', 'a'.repeat(257), handoffNonce('a'.repeat(257))],
    ['a state that is not base64url', `${STATE.slice(0, 40)}+/=`, handoffNonce(`${STATE.slice(0, 40)}+/=`)],
    ['a nonce of 42 chars', STATE, nonce.slice(0, 42)],
    ['a nonce of 44 chars', STATE, `${nonce}A`],
    ['a nonce that is not base64url', STATE, `${nonce.slice(0, 42)}=`],
    ['a nonce that is not the hash of the state', STATE, handoffNonce(`${STATE}x`)],
  ])('refuses %s', (_label, state, n) => {
    expect(checkStateAndNonce(state, n)).toBe(false);
  });

  it('accepts a state of 16 and of 256 chars', () => {
    for (const state of ['a'.repeat(16), 'b'.repeat(256)]) expect(checkStateAndNonce(state, handoffNonce(state))).toBe(true);
  });
});
