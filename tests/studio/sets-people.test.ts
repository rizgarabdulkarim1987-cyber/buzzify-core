// @vitest-environment jsdom
import { act, createElement, type ComponentProps, type ReactElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { StudioI18nProvider } from '@/studio/i18n';
import { getStudioTranslator, STUDIO_MESSAGES } from '@/studio/messages';

/** The Sets editor mounted in a browser-like document: the "for how many people" field and what it sends. */

const router = vi.hoisted(() => ({ refresh: vi.fn(), push: vi.fn(), replace: vi.fn() }));
vi.mock('next/navigation', () => ({ useRouter: () => router }));
const actions = vi.hoisted(() => ({ saveSet: vi.fn(), deleteSet: vi.fn() }));
vi.mock('@/app/studio/_actions/sales', () => actions);

const { SetsEditor } = await import('@/studio/workspace/sales/SetsEditor');

const en = getStudioTranslator('en');
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const product = (id: string, name: string, price: number) => ({ id, names: { en: name }, price, variants: [], categoryId: null, isAvailable: true });
const set = (id: string, name: string, people: number | null) => ({
  id,
  version: 1,
  slug: id,
  names: { en: name },
  descriptions: {},
  price: 8000,
  items: [
    { productId: 'p1', variantId: null, quantity: 1 },
    { productId: 'p2', variantId: null, quantity: 1 },
  ],
  dayparts: [],
  isActive: true,
  itemsTotal: 10000,
  people,
});

const rules = {
  currency: 'IQD',
  locales: ['en'],
  defaultLocale: 'en',
  categories: [],
  products: [product('p1', 'Eggs', 5000), product('p2', 'Tea', 5000)],
  sets: [set('s1', 'Family breakfast', 4), set('s2', 'Solo', null)],
  upgrade: { allowed: ['selling.smart'] },
};

let container: HTMLElement;
let root: Root;

function mount(element: ReactElement) {
  const props = { locale: 'en', messages: STUDIO_MESSAGES.en } as ComponentProps<typeof StudioI18nProvider>;
  act(() => root.render(createElement(StudioI18nProvider, props, element)));
}
function type(input: HTMLInputElement, value: string) {
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!;
  act(() => {
    setter.call(input, value);
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });
}
async function click(element: Element) {
  await act(async () => {
    (element as HTMLElement).click();
  });
}
const button = (text: string) => [...document.querySelectorAll('button')].find((b) => b.textContent?.trim() === text || b.getAttribute('aria-label') === text)!;
const editor = () => mount(createElement(SetsEditor, { menuId: 'm1', rules: rules as never, canPrice: true }));
const peopleInput = () => {
  const label = [...document.querySelectorAll('label')].find((l) => l.textContent?.includes(en('sales.sets.people')))!;
  return document.getElementById(label.getAttribute('for')!) as HTMLInputElement;
};

beforeEach(() => {
  vi.clearAllMocks();
  actions.saveSet.mockResolvedValue({ ok: true, data: {} });
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
});
afterEach(() => {
  act(() => root.unmount());
  container.remove();
  document.body.innerHTML = '';
});

describe('the sets editor people field', () => {
  it('shows "For N" on a package row only', () => {
    editor();
    const rows = container.textContent!;
    expect(rows).toContain(en('sales.sets.forPeople', { n: 4 }));
    // The ordinary set's row carries no "For ..." text.
    expect(rows.split(en('sales.sets.forPeople', { n: 4 }).replace('4', '')).length - 1).toBe(1);
  });

  it('opens with the saved number and sends a changed one', async () => {
    editor();
    await click(button(en('sales.sets.editOne', { name: 'Family breakfast' })));
    expect(peopleInput().value).toBe('4');
    type(peopleInput(), '6');
    await click(button(en('common.save')));
    expect(actions.saveSet).toHaveBeenCalledWith(expect.objectContaining({ bundleId: 's1', people: 6 }));
  });

  it('sends null when emptied, and for an ordinary set left alone', async () => {
    editor();
    await click(button(en('sales.sets.editOne', { name: 'Family breakfast' })));
    type(peopleInput(), '');
    await click(button(en('common.save')));
    expect(actions.saveSet).toHaveBeenLastCalledWith(expect.objectContaining({ bundleId: 's1', people: null }));

    await click(button(en('sales.sets.editOne', { name: 'Solo' })));
    expect(peopleInput().value).toBe('');
    await click(button(en('common.save')));
    expect(actions.saveSet).toHaveBeenLastCalledWith(expect.objectContaining({ bundleId: 's2', people: null }));
  });
});
