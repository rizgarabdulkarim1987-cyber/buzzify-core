import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { getTranslator } from '@/lib/messages';
import type { Locale } from '@/lib/locale';
import type { AboutView } from '@/server/data/about';

const app = vi.hoisted(() => ({ current: null as unknown }));

vi.mock('@/ui/AppProviders', () => ({ useApp: () => app.current }));
vi.mock('@/ui/menu/Header', () => ({ Header: () => null }));
vi.mock('@/ui/cart/CartBar', () => ({ CartBar: () => null }));

import { AboutPage } from '@/ui/about/AboutPage';

function setApp(locale: Locale, numeralSystem: 'latn' | 'arab' = 'latn') {
  app.current = {
    locale,
    t: getTranslator(locale),
    href: (path = '') => `/demo/${locale}${path}`,
    tenant: { slug: 'demo', numeralSystem, locales: ['en', 'ar'], extras: { about: true, wheel: false, aboutTitle: { en: '', ar: '', ckb: '' } } },
  };
}

const view = (over: Partial<AboutView> = {}): AboutView => ({
  title: 'Explore',
  timeZone: 'Asia/Baghdad',
  today: 'tue',
  cover: null,
  story: [],
  offers: [],
  hours: null,
  address: null,
  contacts: {},
  gallery: [],
  ...over,
});

const render = (v: AboutView) => renderToStaticMarkup(createElement(AboutPage, { view: v }));

describe('AboutPage', () => {
  it('renders story text escaped, and never as html', () => {
    setApp('en');
    const html = render(view({ story: [{ type: 'paragraph', text: '<script>alert(1)</script> **bold**' }, { type: 'list', text: ['<img src=x onerror=1>'] }] }));
    expect(html).not.toContain('<script>');
    expect(html).not.toContain('<img src=x');
    expect(html).toContain('&lt;script&gt;alert(1)&lt;/script&gt; **bold**');
  });

  it('renders story links only as anchors with a safe address', () => {
    setApp('en');
    const html = render(view({ story: [{ type: 'paragraph', text: 'Visit', links: [{ text: 'our site', href: 'https://example.com' }, { text: 'menu', href: '/hall' }] }] }));
    expect(html).toContain('href="https://example.com"');
    expect(html).toContain('rel="noopener noreferrer"');
    expect(html).toContain('href="/hall"');
  });

  it('renders no section for an empty part', () => {
    setApp('en');
    const html = render(view({ story: [{ type: 'heading', text: 'Our story' }] }));
    expect(html).toContain('Our story');
    for (const word of ['Offers', 'Opening hours', 'Find us', 'Gallery']) expect(html).not.toContain(word);
  });

  it("renders an offer's until date in the visitor's numerals", () => {
    const offers = [{ id: 'o', title: 'Lunch', body: 'Soup', label: '-20%', image: null, until: new Date('2026-11-05T10:00:00Z'), link: null }];
    setApp('en');
    expect(render(view({ offers }))).toContain('Until 05/11/2026');
    setApp('ar', 'arab');
    expect(render(view({ offers }))).toContain('٠٥/١١/٢٠٢٦');
  });

  it('links an offer to its dish or category through the menu address', () => {
    setApp('en');
    const offer = (link: AboutView['offers'][number]['link']) => ({ id: 'o', title: 'Deal', body: '', label: '', image: null, until: null, link });
    expect(render(view({ offers: [offer({ kind: 'product', slug: 'soup' })] }))).toContain('href="/demo/en/p/soup"');
    expect(render(view({ offers: [offer({ kind: 'category', slug: 'coffee' })] }))).toContain('href="/demo/en#cat-coffee"');
    expect(render(view({ offers: [offer(null)] }))).not.toContain('<a href="/demo');
  });

  it('marks today in the hours table and shows an overnight range', () => {
    setApp('en');
    const hours = (['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'] as const).map((day) => ({
      day,
      ranges: day === 'mon' ? [{ open: '18:00', close: '02:00', overnight: true }] : [],
    }));
    const html = render(view({ hours }));
    expect(html.match(/aria-current="date"/g)).toHaveLength(1);
    expect(html).toMatch(/aria-current="date"[^>]*>[\s\S]*?Tuesday/);
    expect(html).toContain('18:00');
    expect(html).toContain('02:00');
    expect(html).toContain('Closed');
    expect(html).not.toContain('NaN');
  });

  it('is right-to-left in Arabic and Kurdish, and says nothing of it in English', () => {
    setApp('ar');
    expect(render(view({ story: [{ type: 'paragraph', text: 'مرحبا' }] }))).toContain('dir="rtl"');
    setApp('ckb');
    expect(render(view({ story: [{ type: 'paragraph', text: 'سڵاو' }] }))).toContain('dir="rtl"');
    setApp('en');
    expect(render(view({ story: [{ type: 'paragraph', text: 'Hello' }] }))).not.toContain('dir="rtl"');
  });

  it('wraps very long unbroken words instead of overflowing', () => {
    setApp('en');
    expect(render(view({ story: [{ type: 'paragraph', text: 'x'.repeat(300) }] }))).toContain('break-words');
  });

  it('shows phone, whatsapp and map as buttons, and social links with a safe rel', () => {
    setApp('en');
    const html = render(view({ address: 'Main St, Erbil', contacts: { phone: '+9647501234567', whatsapp: '+9647501234567', mapUrl: 'https://maps.example.com/x', social: { instagram: 'https://instagram.com/x' } } }));
    expect(html).toContain('href="tel:+9647501234567"');
    expect(html).toContain('href="https://wa.me/9647501234567"');
    expect(html).toContain('href="https://maps.example.com/x"');
    expect(html).toContain('Main St, Erbil');
    expect(html).toContain('href="https://instagram.com/x"');
  });
});
