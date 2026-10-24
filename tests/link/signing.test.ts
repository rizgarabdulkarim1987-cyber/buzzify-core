import { describe, expect, it } from 'vitest';
import { bodyHash, canonicalRequest, signRequest, verifyRequest } from '@/server/domain/link/signing';

const SECRET = 'bzl_test_secret_0123456789abcdef0123456789abcdef';
const TS = 1790000000;
const PUT_PATH = '/api/link/v1/products/prod_1/availability';
const PUT_BODY = '{"available":false}';

const headersFor = (signature: string, timestamp = String(TS), linkId = 'link_12345678') => ({
  'x-link-id': linkId,
  'x-link-timestamp': timestamp,
  'x-link-signature': signature,
});

describe('link request signing (contract 3.1)', () => {
  it('T1 reproduces the contract vectors', () => {
    expect(bodyHash(PUT_BODY)).toBe('9c9729d235cfd4897778afaf5651db6b7e91ca68f8c5d052d66de5e09734d668');
    expect(signRequest(SECRET, 'PUT', PUT_PATH, TS, PUT_BODY)).toBe(
      'c437b536f08db5c7d27c279efa15ad01e666da046fd032c71aef4b8ab62165f3',
    );
    expect(signRequest(SECRET, 'GET', '/api/link/v1/catalog', TS, '')).toBe(
      'c9f53819790e801287bcc4fd80302ec8716a7c9ca53f4d3a30a1901fea682c5a',
    );
  });

  it('hashes an empty body to the well-known digest', () => {
    expect(bodyHash('')).toBe('e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855');
    expect(bodyHash(new Uint8Array())).toBe(bodyHash(''));
  });

  it('T2 any changed part gives a different signature and is refused', () => {
    const good = signRequest(SECRET, 'PUT', PUT_PATH, TS, PUT_BODY);
    const variants = [
      signRequest(SECRET, 'PUT', PUT_PATH, TS, PUT_BODY.replace('false', 'true')),
      signRequest(SECRET, 'POST', PUT_PATH, TS, PUT_BODY),
      signRequest(SECRET, 'PUT', `${PUT_PATH}?x=1`, TS, PUT_BODY),
      signRequest(SECRET, 'PUT', PUT_PATH, TS + 1, PUT_BODY),
    ];
    for (const v of variants) {
      expect(v).not.toBe(good);
      const verdict = verifyRequest({ secret: SECRET, headers: headersFor(v), method: 'PUT', pathWithQuery: PUT_PATH, body: PUT_BODY, now: TS * 1000 });
      expect(verdict).toEqual({ ok: false, status: 401, code: 'badSignature' });
    }
    expect(verifyRequest({ secret: SECRET, headers: headersFor(good), method: 'PUT', pathWithQuery: PUT_PATH, body: PUT_BODY, now: TS * 1000 })).toEqual({ ok: true, linkId: 'link_12345678' });
  });

  it('upper-cases the method in the canonical string', () => {
    expect(canonicalRequest('put', '/p', 1, '')).toBe(canonicalRequest('PUT', '/p', 1, ''));
  });

  it('T3 a timestamp more than 300 s away is stale, exactly 300 s is fine', () => {
    const sig = (t: number) => signRequest(SECRET, 'GET', '/api/link/v1/catalog', t, '');
    const check = (t: number, nowSec: number) =>
      verifyRequest({ secret: SECRET, headers: headersFor(sig(t), String(t)), method: 'GET', pathWithQuery: '/api/link/v1/catalog', body: '', now: nowSec * 1000 });
    expect(check(TS, TS + 301)).toEqual({ ok: false, status: 401, code: 'staleTimestamp' });
    expect(check(TS + 301, TS)).toEqual({ ok: false, status: 401, code: 'staleTimestamp' });
    expect(check(TS, TS + 300).ok).toBe(true);
    expect(check(TS, TS - 300).ok).toBe(true);
  });

  it('rejects malformed headers before anything else', () => {
    const base = { secret: SECRET, method: 'GET', pathWithQuery: '/x', body: '', now: TS * 1000 };
    const bad = [
      {},
      headersFor('abc'),
      headersFor('A'.repeat(64)),
      headersFor('a'.repeat(64), 'abc'),
      headersFor('a'.repeat(64), String(TS), 'short'),
      headersFor('a'.repeat(64), String(TS), 'bad id with spaces'),
    ];
    for (const headers of bad) {
      expect(verifyRequest({ ...base, headers })).toEqual({ ok: false, status: 401, code: 'badSignature' });
    }
  });

  it('a different secret never verifies', () => {
    const sig = signRequest('bzl_other', 'GET', '/x', TS, '');
    expect(verifyRequest({ secret: SECRET, headers: headersFor(sig), method: 'GET', pathWithQuery: '/x', body: '', now: TS * 1000 })).toEqual({ ok: false, status: 401, code: 'badSignature' });
  });
});
