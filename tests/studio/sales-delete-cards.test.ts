// @vitest-environment jsdom
import { act, createElement, type ComponentProps, type ReactElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { StudioI18nProvider } from '@/studio/i18n';
import { getStudioTranslator, STUDIO_MESSAGES } from '@/studio/messages';

/** Deleting an offer or a set also removes the showcase cards that use it: the confirmation says so. */

const router = vi.hoisted(() => ({ refresh: vi.fn(), push: vi.fn(), replace: vi.fn() }));
vi.mock('next/navigation', () => ({ useRouter: () => router }));
const actions = vi.hoisted(() => ({ saveSet: vi.fn(), deleteSet: vi.fn(), saveOffer: vi.fn(), deleteOffer: vi.fn(), reorderOffers: vi.fn() }));
vi.mock('@/app/studio/_actions/sales', () => actions);

const { SetsEditor } = await import('@/studio/workspace/sales/SetsEditor');
const { OffersEditor } = await import('@/studio/workspace/sales/OffersEditor');

const en = getStudioTranslator('en');
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const rules = {
  currency: 'IQD',
  locales: ['en'],
  defaultLocale: 'en',
  timeZone: 'Asia/Baghdad',
  numeralSystem: 'latn',
  categories: [],
  products: [{ id: 'p1', names: { en: 'Eggs' }, price: 5000, variants: [], categoryId: 'c1' }],
  upgrades: [],
  pairings: [],
  occasions: [],
  showcase: [],
  sets: [
    {
      id: 's1',
      version: 1,
      slug: 's1',
      names: { en: 'Family breakfast' },
      descriptions: {},
      price: 8000,
      items: [{ productId: 'p1', variantId: null, quantity: 2 }],
      dayparts: [],
      isActive: true,
      itemsTotal: 10000,
      people: null,
    },
  ],
  offers: [
    {
      id: 'o1',
      version: 1,
      kind: 'SPECIAL',
      percentOff: null,
      productIds: ['p1'],
      categoryIds: [],
      startsOn: null,
      endsOn: null,
      startMinute: null,
      endMinute: null,
      daysOfWeek: 127,
      title: { en: 'Happy hour' },
      text: {},
      isActive: true,
      sortOrder: 0,
      ended: false,
    },
  ],
  upgrade: { allowed: ['selling.smart', 'selling.offers'], lowest: {} },
};

let container: HTMLElement;
let root: Root;

function mount(element: ReactElement) {
  const props = { locale: 'en', messages: STUDIO_MESSAGES.en } as ComponentProps<typeof StudioI18nProvider>;
  act(() => root.render(createElement(StudioI18nProvider, props, element)));
}
async function click(element: Element) {
  await act(async () => {
    (element as HTMLElement).click();
  });
}
const button = (text: string) => [...document.querySelectorAll('button')].find((b) => b.textContent?.trim() === text || b.getAttribute('aria-label') === text)!;

beforeEach(() => {
  vi.clearAllMocks();
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
});
afterEach(() => {
  act(() => root.unmount());
  container.remove();
  document.body.innerHTML = '';
});

describe('deleting what showcase cards use', () => {
  it('warns that the cards of a set go with it', async () => {
    mount(createElement(SetsEditor, { menuId: 'm1', rules: rules as never, canPrice: true }));
    await click(button(en('sales.sets.deleteOne', { name: 'Family breakfast' })));
    expect(document.body.textContent).toContain(en('sales.deleteRemovesCards'));
  });

  it('warns that the cards of an offer go with it', async () => {
    mount(createElement(OffersEditor, { menuId: 'm1', rules: rules as never, canPrice: true }));
    await click(button(en('sales.offers.deleteOne', { name: 'Happy hour' })));
    expect(document.body.textContent).toContain(en('sales.deleteRemovesCards'));
  });

  it('says so in every Studio language', () => {
    for (const locale of ['en', 'ar', 'ckb'] as const) {
      const text = getStudioTranslator(locale)('sales.deleteRemovesCards');
      expect(text).not.toBe('sales.deleteRemovesCards');
      expect(text.length).toBeGreaterThan(10);
    }
  });
});
