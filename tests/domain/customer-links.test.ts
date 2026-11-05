import { describe, expect, it } from 'vitest';
import { customerLinks, customerMessage } from '@/server/domain/customer-links';

const hosts = { studioHost: 'hive.example.test', pharmacyHost: 'leaf.example.test', publicOrigin: 'https://menu.example.test' };

describe('customerLinks', () => {
  it('gives a restaurant its sign-in, its till and a link per menu', () => {
    const links = customerLinks({ sector: 'RESTAURANT', hasCashier: true, menus: [{ name: 'Dinner', slug: 'atelier' }], hosts });
    expect(links).toEqual([
      { kind: 'signIn', label: null, url: 'https://hive.example.test/studio/sign-in' },
      { kind: 'cashier', label: null, url: 'https://hive.example.test/pos' },
      { kind: 'menu', label: 'Dinner', url: 'https://menu.example.test/atelier' },
    ]);
  });

  it('leaves out the till when the restaurant has no Cashier', () => {
    const kinds = customerLinks({ sector: 'RESTAURANT', hasCashier: false, menus: [], hosts }).map((link) => link.kind);
    expect(kinds).toEqual(['signIn']);
  });

  it('sends a pharmacy to the pharmacy host, with no till and no menu', () => {
    const links = customerLinks({ sector: 'PHARMACY', hasCashier: true, menus: [{ name: 'x', slug: 'x' }], hosts });
    expect(links).toEqual([{ kind: 'pharmacy', label: null, url: 'https://leaf.example.test/pharmacy' }]);
  });

  it('falls back to the studio host while no pharmacy host is set', () => {
    const links = customerLinks({ sector: 'PHARMACY', hasCashier: false, menus: [], hosts: { ...hosts, pharmacyHost: null } });
    expect(links[0]?.url).toBe('https://hive.example.test/pharmacy');
  });

  it('gives nothing when no studio host is configured', () => {
    expect(customerLinks({ sector: 'RESTAURANT', hasCashier: true, menus: [], hosts: { ...hosts, studioHost: null } })).toEqual([]);
  });

  it('encodes a slug and drops a trailing slash on the menu origin', () => {
    const links = customerLinks({ sector: 'RESTAURANT', hasCashier: false, menus: [{ name: 'M', slug: 'a b' }], hosts: { ...hosts, publicOrigin: 'https://menu.example.test/' } });
    expect(links.at(-1)?.url).toBe('https://menu.example.test/a%20b');
  });
});

describe('customerMessage', () => {
  const links = customerLinks({ sector: 'RESTAURANT', hasCashier: true, menus: [{ name: 'Dinner', slug: 'atelier' }], hosts });

  it('lists every link and the sign-in email, and never a password', () => {
    const text = customerMessage(links, 'owner@example.test');
    for (const link of links) expect(text).toContain(link.url);
    expect(text).toContain('owner@example.test');
    expect(text.toLowerCase()).not.toContain('password:');
  });

  it('is empty when there is nothing to send', () => {
    expect(customerMessage([], 'owner@example.test')).toBe('');
  });
});
