import { afterEach, describe, expect, it, vi } from 'vitest';
import { RetailConfigError, retailConfig } from '@/server/retail/config';

/**
 * The Retail products' own addresses (`RETAIL_URL_SUPERMARKET`, `_ELECTRONICS`, `_CLOTHING`): optional, checked like
 * `RETAIL_URL`, falling back to it. The handoff accepts a return at exactly these addresses and no other.
 */

const RETAIL = 'https://retail.buzzify-menu.online';
const CALLBACK = '/api/core/v1/handoff/callback';
const NAMES = ['RETAIL_URL', 'RETAIL_URL_SUPERMARKET', 'RETAIL_URL_ELECTRONICS', 'RETAIL_URL_CLOTHING'] as const;

afterEach(() => {
  for (const name of NAMES) vi.stubEnv(name, '');
  vi.stubEnv('NODE_ENV', 'test');
});

const failingVariable = (run: () => unknown) => {
  try {
    run();
  } catch (error) {
    return error instanceof RetailConfigError ? error.variable : 'other';
  }
  return null;
};

describe('the Retail product addresses', () => {
  it('fall back to RETAIL_URL when unset', () => {
    vi.stubEnv('RETAIL_URL', RETAIL);
    const config = retailConfig();
    for (const activity of ['SUPERMARKET', 'ELECTRONICS', 'CLOTHING'] as const) {
      expect(config.baseUrlFor(activity)).toBe(RETAIL);
      expect(config.callbackUrlFor(activity)).toBe(`${RETAIL}${CALLBACK}`);
    }
    expect(config.callbackUrls).toEqual([`${RETAIL}${CALLBACK}`]);
  });

  it('give each product its own address, and the handoff accepts exactly those and RETAIL_URL, once each', () => {
    vi.stubEnv('RETAIL_URL', RETAIL);
    vi.stubEnv('RETAIL_URL_SUPERMARKET', 'https://supermarket.buzzify.tech');
    vi.stubEnv('RETAIL_URL_ELECTRONICS', 'https://electronics.buzzify.tech/');
    vi.stubEnv('RETAIL_URL_CLOTHING', RETAIL);
    const config = retailConfig();
    expect(config.baseUrl).toBe(RETAIL);
    expect(config.baseUrlFor('ELECTRONICS')).toBe('https://electronics.buzzify.tech');
    expect(config.callbackUrlFor('SUPERMARKET')).toBe(`https://supermarket.buzzify.tech${CALLBACK}`);
    expect(config.callbackUrls).toEqual([`${RETAIL}${CALLBACK}`, `https://supermarket.buzzify.tech${CALLBACK}`, `https://electronics.buzzify.tech${CALLBACK}`]);
  });

  it('refuse a product address not written as an origin, naming its variable', () => {
    vi.stubEnv('RETAIL_URL', RETAIL);
    for (const bad of ['electronics.buzzify.tech', 'ftp://electronics.buzzify.tech', 'https://electronics.buzzify.tech/x', 'https://Electronics.buzzify.tech', 'https://electronics.buzzify.tech:443']) {
      vi.stubEnv('RETAIL_URL_ELECTRONICS', bad);
      expect(failingVariable(() => retailConfig().baseUrlFor('ELECTRONICS')), bad).toBe('RETAIL_URL_ELECTRONICS');
      expect(failingVariable(() => retailConfig().callbackUrls), bad).toBe('RETAIL_URL_ELECTRONICS');
    }
    vi.stubEnv('NODE_ENV', 'production');
    vi.stubEnv('RETAIL_URL_ELECTRONICS', 'http://electronics.buzzify.tech');
    expect(failingVariable(() => retailConfig().baseUrlFor('ELECTRONICS'))).toBe('RETAIL_URL_ELECTRONICS');
  });

  it('switch nothing on without RETAIL_URL', () => {
    vi.stubEnv('RETAIL_URL_ELECTRONICS', 'https://electronics.buzzify.tech');
    expect(retailConfig().enabled).toBe(false);
    expect(failingVariable(() => retailConfig().baseUrlFor('ELECTRONICS'))).toBe('RETAIL_URL');
  });
});
