import { afterEach, describe, expect, it, vi } from 'vitest';
import { RetailConfigError, retailConfig } from '@/server/retail/config';
import { RETAIL_MAX_SKEW_SECONDS, signRetailRequest, verifyRetailRequest } from '@/server/retail/signing';
import { MAX_SKEW_SECONDS, verifyRequest } from './contract-oracle';

const SECRET = 'a-sync-secret-of-thirty-two-chars!';
const OLD = 'the-previous-caller-secret-value';
const NOW = new Date('2026-11-01T10:00:00.000Z');
const PATH = '/api/core/v1/state?coreBusinessId=shop-1';
const BODY = '{"coreBusinessId":"shop-1","version":3}';

const at = (seconds: number) => new Date(NOW.getTime() + seconds * 1000);
const request = (headers: Record<string, string>, over: Partial<{ method: string; pathWithQuery: string; body: string }> = {}) => ({
  method: over.method ?? 'POST',
  pathWithQuery: over.pathWithQuery ?? PATH,
  body: over.body ?? BODY,
  headers: new Headers(headers),
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe('signing', () => {
  it("Studio's signature verifies with Retails' verifier", () => {
    expect(RETAIL_MAX_SKEW_SECONDS).toBe(MAX_SKEW_SECONDS);
    const headers = signRetailRequest('POST', PATH, BODY, SECRET, NOW);
    expect(headers['x-bz-timestamp']).toBe(String(NOW.getTime() / 1000));
    expect(verifyRequest({ method: 'POST', path: PATH, body: BODY, headers: new Headers(headers) }, [SECRET], NOW)).toEqual({ ok: true });
    // A GET signs the empty body; the method is signed upper case whatever case it was given in.
    const get = signRetailRequest('get', PATH, '', SECRET, NOW);
    expect(verifyRequest({ method: 'GET', path: PATH, body: '', headers: new Headers(get) }, [SECRET], NOW)).toEqual({ ok: true });
    // And Studio's verifier accepts what Studio signs.
    expect(verifyRetailRequest(request(headers), [SECRET], NOW)).toEqual({ ok: true });
  });

  it('verify accepts 120 s and refuses 121 s skew', () => {
    const headers = signRetailRequest('POST', PATH, BODY, SECRET, NOW);
    expect(verifyRetailRequest(request(headers), [SECRET], at(120))).toEqual({ ok: true });
    expect(verifyRetailRequest(request(headers), [SECRET], at(-120))).toEqual({ ok: true });
    expect(verifyRetailRequest(request(headers), [SECRET], at(121))).toEqual({ ok: false, reason: 'SKEW' });
    expect(verifyRetailRequest(request(headers), [SECRET], at(-121))).toEqual({ ok: false, reason: 'SKEW' });
  });

  it('previous caller secret accepted', () => {
    const headers = signRetailRequest('POST', PATH, BODY, OLD, NOW);
    expect(verifyRetailRequest(request(headers), [SECRET, OLD], NOW)).toEqual({ ok: true });
    expect(verifyRetailRequest(request(headers), [SECRET], NOW)).toEqual({ ok: false, reason: 'BAD_SIGNATURE' });
  });

  it('body, path, query and method tampering fail', () => {
    const headers = signRetailRequest('POST', PATH, BODY, SECRET, NOW);
    const bad = { ok: false, reason: 'BAD_SIGNATURE' };
    expect(verifyRetailRequest(request(headers, { body: `${BODY} ` }), [SECRET], NOW)).toEqual(bad);
    expect(verifyRetailRequest(request(headers, { pathWithQuery: '/api/core/v1/provision?coreBusinessId=shop-1' }), [SECRET], NOW)).toEqual(bad);
    expect(verifyRetailRequest(request(headers, { pathWithQuery: '/api/core/v1/state?coreBusinessId=shop-2' }), [SECRET], NOW)).toEqual(bad);
    expect(verifyRetailRequest(request(headers, { pathWithQuery: '/api/core/v1/state' }), [SECRET], NOW)).toEqual(bad);
    expect(verifyRetailRequest(request(headers, { method: 'PUT' }), [SECRET], NOW)).toEqual(bad);
    expect(verifyRetailRequest(request({ ...headers, 'x-bz-timestamp': String(Number(headers['x-bz-timestamp']) + 1) }), [SECRET], NOW)).toEqual(bad);
    expect(verifyRetailRequest(request({}), [SECRET], NOW)).toEqual({ ok: false, reason: 'MISSING' });
    expect(verifyRetailRequest(request({ 'x-bz-timestamp': headers['x-bz-timestamp'] }), [SECRET], NOW)).toEqual({ ok: false, reason: 'MISSING' });
  });

  it('non-hex or short signature fails without throwing', () => {
    const { 'x-bz-timestamp': timestamp, 'x-bz-signature': signature } = signRetailRequest('POST', PATH, BODY, SECRET, NOW);
    const bad = { ok: false, reason: 'BAD_SIGNATURE' };
    for (const given of [signature.slice(0, 63), signature.slice(0, 2), `${signature}00`, 'z'.repeat(64), signature.toUpperCase(), `${signature.slice(0, 63)}g`]) {
      expect(verifyRetailRequest(request({ 'x-bz-timestamp': timestamp, 'x-bz-signature': given }), [SECRET], NOW)).toEqual(bad);
    }
    for (const stamp of ['-1', '1e9', 'abc', '1234567890123', '1.5']) {
      expect(verifyRetailRequest(request({ 'x-bz-timestamp': stamp, 'x-bz-signature': signature }), [SECRET], NOW)).toEqual(bad);
    }
    // No secret at all accepts nothing.
    expect(verifyRetailRequest(request({ 'x-bz-timestamp': timestamp, 'x-bz-signature': signature }), [], NOW)).toEqual(bad);
  });

  it('config refuses http in production and a 15-char secret, naming only the variable', () => {
    vi.stubEnv('RETAIL_URL', '');
    expect(retailConfig().enabled).toBe(false);
    expect(() => retailConfig().baseUrl).toThrow(RetailConfigError);

    vi.stubEnv('RETAIL_URL', 'https://retail.example.com/');
    vi.stubEnv('RETAIL_SYNC_SECRET', SECRET);
    vi.stubEnv('RETAIL_CALLER_SECRET', OLD);
    vi.stubEnv('RETAIL_CALLER_SECRET_PREVIOUS', '');
    vi.stubEnv('RETAIL_HANDOFF_SECRET', 'a-handoff-secret-of-enough-length');
    const config = retailConfig();
    expect(config.enabled).toBe(true);
    expect(config.baseUrl).toBe('https://retail.example.com');
    expect(config.callbackUrl).toBe('https://retail.example.com/api/core/v1/handoff/callback');
    expect(config.syncSecret).toBe(SECRET);
    expect(config.callerSecrets).toEqual([OLD]);
    vi.stubEnv('RETAIL_CALLER_SECRET_PREVIOUS', SECRET);
    expect(retailConfig().callerSecrets).toEqual([OLD, SECRET]);

    const refusal = (read: () => unknown): RetailConfigError => {
      try {
        read();
      } catch (error) {
        if (error instanceof RetailConfigError) return error;
        throw error;
      }
      throw new Error('expected a RetailConfigError');
    };

    vi.stubEnv('NODE_ENV', 'production');
    vi.stubEnv('RETAIL_URL', 'http://retail.example.com');
    const http = refusal(() => retailConfig().baseUrl);
    expect(http.variable).toBe('RETAIL_URL');
    expect(http.message).not.toContain('retail.example.com');
    expect(refusal(() => retailConfig().callbackUrl).variable).toBe('RETAIL_URL');
    vi.stubEnv('RETAIL_URL', 'not a url');
    expect(refusal(() => retailConfig().baseUrl).variable).toBe('RETAIL_URL');

    const short = '123456789012345';
    for (const [variable, read] of [
      ['RETAIL_SYNC_SECRET', () => retailConfig().syncSecret],
      ['RETAIL_CALLER_SECRET', () => retailConfig().callerSecrets],
      ['RETAIL_CALLER_SECRET_PREVIOUS', () => retailConfig().callerSecrets],
      ['RETAIL_HANDOFF_SECRET', () => retailConfig().handoffSecret],
    ] as const) {
      const before = process.env[variable];
      vi.stubEnv(variable, short);
      const error = refusal(read);
      expect(error.variable).toBe(variable);
      expect(error.message).toContain(variable);
      expect(error.message).not.toContain(short);
      vi.stubEnv(variable, before ?? '');
    }
    // .env.example's placeholder, copied unchanged, is no secret.
    vi.stubEnv('RETAIL_HANDOFF_SECRET', 'generate with: openssl rand -base64 32');
    expect(refusal(() => retailConfig().handoffSecret).variable).toBe('RETAIL_HANDOFF_SECRET');
    vi.stubEnv('RETAIL_SYNC_SECRET', '');
    expect(refusal(() => retailConfig().syncSecret).variable).toBe('RETAIL_SYNC_SECRET');
  });
});
