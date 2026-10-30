// @vitest-environment jsdom
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Locale } from '@/lib/locale';
import { getTranslator } from '@/lib/messages';
import type { CartInput } from '@/server/domain/types';
import type { ShowcaseCardView } from '@/server/data/menu-view';

/** The guest showcase carousel mounted in a browser-like document (docs/superpowers/specs/2026-10-30-menu-occasions-showcase-design.md). */

const app = vi.hoisted(() => ({ current: null as unknown }));
vi.mock('@/ui/AppProviders', () => ({ useApp: () => app.current }));

const { ShowcaseCarousel } = await import('@/ui/template/ShowcaseCarousel');
const { TemplateContext } = await import('@/ui/template/context');

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const card = (overrides: Partial<ShowcaseCardView> & Pick<ShowcaseCardView, 'id' | 'kind'>): ShowcaseCardView => ({
  title: overrides.id,
  text: '',
  occasion: null,
  price: null,
  people: null,
  productId: null,
  categoryId: null,
  bundleId: null,
  perPerson: false,
  when: null,
  ...overrides,
});

const spies = {
  setBundleQuantity: vi.fn(),
  announce: vi.fn(),
  openProduct: vi.fn(),
  jumpTo: vi.fn(),
};

let container: HTMLElement;
let root: Root;

function setApp({ locale = 'en', cart = { lines: [], bundles: [] }, preview = false }: { locale?: Locale; cart?: CartInput; preview?: boolean } = {}) {
  app.current = {
    locale,
    t: getTranslator(locale),
    tenant: { numeralSystem: 'latn' },
    price: (amount: number) => `IQD ${amount}`,
    money: (amount: number) => `IQD ${amount}`,
    cart,
    preview,
    setBundleQuantity: spies.setBundleQuantity,
    announce: spies.announce,
  };
}

function mount(
  showcase: { aboveSearch: ShowcaseCardView[]; belowSearch: ShowcaseCardView[] },
  { slot = 'aboveSearch', canOrder = true }: { slot?: 'aboveSearch' | 'belowSearch'; canOrder?: boolean } = {},
) {
  const context = { view: { showcase }, openProduct: spies.openProduct, jumpTo: spies.jumpTo, canOrder } as never;
  act(() => root.render(createElement(TemplateContext.Provider, { value: context }, createElement(ShowcaseCarousel, { slot }))));
}

async function click(element: Element) {
  await act(async () => {
    (element as HTMLElement).click();
  });
}

const en = getTranslator('en');
const set = card({ id: 's', kind: 'SET', title: 'Family meal', price: 15000, people: 4, bundleId: 'b-family' });
const buffet = card({
  id: 'u',
  kind: 'BUFFET',
  title: 'Open buffet',
  text: 'All you can eat',
  price: 25000,
  perPerson: true,
  when: { startMinute: 12 * 60, endMinute: 23 * 60, daysOfWeek: 127 },
});

beforeEach(() => {
  vi.clearAllMocks();
  setApp();
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
});
afterEach(() => {
  act(() => root.unmount());
  container.remove();
  document.body.innerHTML = '';
});

describe('ShowcaseCarousel', () => {
  it('renders nothing for an empty slot, leaving no gap', () => {
    mount({ aboveSearch: [], belowSearch: [set] });
    expect(container.innerHTML).toBe('');
  });

  it('renders its slot only, as a labelled region holding a list of the cards in order', () => {
    mount({ aboveSearch: [set, buffet], belowSearch: [card({ id: 'below', kind: 'BUFFET' })] });
    const region = container.querySelector('section')!;
    expect(region.getAttribute('aria-label')).toBe(en('showcase.label'));
    const items = [...region.querySelectorAll('ul > li')];
    expect(items.map((li) => li.querySelector('h3')?.textContent)).toEqual(['Family meal', 'Open buffet']);
  });

  it('renders every card it is given, even past the view cap of 8', () => {
    const many = Array.from({ length: 12 }, (_, index) => card({ id: `c${index}`, kind: 'BUFFET' }));
    mount({ aboveSearch: many, belowSearch: [] });
    expect(container.querySelectorAll('ul > li')).toHaveLength(12);
  });

  it('sets the strip direction from the guest language, so it starts at the right edge in Arabic', () => {
    mount({ aboveSearch: [set], belowSearch: [] });
    expect(container.querySelector('section')!.getAttribute('dir')).toBe('ltr');
    setApp({ locale: 'ar' });
    mount({ aboveSearch: [set], belowSearch: [] });
    expect(container.querySelector('section')!.getAttribute('dir')).toBe('rtl');
  });

  it('shows the occasion as a small label when the card has one', () => {
    mount({ aboveSearch: [card({ id: 'o', kind: 'BUFFET', occasion: 'Eid' }), buffet], belowSearch: [] });
    const [first, second] = [...container.querySelectorAll('li')];
    expect(first!.textContent).toContain('Eid');
    expect(second!.querySelector('[data-occasion]')).toBeNull();
  });

  describe('a set card', () => {
    it('shows its name, price and how many people it is for, with an add button', () => {
      mount({ aboveSearch: [set], belowSearch: [] });
      const li = container.querySelector('li')!;
      expect(li.textContent).toContain('Family meal');
      expect(li.textContent).toContain('IQD 15000');
      expect(li.textContent).toContain(en('showcase.forPeople', { count: 4, n: '4' }));
      expect(li.querySelector('button')!.getAttribute('aria-label')).toBe(en('product.quickAdd', { name: 'Family meal' }));
    });

    it('leaves "for N people" out when the set does not say', () => {
      mount({ aboveSearch: [{ ...set, people: null }], belowSearch: [] });
      expect(container.textContent).not.toContain(en('showcase.forPeople', { count: 4, n: '4' }).replace('4', ''));
    });

    it('adds one set and says so', async () => {
      mount({ aboveSearch: [set], belowSearch: [] });
      await click(container.querySelector('li button')!);
      expect(spies.setBundleQuantity).toHaveBeenCalledWith('b-family', 1);
      expect(spies.announce).toHaveBeenCalledWith(en('cart.added', { name: 'Family meal' }));
    });

    it('counts two quick taps as two, even before the cart has re-rendered', async () => {
      // The mocked cart never changes, as if both taps landed before React drew the new cart.
      mount({ aboveSearch: [set], belowSearch: [] });
      const add = container.querySelector('li button')!;
      await click(add);
      await click(add);
      expect(spies.setBundleQuantity.mock.calls).toEqual([
        ['b-family', 1],
        ['b-family', 2],
      ]);
    });

    it('adds on top of what the cart already holds once it has re-rendered', async () => {
      mount({ aboveSearch: [set], belowSearch: [] });
      await click(container.querySelector('li button')!);
      setApp({ cart: { lines: [], bundles: [{ bundleId: 'b-family', quantity: 5 }] } });
      mount({ aboveSearch: [set], belowSearch: [] });
      await click(container.querySelector('li button')!);
      expect(spies.setBundleQuantity).toHaveBeenLastCalledWith('b-family', 6);
    });

    it('keeps the card but drops the button where guests cannot order', () => {
      mount({ aboveSearch: [set], belowSearch: [] }, { canOrder: false });
      expect(container.textContent).toContain('Family meal');
      expect(container.querySelector('button')).toBeNull();
      setApp({ preview: true });
      mount({ aboveSearch: [set], belowSearch: [] });
      expect(container.textContent).toContain('Family meal');
      expect(container.querySelector('button')).toBeNull();
    });
  });

  describe('a buffet card', () => {
    it('shows its price per person and its days and hours, with no button', () => {
      mount({ aboveSearch: [buffet], belowSearch: [] });
      const li = container.querySelector('li')!;
      expect(li.textContent).toContain('IQD 25000');
      expect(li.textContent).toContain(en('showcase.perPerson'));
      expect(li.textContent).toContain(en('showcase.everyDay'));
      expect(li.textContent).toContain('12:00–23:00');
      expect(li.querySelector('button')).toBeNull();
    });
  });

  describe('an offer card', () => {
    it('opens its dish when tapped', async () => {
      mount({ aboveSearch: [card({ id: 'o', kind: 'OFFER', title: 'Happy hour', productId: 'p-burger' })], belowSearch: [] });
      await click(container.querySelector('li button')!);
      expect(spies.openProduct).toHaveBeenCalledWith('p-burger');
      expect(spies.jumpTo).not.toHaveBeenCalled();
    });

    it('goes to its category when it is on a category', async () => {
      mount({ aboveSearch: [card({ id: 'o', kind: 'OFFER', title: 'Cakes', categoryId: 'cat-pastry' })], belowSearch: [] });
      await click(container.querySelector('li button')!);
      expect(spies.jumpTo).toHaveBeenCalledWith('cat-pastry');
      expect(spies.openProduct).not.toHaveBeenCalled();
    });

    it('is plain content when it has neither', () => {
      mount({ aboveSearch: [card({ id: 'o', kind: 'OFFER', title: 'Ramadan nights' })], belowSearch: [] });
      expect(container.textContent).toContain('Ramadan nights');
      expect(container.querySelector('button')).toBeNull();
    });
  });

  describe('worst-case text and the iPhone budget', () => {
    const css = readFileSync(join(process.cwd(), 'src/ui/template/showcase.css'), 'utf8');
    const rule = (selector: string) => css.match(new RegExp(`${selector.replace(/[.*+?^${}()|[\]\\-]/g, '\\$&')}\\s*\\{([^}]*)\\}`))?.[1] ?? '';

    it('wraps a 1,000-character title with no spaces inside its card, so only the strip scrolls', () => {
      const long = 'W'.repeat(1000);
      mount({ aboveSearch: [card({ id: 'x', kind: 'BUFFET', title: long, text: long })], belowSearch: [] });
      const li = container.querySelector('li')!;
      expect(li.className).toContain('tpl-showcase-card');
      expect(li.querySelector('h3')!.textContent).toBe(long);
      expect(rule('.tpl-showcase-card')).toMatch(/overflow-wrap:\s*anywhere/);
      expect(rule('.tpl-showcase-card')).toMatch(/min-width:\s*0/);
      // A fixed card width: the card never grows with its text.
      expect(rule('.tpl-showcase-card')).toMatch(/flex:\s*0 0 min\(80%, 20rem\)/);
      expect(container.querySelector('ul')!.className).toContain('tpl-showcase-strip');
      expect(rule('.tpl-showcase-strip')).toMatch(/overflow-x:\s*auto/);
      expect(rule('.tpl-showcase-strip')).toMatch(/scroll-snap-type:\s*x mandatory/);
      expect(rule('.tpl-showcase-card')).toMatch(/scroll-snap-align:\s*start/);
    });

    it('adds no motion and no composited layers: no animation, transition, transform or will-change', () => {
      // A property at the start of a declaration (so `text-transform` is not a transform).
      expect(css.replace(/\/\*[\s\S]*?\*\//g, '')).not.toMatch(/(^|[\s;{])(animation[\w-]*|transition[\w-]*|transform|will-change|translate|scale|rotate|filter|backdrop-filter)\s*:/m);
    });
  });
});
