import { afterEach, describe, expect, it, vi } from 'vitest';
import { clientIp } from '@/server/http/client-ip';

const headers = (forwarded?: string) => new Headers(forwarded === undefined ? {} : { 'x-forwarded-for': forwarded });

describe('clientIp', () => {
  afterEach(() => vi.unstubAllEnvs());

  it('takes the address the nearest proxy saw, not what the browser wrote first', () => {
    // A proxy that appends: the browser's own claim comes first, the proxy's observation comes last.
    expect(clientIp(headers('1.2.3.4, 203.0.113.50'))).toBe('203.0.113.50');
  });

  it('is the only entry when the proxy replaces the header', () => {
    expect(clientIp(headers('198.51.100.7'))).toBe('198.51.100.7');
  });

  it('counts back past a second trusted proxy when TRUSTED_PROXY_HOPS says so', () => {
    vi.stubEnv('TRUSTED_PROXY_HOPS', '2');
    expect(clientIp(headers('9.9.9.9, 198.51.100.7, 10.0.0.2'))).toBe('198.51.100.7');
  });

  it('falls back to the first entry when there are fewer entries than hops', () => {
    vi.stubEnv('TRUSTED_PROXY_HOPS', '3');
    expect(clientIp(headers('198.51.100.7'))).toBe('198.51.100.7');
  });

  it('ignores a nonsense hop count', () => {
    vi.stubEnv('TRUSTED_PROXY_HOPS', 'lots');
    expect(clientIp(headers('1.2.3.4, 203.0.113.50'))).toBe('203.0.113.50');
  });

  it('is empty when no proxy header came', () => {
    expect(clientIp(headers())).toBe('');
    expect(clientIp(headers('  '))).toBe('');
  });
});
