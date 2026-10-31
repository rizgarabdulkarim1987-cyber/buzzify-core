// @vitest-environment jsdom
import { act, createElement, type ComponentProps, type ReactElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { StudioI18nProvider } from '@/studio/i18n';
import { getStudioTranslator, STUDIO_MESSAGES } from '@/studio/messages';

/** The Showcase page mounted in a browser-like document: occasions, the two strips of cards, and what each sends. */

const router = vi.hoisted(() => ({ refresh: vi.fn(), push: vi.fn(), replace: vi.fn() }));
vi.mock('next/navigation', () => ({ useRouter: () => router }));
const actions = vi.hoisted(() => ({
  saveOccasion: vi.fn(),
  deleteOccasion: vi.fn(),
  saveShowcaseCard: vi.fn(),
  deleteShowcaseCard: vi.fn(),
  reorderShowcaseCards: vi.fn(),
}));
vi.mock('@/app/studio/_actions/sales', () => actions);
const toast = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn() }));
vi.mock('sonner', () => ({ toast }));

const { ShowcaseEditor } = await import('@/studio/workspace/sales/ShowcaseEditor');

const en = getStudioTranslator('en');
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

type Card = Record<string, unknown>;
const card = (id: string, slot: 'ABOVE_SEARCH' | 'BELOW_SEARCH', sortOrder: number, patch: Card = {}): Card => ({
  id,
  version: 1,
  slot,
  kind: 'BUFFET',
  sortOrder,
  occasionId: null,
  promotionId: null,
  bundleId: null,
  price: 15000,
  startMinute: null,
  endMinute: null,
  daysOfWeek: 127,
  title: { en: id },
  text: {},
  isActive: true,
  hiddenReason: null,
  ...patch,
});
const offer = (id: string, title: string, startsOn: string | null) => ({
  id,
  version: 1,
  kind: 'SPECIAL',
  percentOff: null,
  productIds: [],
  categoryIds: [],
  startsOn,
  endsOn: null,
  startMinute: null,
  endMinute: null,
  daysOfWeek: 127,
  title: { en: title },
  text: {},
  isActive: true,
  sortOrder: 0,
  ended: false,
});

const baseRules = {
  currency: 'IQD',
  locales: ['en'],
  defaultLocale: 'en',
  timeZone: 'Asia/Baghdad',
  numeralSystem: 'latn',
  categories: [],
  products: [],
  upgrades: [],
  pairings: [],
  sets: [],
  offers: [offer('o1', 'Happy hour', null), offer('o2', 'Winter soup', '2999-01-01')],
  occasions: [{ id: 'e1', version: 1, names: { en: 'Eid' }, startsOn: '2020-01-01', endsOn: '2020-01-03', isActive: true, mood: null }],
  upgrade: { restaurantId: 'r1', restaurantName: 'Cafe', whatsapp: null, isOwner: true, planNames: { BASIC: 'Basic', PRO: 'Pro', PREMIUM: 'Premium' }, allowed: ['guest.occasionMoods'], lowest: {}, planTabHref: '/studio/settings/plan' },
  showcase: [
    card('Second', 'ABOVE_SEARCH', 1),
    card('Below one', 'BELOW_SEARCH', 0),
    card('First', 'ABOVE_SEARCH', 0),
    card('Eid lunch', 'ABOVE_SEARCH', 2, { occasionId: 'e1', hiddenReason: 'OCCASION_ENDED' }),
    card('soup card', 'BELOW_SEARCH', 1, { kind: 'OFFER', promotionId: 'o2', price: null, title: {} }),
  ],
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
const inputLabelled = (text: string) => {
  const byAria = document.querySelector<HTMLInputElement>(`input[aria-label="${text}"]`);
  if (byAria) return byAria;
  const label = [...document.querySelectorAll('label')].find((l) => l.textContent?.includes(text))!;
  return document.getElementById(label.getAttribute('for')!) as HTMLInputElement;
};
const slotList = (slot: 'ABOVE_SEARCH' | 'BELOW_SEARCH') => document.querySelector(`ul[aria-label="${en(`sales.showcase.slot.${slot}`)}"]`)!;
const rowOf = (name: string) => [...document.querySelectorAll('li')].find((li) => li.textContent?.includes(name))!;
const editor = (rules: object = baseRules, canEdit = true) => mount(createElement(ShowcaseEditor, { menuId: 'm1', rules: rules as never, canEdit }));

beforeEach(() => {
  vi.clearAllMocks();
  for (const action of Object.values(actions)) action.mockResolvedValue({ ok: true, data: {} });
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
});
afterEach(() => {
  act(() => root.unmount());
  container.remove();
  document.body.innerHTML = '';
});

describe('the showcase editor', () => {
  it('lists each strip’s cards in their order', () => {
    editor();
    const above = [...slotList('ABOVE_SEARCH').querySelectorAll('li')].map((li) => li.textContent);
    expect(above).toHaveLength(3);
    expect(above[0]).toContain('First');
    expect(above[1]).toContain('Second');
    expect(above[2]).toContain('Eid lunch');
    const below = slotList('BELOW_SEARCH').textContent!;
    expect(below).toContain('Below one');
    // An offer card without a title of its own reads as its offer.
    expect(below).toContain('Winter soup');
  });

  it('marks a card whose occasion has ended', () => {
    editor();
    expect(rowOf('Eid lunch').textContent).toContain(en('sales.showcase.hidden.OCCASION_ENDED'));
    expect(rowOf('First').textContent).not.toContain(en('sales.showcase.hidden.OCCASION_ENDED'));
  });

  it('marks a card the plan keeps from guests', () => {
    editor({ ...baseRules, showcase: [card('Gated set', 'ABOVE_SEARCH', 0, { kind: 'SET', bundleId: 's1', price: null, hiddenReason: 'PLAN' })] });
    expect(rowOf('Gated set').textContent).toContain(en('sales.showcase.hidden.PLAN'));
  });

  it('marks an offer card whose offer has not started yet', () => {
    editor();
    expect(rowOf('Winter soup').textContent).toContain(en('sales.showcase.hidden.OFFER_NOT_STARTED'));
  });

  it('adds a buffet card with the typed title and price', async () => {
    editor();
    await click(button(en('sales.showcase.addCardTo', { slot: en('sales.showcase.slot.BELOW_SEARCH') })));
    await click(button(en('sales.showcase.kind.BUFFET')));
    type(inputLabelled(en('content.inLanguage', { field: en('sales.showcase.titleField'), language: en('menus.language.en') })), 'Friday buffet');
    type(inputLabelled(en('sales.showcase.price')), '25000');
    await click(button(en('common.save')));
    expect(actions.saveShowcaseCard).toHaveBeenCalledWith(
      expect.objectContaining({
        menuId: 'm1',
        kind: 'BUFFET',
        slot: 'BELOW_SEARCH',
        price: 25000,
        title: { en: 'Friday buffet' },
        promotionId: null,
        bundleId: null,
        occasionId: null,
        daysOfWeek: 127,
      }),
    );
  });

  it('moves a card down by swapping it with the next one in its strip', async () => {
    editor();
    await click(button(en('sales.showcase.moveDown', { name: 'First' })));
    expect(actions.reorderShowcaseCards).toHaveBeenCalledWith(expect.objectContaining({ menuId: 'm1', slot: 'ABOVE_SEARCH', order: ['Second', 'First', 'Eid lunch'] }));
  });

  it('shows the server’s message for an occasion that ends before it starts', async () => {
    actions.saveOccasion.mockResolvedValue({ ok: false, error: { code: 'INVALID', message: 'Check the highlighted fields', fields: { endsOn: 'End on or after the start date' } } });
    editor();
    await click(button(en('sales.showcase.addOccasion')));
    type(inputLabelled(en('content.inLanguage', { field: en('sales.showcase.occasion.name'), language: en('menus.language.en') })), 'Ramadan');
    type(inputLabelled(en('sales.showcase.occasion.startsOn')), '2026-03-10');
    type(inputLabelled(en('sales.showcase.occasion.endsOn')), '2026-03-01');
    await click(button(en('common.save')));
    expect(actions.saveOccasion).toHaveBeenCalledWith(expect.objectContaining({ names: { en: 'Ramadan' }, startsOn: '2026-03-10', endsOn: '2026-03-01' }));
    expect(document.body.textContent).toContain(en('error.text.offerEndsBefore'));
  });

  it('offers the moods in the occasion dialog, locked on a plan without them', async () => {
    const moodSelect = () => [...document.querySelectorAll('select')].find((select) => [...select.options].some((o) => o.value === 'RAMADAN'))!;
    editor({ ...baseRules, upgrade: { ...baseRules.upgrade, allowed: [] } });
    await click(button(en('sales.showcase.addOccasion')));
    expect([...moodSelect().options].map((o) => [o.value, o.disabled])).toEqual([['', false], ['RAMADAN', true], ['NEWROZ', true], ['EID', true]]);
  });

  it('says in each strip’s hint that guests see its first 8 cards, however many there are', () => {
    editor({ ...baseRules, showcase: [] });
    for (const slot of ['ABOVE_SEARCH', 'BELOW_SEARCH'] as const) {
      expect(container.textContent).toContain(en(`sales.showcase.slotHint.${slot}`));
      expect(en(`sales.showcase.slotHint.${slot}`)).toContain('8');
    }
  });

  it('shows a refused switch as an error toast, since no dialog is open to show its fields', async () => {
    actions.saveShowcaseCard.mockResolvedValue({ ok: false, error: { code: 'INVALID', message: 'Check the highlighted fields', fields: { promotionId: 'Pick an offer' } } });
    editor();
    await click(button(en('sales.showcase.showOne', { name: 'First' })));
    expect(actions.saveShowcaseCard).toHaveBeenCalledWith(expect.objectContaining({ cardId: 'First', isActive: false }));
    expect(toast.error).toHaveBeenCalledTimes(1);
    expect(toast.error.mock.calls[0]![0]).toBeTruthy();
    expect(toast.success).not.toHaveBeenCalled();
  });

  it('is read only for someone without the right to edit content', () => {
    editor(baseRules, false);
    expect(button(en('sales.showcase.addOccasion'))).toBeUndefined();
    expect(button(en('sales.showcase.addCardTo', { slot: en('sales.showcase.slot.ABOVE_SEARCH') }))).toBeUndefined();
    expect(button(en('sales.showcase.editOne', { name: 'First' }))).toBeUndefined();
    expect(button(en('sales.showcase.deleteOne', { name: 'First' }))).toBeUndefined();
    expect(button(en('sales.showcase.moveDown', { name: 'First' }))).toBeUndefined();
    expect(button(en('sales.showcase.showOne', { name: 'First' }))?.hasAttribute('disabled') ?? true).toBe(true);
    expect(rowOf('First').textContent).toContain('First');
  });

  it('asks before deleting a card', async () => {
    editor();
    await click(button(en('sales.showcase.deleteOne', { name: 'First' })));
    expect(actions.deleteShowcaseCard).not.toHaveBeenCalled();
    expect(document.body.textContent).toContain(en('sales.showcase.deleteTitle'));
    await click(button(en('sales.delete')));
    expect(actions.deleteShowcaseCard).toHaveBeenCalledWith({ menuId: 'm1', cardId: 'First', version: 1 });
  });
});
