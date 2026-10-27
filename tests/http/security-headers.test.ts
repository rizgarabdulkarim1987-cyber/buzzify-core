import { describe, expect, it } from 'vitest';
import config from '../../next.config';

async function headersFor(path: string): Promise<Record<string, string>> {
  const rules = (await config.headers?.()) ?? [];
  const matching = rules.filter((rule) => {
    const pattern = new RegExp(`^${rule.source.replace('/:path*', '(/.*)?')}$`);
    return pattern.test(path);
  });
  return Object.fromEntries(matching.flatMap((rule) => rule.headers.map(({ key, value }) => [key.toLowerCase(), value])));
}

describe('security headers', () => {
  it('every response refuses MIME sniffing, plugins and foreign base URLs, and keeps the referrer to the origin', async () => {
    for (const path of ['/atelier/en', '/api/atelier/quote', '/studio/sign-in']) {
      const headers = await headersFor(path);
      expect(headers['x-content-type-options']).toBe('nosniff');
      expect(headers['referrer-policy']).toBe('strict-origin-when-cross-origin');
      expect(headers['strict-transport-security']).toBe('max-age=31536000');
      expect(headers['permissions-policy']).toBe('camera=(), microphone=(), geolocation=(), payment=()');
      expect(headers['content-security-policy']).toContain("object-src 'none'");
      expect(headers['content-security-policy']).toContain("base-uri 'self'");
      expect(headers['content-security-policy']).toContain("form-action 'self'");
    }
  });

  it('the Studio can be framed only by itself (its previews), and the public menu is not restricted', async () => {
    const studio = await headersFor('/studio/menus/abc');
    expect(studio['x-frame-options']).toBe('SAMEORIGIN');
    expect(studio['content-security-policy']).toContain("frame-ancestors 'self'");

    const menu = await headersFor('/atelier/en');
    expect(menu['x-frame-options']).toBeUndefined();
    expect(menu['content-security-policy']).not.toContain('frame-ancestors');
  });

  it('the till (/pos) can be framed only by itself, like the Studio', async () => {
    for (const path of ['/pos', '/pos/catalog']) {
      const till = await headersFor(path);
      expect(till['x-frame-options']).toBe('SAMEORIGIN');
      expect(till['content-security-policy']).toContain("frame-ancestors 'self'");
    }
  });

  it('the pharmacy can be framed only by itself, like the till', async () => {
    for (const path of ['/pharmacy', '/pharmacy/select']) {
      const pharmacy = await headersFor(path);
      expect(pharmacy['x-frame-options']).toBe('SAMEORIGIN');
      expect(pharmacy['content-security-policy']).toContain("frame-ancestors 'self'");
    }
  });

  it('the Studio root itself is covered, not only the pages under it', async () => {
    expect((await headersFor('/studio'))['x-frame-options']).toBe('SAMEORIGIN');
  });
});
