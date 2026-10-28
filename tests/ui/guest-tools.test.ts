import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { getTranslator } from '@/lib/messages';
import type { Locale } from '@/lib/locale';

const app = vi.hoisted(() => ({ current: null as unknown }));

vi.mock('@/ui/AppProviders', () => ({ useApp: () => app.current }));
vi.mock('next/navigation', () => ({ usePathname: () => '/demo/en' }));

import { GuestTools } from '@/ui/guest/GuestTools';

function setApp(about: boolean, aboutTitle: Record<'en' | 'ar' | 'ckb', string> = { en: '', ar: '', ckb: '' }, locale: Locale = 'en') {
  app.current = {
    locale,
    table: null,
    t: getTranslator(locale),
    href: (path = '') => `/demo/${locale}${path}`,
    tenant: { slug: 'demo', locales: ['en', 'ar'], feedback: false, extras: { about, wheel: false, aboutTitle } },
  };
}

const render = () => renderToStaticMarkup(createElement(GuestTools));

describe('GuestTools about link', () => {
  beforeEach(() => setApp(false));

  it('is absent while the About tab is off', () => {
    expect(render()).not.toContain('data-testid="about-link"');
  });

  it('shows the default title when the restaurant set none, in the guest language', () => {
    setApp(true);
    const html = render();
    expect(html).toContain('data-testid="about-link"');
    expect(html).toContain('href="/demo/en/about"');
    expect(html).toContain('Explore');
    setApp(true, { en: '', ar: '', ckb: '' }, 'ar');
    expect(render()).toContain('استكشف');
  });

  it("shows the restaurant's own title for the language", () => {
    setApp(true, { en: 'Our story', ar: 'عنّا', ckb: '' });
    expect(render()).toContain('Our story');
    setApp(true, { en: 'Our story', ar: 'عنّا', ckb: '' }, 'ar');
    expect(render()).toContain('عنّا');
  });
});
