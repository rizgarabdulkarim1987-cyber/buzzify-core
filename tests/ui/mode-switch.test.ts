import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { getTranslator } from '@/lib/messages';

const app = vi.hoisted(() => ({ current: null as unknown }));
vi.mock('@/ui/AppProviders', () => ({ useApp: () => app.current }));
vi.mock('next/navigation', () => ({ usePathname: () => '/demo/en' }));

import { GuestTools } from '@/ui/guest/GuestTools';
import { ModeSwitch } from '@/ui/menu/ModeSwitch';

function setApp(about: boolean) {
  app.current = {
    locale: 'en',
    table: null,
    t: getTranslator('en'),
    href: (path = '') => `/demo/en${path}`,
    tenant: { slug: 'demo', locales: ['en'], feedback: false, extras: { about, wheel: false, aboutTitle: { en: '', ar: '', ckb: '' } } },
  };
}

describe('the Explore / Full menu switch', () => {
  it('leads Explore to the restaurant page (wheel, offers) when that page is on', () => {
    setApp(true);
    const html = renderToStaticMarkup(createElement(ModeSwitch, { current: 'menu' }));
    expect(html).toContain('href="/demo/en/about"');
    expect(html).not.toContain('/explore');
    expect(html).toContain('href="/demo/en"');
  });

  it('keeps the scene Explore when the restaurant page is off', () => {
    setApp(false);
    expect(renderToStaticMarkup(createElement(ModeSwitch, { current: 'menu' }))).toContain('href="/demo/en/explore"');
  });

  it('leaves the header tools without the compass when the switch already carries Explore', () => {
    setApp(true);
    expect(renderToStaticMarkup(createElement(GuestTools, { showAbout: false }))).not.toContain('data-testid="about-link"');
    expect(renderToStaticMarkup(createElement(GuestTools))).toContain('data-testid="about-link"');
  });
});
