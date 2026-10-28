import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { getTranslator } from '@/lib/messages';
import type { Locale } from '@/lib/locale';
import type { IntroView } from '@/server/data/intro';
import { IntroPage } from '@/ui/intro/IntroPage';

const image = { kind: 'image' as const, url: '/m/ad.webp', alt: 'Ad', width: 800, height: 400 };

const view = (over: Partial<IntroView> = {}): IntroView => ({
  background: null,
  overlay: 50,
  showLogo: true,
  logo: null,
  contacts: [],
  adverts: [],
  locales: ['en', 'ar', 'ckb'],
  defaultLocale: 'en',
  ...over,
});

const render = (v: IntroView, locale: Locale = 'en') => renderToStaticMarkup(createElement(IntroPage, { view: v, slug: 'demo', name: 'Demo Cafe', locale }));

describe('IntroPage', () => {
  it('renders a real link per language with the menu default first and the restaurant name as the title', () => {
    const html = render(view());
    const links = [...html.matchAll(/<a [^>]*href="(\/demo\/[a-z]+)"/g)].map((m) => m[1]);
    expect(links).toEqual(['/demo/en', '/demo/ar', '/demo/ckb']);
    expect(html).toContain('English');
    expect(html).toContain('العربية');
    expect(html).toContain('Demo Cafe');
  });

  it('puts a default language that is not English first', () => {
    const html = render(view({ defaultLocale: 'ar', locales: ['ar', 'en'] }));
    expect([...html.matchAll(/<a [^>]*href="(\/demo\/[a-z]+)"/g)].map((m) => m[1])).toEqual(['/demo/ar', '/demo/en']);
  });

  it('with one language renders a single Enter link', () => {
    const html = render(view({ locales: ['ar'], defaultLocale: 'ar' }), 'ar');
    expect([...html.matchAll(/<a [^>]*href="(\/demo\/[a-z]+)"/g)].map((m) => m[1])).toEqual(['/demo/ar']);
    expect(html).toContain(getTranslator('ar')('intro.enter'));
  });

  it('renders the photo background and no video tag when the background is an image', () => {
    const html = render(view({ background: { kind: 'image', url: '/m/bg.webp', width: 800, height: 600 } }));
    expect(html).toContain('/m/bg.webp');
    expect(html).not.toContain('<video');
  });

  it('renders a poster and a video tag for a video background', () => {
    const html = render(view({ background: { kind: 'video', url: '/m/bg.mp4', poster: '/m/bg-p.webp', width: 800, height: 600 } }));
    expect(html).toContain('<video');
    expect(html).toContain('poster="/m/bg-p.webp"');
    expect(html).toMatch(/muted/);
    expect(html).toContain('playsInline');
    expect(html).not.toContain('autoPlay');
  });

  it('renders the logo when there is one, as the title', () => {
    const html = render(view({ logo: { assetId: 'l', url: '/m/logo.png', width: 200, height: 80, svg: false, rasterKey: 'k' } }));
    expect(html).toContain('/m/logo.png');
    expect(html).toContain('alt="Demo Cafe"');
  });

  it('renders contact icons only for what the view carries', () => {
    expect(render(view())).not.toContain('tel:');
    const html = render(view({ contacts: [{ kind: 'instagram', href: 'https://instagram.com/x' }, { kind: 'phone', href: 'tel:+9647501234567' }] }));
    expect(html).toContain('href="https://instagram.com/x"');
    expect(html).toContain('href="tel:+9647501234567"');
    expect(html).toContain('rel="noopener noreferrer"');
  });

  it('shows no advert section with zero live adverts, and a card per advert otherwise', () => {
    expect(render(view())).not.toContain('data-testid="adverts"');
    const html = render(view({ adverts: [{ id: 'a1', image, alt: 'Big sale', linked: true }, { id: 'a2', image, alt: 'Plain', linked: false }] }));
    expect(html).toContain('data-testid="adverts"');
    expect(html).toContain('alt="Big sale"');
    expect(html).toContain('href="/demo/intro/ad/a1"');
    expect(html).not.toContain('href="/demo/intro/ad/a2"');
  });

  it('mirrors with dir=rtl for ar and ckb and not for en', () => {
    expect(render(view(), 'ar')).toContain('dir="rtl"');
    expect(render(view(), 'ckb')).toContain('dir="rtl"');
    expect(render(view(), 'en')).toContain('dir="ltr"');
  });

  it('darkens the background by the overlay', () => {
    expect(render(view({ overlay: 80 }))).toContain('0.8');
    expect(render(view({ overlay: 0 }))).toContain('0)');
  });
});
