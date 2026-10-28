import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { getTranslator } from '@/lib/messages';
import type { Locale } from '@/lib/locale';
import type { AboutView } from '@/server/data/about';
import type { WheelSliceView } from '@/server/data/wheel';

const app = vi.hoisted(() => ({ current: null as unknown }));

vi.mock('@/ui/AppProviders', () => ({ useApp: () => app.current }));
vi.mock('@/ui/menu/Header', () => ({ Header: () => null }));
vi.mock('@/ui/cart/CartBar', () => ({ CartBar: () => null }));
vi.mock('@/ui/wheel/useWheel', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/ui/wheel/useWheel')>()),
  useWheel: () => ({ state: { status: 'loading' }, phase: 'idle', rotation: 0, result: null, reduced: false, spin() {}, again() {} }),
}));

import { AboutPage } from '@/ui/about/AboutPage';
import { angleFor, TURNS } from '@/ui/wheel/useWheel';
import { WheelView } from '@/ui/wheel/WheelSection';

function setApp(locale: Locale) {
  app.current = {
    locale,
    t: getTranslator(locale),
    href: (path = '') => `/demo/${locale}${path}`,
    price: (amount: number) => `${amount} IQD`,
    tenant: { slug: 'demo', numeralSystem: 'latn', locales: ['en', 'ar'], extras: { about: true, wheel: true, aboutTitle: { en: '', ar: '', ckb: '' } } },
  };
}

const slice = (n: number, name = `Dish ${n}`): WheelSliceView => ({ productId: `p${n}`, slug: `dish-${n}`, name, price: 1000 * n, photo: { url: `/m/${n}.webp`, width: 400, height: 300 }, label: n === 1 ? '10% off' : '' });
const slices = (count: number) => Array.from({ length: count }, (_, index) => slice(index + 1));

const props = (over: Record<string, unknown> = {}) => ({
  title: 'Spin and win',
  state: { status: 'ready' as const, slices: slices(6), spinsLeft: 1 },
  phase: 'idle' as const,
  rotation: 0,
  result: null,
  reduced: false,
  onSpin() {},
  onAgain() {},
  ...over,
});
const render = (over: Record<string, unknown> = {}) => renderToStaticMarkup(createElement(WheelView, props(over)));

describe('angleFor', () => {
  it('turns the disc so the pointer at the top lands in the middle of the slice', () => {
    expect(angleFor(0, 4)).toBe(315);
    expect(angleFor(1, 4)).toBe(225);
    expect(angleFor(3, 4)).toBe(45);
    expect(angleFor(0, 12)).toBe(345);
    expect(angleFor(11, 12)).toBe(15);
  });

  it('is always within one turn', () => {
    for (const count of [4, 5, 8, 12]) {
      for (let i = 0; i < count; i++) {
        expect(angleFor(i, count)).toBeGreaterThan(0);
        expect(angleFor(i, count)).toBeLessThan(360);
      }
    }
    expect(TURNS).toBeGreaterThanOrEqual(3);
  });
});

describe('WheelView', () => {
  it('renders one slice per dish, each with its photo', () => {
    setApp('en');
    for (const count of [4, 8, 12]) {
      const html = render({ state: { status: 'ready', slices: slices(count), spinsLeft: 1 } });
      expect(html.match(/<image /g)).toHaveLength(count);
      expect(html).toContain('/m/1.webp');
      expect(html).toContain('Spin');
    }
  });

  it('shows the title and a spin button, and keeps long names off the disc', () => {
    setApp('en');
    const long = 'A very long dish name that would never fit on a wedge of the wheel '.repeat(3);
    const html = render({ state: { status: 'ready', slices: [slice(1, long), ...slices(5).slice(1)], spinsLeft: 1 } });
    expect(html).toContain('Spin and win');
    expect(html).toContain('<button');
    expect(html).not.toMatch(/<text/);
  });

  it('with reduced motion has a Reveal button and no spin animation', () => {
    setApp('en');
    const html = render({ reduced: true });
    expect(html).toContain(getTranslator('en')('wheel.reveal'));
    expect(html).not.toContain(`>${getTranslator('en')('wheel.spin')}<`);
    expect(html).not.toMatch(/transition:/);
  });

  it('says the spins are used up, with no button, when none are left', () => {
    setApp('en');
    const html = render({ state: { status: 'ready', slices: slices(6), spinsLeft: 0 } });
    expect(html).toContain(getTranslator('en')('wheel.usedToday'));
    expect(html).not.toContain('<button');
  });

  it('shows the winning dish enlarged with its price, the prize line and a link to its sheet', () => {
    setApp('en');
    const html = render({ phase: 'result', result: { slice: slice(1), label: '10% off' }, state: { status: 'ready', slices: slices(6), spinsLeft: 0 } });
    expect(html).toContain('Dish 1');
    expect(html).toContain('1000 IQD');
    expect(html).toContain('10% off');
    expect(html).toContain('href="/demo/en/p/dish-1"');
    expect(html).toContain(getTranslator('en')('wheel.order'));
  });

  it('offers another spin after a result when there is one left', () => {
    setApp('en');
    const html = render({ phase: 'result', result: { slice: slice(2), label: '' }, state: { status: 'ready', slices: slices(6), spinsLeft: 1 } });
    expect(html).toContain(getTranslator('en')('wheel.again'));
  });

  it('renders nothing when the wheel is not available, and a quiet placeholder while loading', () => {
    setApp('en');
    expect(render({ state: { status: 'unavailable' } })).toBe('');
    expect(render({ state: { status: 'loading' } })).not.toContain('<button');
  });

  it('keeps the disc the same way round in Arabic, with Arabic words around it', () => {
    setApp('ar');
    const html = render();
    expect(html).toContain(getTranslator('ar')('wheel.spin'));
    expect(html).toContain('dir="ltr"');
  });
});

describe('AboutPage', () => {
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
    wheel: null,
    ...over,
  });

  it('mounts the wheel section only when the view says the wheel is available', () => {
    setApp('en');
    expect(renderToStaticMarkup(createElement(AboutPage, { view: view() }))).not.toContain('data-testid="wheel"');
    expect(renderToStaticMarkup(createElement(AboutPage, { view: view({ wheel: { title: 'Spin and win' } }) }))).toContain('data-testid="wheel"');
  });
});
