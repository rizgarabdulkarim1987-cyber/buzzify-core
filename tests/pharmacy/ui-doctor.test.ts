// @vitest-environment jsdom
import { act, createElement, type ComponentProps, type ReactElement, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Locale } from '@/lib/locale';
import { DOCTOR_DISCLAIMER_KEY, DOCTOR_MESSAGE_KEYS, REFER_GENERIC } from '@/server/domain/pharmacy/doctor';
import type { DoctorResponse } from '@/server/pharmacy/doctor/service';
import type { MatchedItem, MatchedOption } from '@/server/pharmacy/doctor/matcher';
import { StudioI18nProvider } from '@/studio/i18n';
import { getStudioTranslator, STUDIO_MESSAGES } from '@/studio/messages';

/**
 * The AI Doctor's screens (plan Task 8): the order of what an answer shows (red flags first, the app's own "consult a doctor"
 * line always last), what a not-in-stock option may show (a name, never a price or a button), what goes to the cart, and who
 * sees the Doctor at all. The Server Action is stood in for; tests/e2e/pharmacy-doctor.spec.ts runs it for real.
 */

const router = vi.hoisted(() => ({ refresh: vi.fn(), push: vi.fn(), replace: vi.fn() }));
const nav = vi.hoisted(() => ({ notFound: vi.fn(() => { throw new Error('NEXT_NOT_FOUND'); }) }));
vi.mock('next/navigation', () => ({ useRouter: () => router, notFound: nav.notFound, usePathname: () => '/pharmacy/sell' }));
vi.mock('next/link', () => ({
  default: ({ href, children, ...rest }: { href: string; children: ReactNode }) => createElement('a', { href, ...rest }, children),
}));
vi.mock('@/studio/request-locale', () => ({ requestStudioLocale: async () => 'en' }));
const actions = vi.hoisted(() => ({ askDoctor: vi.fn() }));
vi.mock('@/app/pharmacy/_actions/doctor', () => actions);
const access = vi.hoisted(() => ({ getPhAccess: vi.fn(), doctorNavEnabled: vi.fn() }));
vi.mock('@/server/pharmacy/actor', () => ({ getPhAccess: access.getPhAccess }));
vi.mock('@/server/pharmacy/doctor/nav', () => ({ doctorNavEnabled: access.doctorNavEnabled, doctorEnabledThisRequest: access.doctorNavEnabled }));
const queries = vi.hoisted(() => ({ query: vi.fn() }));
vi.mock('@/server/studio/framework/invoke', () => ({ query: queries.query }));

const logic = await import('@/app/pharmacy/_ui/doctor-logic');
const { DoctorAnswer } = await import('@/app/pharmacy/_ui/DoctorAnswer');
const { DoctorPanel, DoctorSheet } = await import('@/app/pharmacy/_ui/DoctorPanel');
const { DoctorSlot } = await import('@/app/pharmacy/_ui/DoctorSlot');
const bridge = await import('@/app/pharmacy/_ui/cart-bridge');
const { parseSellAdd } = await import('@/app/pharmacy/_ui/sell-logic');
const { phNav } = await import('@/app/pharmacy/_ui/nav');
const { doctorEnabledFor } = await import('@/server/pharmacy/doctor/access');

const en = getStudioTranslator('en');
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let container: HTMLElement;
let root: Root;

function mount(element: ReactElement, locale: Locale = 'en') {
  document.documentElement.dir = locale === 'en' ? 'ltr' : 'rtl';
  const props = { locale, messages: STUDIO_MESSAGES[locale] } as ComponentProps<typeof StudioI18nProvider>;
  act(() => root.render(createElement(StudioI18nProvider, props, element)));
}
const settle = () =>
  act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 10));
  });
async function click(element: Element) {
  await act(async () => {
    (element as HTMLElement).click();
  });
}
function type(element: Element, value: string) {
  const input = element as HTMLInputElement | HTMLTextAreaElement;
  const proto = input instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
  act(() => {
    Object.getOwnPropertyDescriptor(proto, 'value')!.set!.call(input, value);
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });
}
const byTest = (id: string) => container.querySelector(`[data-testid="${id}"]`);
const allTest = (id: string) => [...container.querySelectorAll(`[data-testid="${id}"]`)];

beforeEach(() => {
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  actions.askDoctor.mockReset();
  // jsdom has no <dialog> modal API.
  HTMLDialogElement.prototype.showModal ??= function (this: HTMLDialogElement) {
    this.setAttribute('open', '');
  };
  HTMLDialogElement.prototype.close ??= function (this: HTMLDialogElement) {
    this.removeAttribute('open');
    this.dispatchEvent(new Event('close'));
  };
});
afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

// Fixtures ----------------------------------------------------------------------------------------------------------------

const item = (over: Partial<MatchedItem> = {}): MatchedItem => ({
  productId: 'p-para',
  unitId: 'u-strip',
  unitLabel: 'strip',
  baseQty: 10,
  tradeName: 'Panadol',
  strength: '500 mg',
  form: 'tablet',
  priceMinor: '2500',
  currency: 'IQD',
  sellableQty: 14,
  ...over,
});
const inStock: MatchedOption = { ingredient: 'paracetamol', note: 'Take with water', items: [item()], status: 'IN_STOCK' };
const notInStock: MatchedOption = { ingredient: 'ibuprofen', note: 'After food', items: [], status: 'NOT_IN_STOCK' };

const complaint = (over: Partial<Extract<DoctorResponse, { mode: 'COMPLAINT' }>> = {}): DoctorResponse => ({
  kind: 'ANSWER',
  mode: 'COMPLAINT',
  answer: {
    redFlags: [],
    likelyCauses: ['A common cold'],
    askNext: ['Any allergies?'],
    tellCustomer: ['Drink fluids'],
    referIf: ['Fever lasts more than 3 days', REFER_GENERIC],
    cautions: ['Not with alcohol'],
    unsure: false,
  },
  options: [inStock, notInStock],
  mustRefer: false,
  disclaimerKey: DOCTOR_DISCLAIMER_KEY,
  ...over,
});
/** A complaint answer with a red flag. The server never sends options with one; passing `options` forces them, to prove the UI drops them too. */
const flagged = (over: Partial<Extract<DoctorResponse, { mode: 'COMPLAINT' }>> = {}): DoctorResponse => {
  const base = complaint() as Extract<DoctorResponse, { mode: 'COMPLAINT' }>;
  return { ...base, answer: { ...base.answer, redFlags: ['Stiff neck with the fever'] }, options: [], ...over };
};
const medicine: DoctorResponse = {
  kind: 'ANSWER',
  mode: 'MEDICINE_NAME',
  answer: {
    productName: 'Panadol 500',
    activeIngredient: 'paracetamol',
    uses: ['Mild pain'],
    doseAsLabelled: 'As on the leaflet',
    contraindications: ['Liver disease'],
    interactions: ['Warfarin'],
    sideEffects: ['Rash, rarely'],
    warnings: ['Do not exceed the leaflet dose'],
    storage: 'Below 25 C',
    confident: true,
  },
  options: [],
  mustRefer: false,
  disclaimerKey: DOCTOR_DISCLAIMER_KEY,
};
const refer: DoctorResponse = { kind: 'REFER', reasons: ['CHEST_PAIN', 'BREATHING'], disclaimerKey: DOCTOR_DISCLAIMER_KEY };
const unsure: DoctorResponse = { kind: 'UNSURE', hint: 'CLEARER_PHOTO', disclaimerKey: DOCTOR_DISCLAIMER_KEY };
const unavailable: DoctorResponse = { kind: 'UNAVAILABLE', reason: 'LIMIT', disclaimerKey: DOCTOR_DISCLAIMER_KEY };
const ALL: Array<[string, DoctorResponse]> = [
  ['complaint answer', complaint()],
  ['complaint answer that must refer', complaint({ mustRefer: true })],
  ['complaint answer with a red flag', flagged({ mustRefer: true })],
  ['medicine answer', medicine],
  ['REFER', refer],
  ['UNSURE', unsure],
  ['UNAVAILABLE', unavailable],
];

// The answer's order (pure) -------------------------------------------------------------------------------------------

describe('answerSections', () => {
  it.each(ALL)('ends with the app’s disclaimer, and only there: %s', (_label, result) => {
    const sections = logic.answerSections(result);
    expect(sections.at(-1)).toEqual({ id: 'disclaimer', tone: 'fine', lines: [{ kind: 'msg', key: DOCTOR_DISCLAIMER_KEY }] });
    expect(sections.filter((s) => s.id === 'disclaimer')).toHaveLength(1);
  });

  it('puts red flags first, then the referral when the answer must refer', () => {
    expect(logic.answerSections(flagged({ mustRefer: true })).map((s) => s.id)).toEqual(['redFlags', 'referIf', 'likelyCauses', 'askNext', 'tellCustomer', 'cautions', 'disclaimer']);
    const ids = logic.answerSections(complaint({ mustRefer: true })).map((s) => s.id);
    expect(ids.indexOf('referIf')).toBeLessThan(ids.indexOf('options'));
    expect(logic.answerSections(complaint()).map((s) => s.id)).toEqual(['likelyCauses', 'askNext', 'options', 'tellCustomer', 'referIf', 'cautions', 'disclaimer']);
  });

  it('never offers a product beside a red flag, even if options arrive with one (a second guard after the server)', () => {
    const ids = logic.answerSections(flagged({ options: [inStock, notInStock] })).map((s) => s.id);
    expect(ids[0]).toBe('redFlags');
    expect(ids).not.toContain('options');
  });

  it('turns the generic referral code into the app’s own line, never shows the code', () => {
    const referIf = logic.answerSections(complaint()).find((s) => s.id === 'referIf')!;
    expect(referIf.lines).toEqual([{ kind: 'model', text: 'Fever lasts more than 3 days' }, { kind: 'msg', key: DOCTOR_MESSAGE_KEYS.referGeneric }]);
  });

  it('shows only fixed app lines for UNSURE, REFER and UNAVAILABLE (no model text exists to show)', () => {
    for (const result of [refer, unsure, unavailable]) {
      const lines = logic.answerSections(result).flatMap((s) => s.lines);
      expect(lines.every((l) => l.kind === 'msg')).toBe(true);
    }
    expect(logic.answerSections(unsure)[0]!.lines).toEqual([
      { kind: 'msg', key: DOCTOR_MESSAGE_KEYS.unsure.CLEARER_PHOTO },
      { kind: 'msg', key: DOCTOR_MESSAGE_KEYS.unsureRefer },
    ]);
    expect(logic.answerSections(refer)[0]).toMatchObject({ id: 'refer', tone: 'danger', lines: [{ kind: 'msg', key: DOCTOR_MESSAGE_KEYS.reason.CHEST_PAIN }, { kind: 'msg', key: DOCTOR_MESSAGE_KEYS.reason.BREATHING }] });
    expect(logic.answerSections(unavailable)[0]!.lines).toEqual([{ kind: 'msg', key: DOCTOR_MESSAGE_KEYS.unavailable.LIMIT }]);
  });

  it('leaves empty sections out and keeps the red flags red', () => {
    const sections = logic.answerSections(complaint({ answer: { redFlags: [], likelyCauses: [], askNext: [], tellCustomer: [], referIf: [REFER_GENERIC], cautions: [], unsure: false }, options: [] }));
    expect(sections.map((s) => s.id)).toEqual(['referIf', 'disclaimer']);
    expect(logic.answerSections(flagged())[0]!.tone).toBe('danger');
  });

  it('orders a medicine answer as the spec does, with the leaflet reminder under the dose', () => {
    const sections = logic.answerSections(medicine);
    expect(sections.map((s) => s.id)).toEqual(['product', 'uses', 'dose', 'contraindications', 'interactions', 'sideEffects', 'warnings', 'storage', 'disclaimer']);
    expect(sections.find((s) => s.id === 'dose')!.lines).toEqual([{ kind: 'model', text: 'As on the leaflet' }, { kind: 'msg', key: 'pharmacy.doctor.medicine.checkLeaflet' }]);
  });

  it('uses the server’s message keys', () => {
    expect(logic.REFER_GENERIC_CODE).toBe(REFER_GENERIC);
    expect(logic.DISCLAIMER_KEY).toBe(DOCTOR_DISCLAIMER_KEY);
  });
});

// The cart (pure) -----------------------------------------------------------------------------------------------------------

describe('what goes to the cart', () => {
  it('hands the Sell screen one of the matched unit (the quantity is in that unit, not in base units)', () => {
    expect(logic.cartItemOf(item({ unitId: 'u-box', baseQty: 30 }))).toEqual({ unitId: 'u-box', qty: 1 });
  });

  it('links Home to the Sell screen with the same unit, read back by the Sell screen', () => {
    const href = logic.sellAddHref(item({ unitId: 'cm3x:9 &y=1' }));
    expect(href.startsWith('/pharmacy/sell?add=')).toBe(true);
    expect(parseSellAdd(new URL(href, 'http://x').search)).toEqual([{ unitId: 'cm3x:9 &y=1', qty: 1 }]);
  });
});

// The question (pure) ----------------------------------------------------------------------------------------------------------

describe('askInputOf', () => {
  const base = { mode: 'COMPLAINT' as const, text: ' headache ', age: '', sex: '' as const, pregnant: false, duration: '', medicine: '', photo: null };
  it('sends a complaint with the facts given and folds the duration into the text', () => {
    expect(logic.askInputOf({ ...base, age: '34', sex: 'M', duration: '2 days' }, 'b1', 'How long')).toEqual({
      ok: true,
      input: { mode: 'COMPLAINT', text: 'headache\nHow long: 2 days', ageYears: 34, sex: 'M', branchId: 'b1' },
    });
  });
  it('sends pregnancy only for a woman, and only when ticked', () => {
    expect(logic.askInputOf({ ...base, sex: 'F', pregnant: true }, 'b1', 'D')).toMatchObject({ input: { pregnant: true, sex: 'F' } });
    expect(logic.askInputOf({ ...base, sex: 'M', pregnant: true }, 'b1', 'D')).not.toMatchObject({ input: { pregnant: true } });
  });
  it('refuses an age that is not a whole number from 0 to 130, and an empty question', () => {
    expect(logic.askInputOf({ ...base, age: '131' }, 'b1', 'D')).toEqual({ ok: false, problem: 'age' });
    expect(logic.askInputOf({ ...base, age: '2.5' }, 'b1', 'D')).toEqual({ ok: false, problem: 'age' });
    expect(logic.askInputOf({ ...base, text: '  ' }, 'b1', 'D')).toEqual({ ok: false, problem: 'empty' });
  });
  it('asks by photo when one is ready, else by name', () => {
    const m = { ...base, mode: 'MEDICINE' as const, medicine: ' Panadol ' };
    expect(logic.askInputOf(m, 'b1', 'D')).toEqual({ ok: true, input: { mode: 'MEDICINE_NAME', text: 'Panadol', branchId: 'b1' } });
    expect(logic.askInputOf({ ...m, photo: { mime: 'image/jpeg', base64: 'AAA' } }, 'b1', 'D')).toEqual({ ok: true, input: { mode: 'MEDICINE_PHOTO', mime: 'image/jpeg', imageBase64: 'AAA', branchId: 'b1' } });
  });
});

// The answer drawn ----------------------------------------------------------------------------------------------------------

describe('<DoctorAnswer>', () => {
  it.each(ALL)('draws the disclaimer as its last element: %s', (_label, result) => {
    mount(createElement(DoctorAnswer, { result, addMode: 'link' }));
    const answer = byTest('doctor-answer')!;
    const last = answer.lastElementChild!;
    expect(last.getAttribute('data-testid')).toBe('doctor-disclaimer');
    expect(last.textContent).toBe(en(DOCTOR_DISCLAIMER_KEY));
  });

  it('draws red flags first, in red, and no option or Add beside them even if the server sent some', () => {
    mount(createElement(DoctorAnswer, { result: flagged({ options: [inStock, notInStock] }), addMode: 'bridge' }));
    const answer = byTest('doctor-answer')!;
    const flags = byTest('doctor-section-redFlags')!;
    expect(answer.firstElementChild).toBe(flags);
    expect(flags.className).toMatch(/text-ph-red|bg-ph-red-wash/);
    expect(flags.textContent).toContain('Stiff neck with the fever');
    expect(byTest('doctor-section-options')).toBeNull();
    expect(byTest('doctor-add')).toBeNull();
  });

  it('shows a not-in-stock option by name with "not in your stock" only: no price, no quantity, no Add button', () => {
    mount(createElement(DoctorAnswer, { result: complaint(), addMode: 'bridge' }));
    const row = byTest('doctor-option-NOT_IN_STOCK')!;
    expect(row.textContent).toContain('ibuprofen');
    expect(row.textContent).toContain(en('pharmacy.doctor.option.notInStock'));
    expect(row.querySelector('button, a')).toBeNull();
    expect(row.querySelector('[data-testid="doctor-item-price"]')).toBeNull();
    expect(row.textContent).not.toMatch(/IQD|USD|\d/);
  });

  it('shows the model’s note as plain text apart from the price, and the price and quantity from the catalog fields', () => {
    mount(createElement(DoctorAnswer, { result: complaint({ options: [{ ...inStock, note: '<b>9,999 IQD</b>' }] }), addMode: 'bridge' }));
    const row = byTest('doctor-option-IN_STOCK')!;
    const note = row.querySelector('[data-testid="doctor-option-note"]')!;
    expect(note.textContent).toBe('<b>9,999 IQD</b>');
    expect(note.querySelector('b')).toBeNull();
    const price = row.querySelector('[data-testid="doctor-item-price"]')!;
    expect(price.textContent).toContain('2,500');
    expect(price.contains(note)).toBe(false);
    expect(row.querySelector('[data-testid="doctor-item-qty"]')!.textContent).toContain('14');
  });

  it('never renders model text as markup', () => {
    mount(createElement(DoctorAnswer, { result: complaint({ answer: { ...(complaint() as Extract<DoctorResponse, { mode: 'COMPLAINT' }>).answer, likelyCauses: ['<img src=x onerror=alert(1)>'] } }), addMode: 'link' }));
    expect(container.querySelector('img')).toBeNull();
    expect(byTest('doctor-section-likelyCauses')!.textContent).toContain('<img src=x onerror=alert(1)>');
  });

  it('on Sell, Add to cart hands the matched unit to the cart bridge', async () => {
    const got: unknown[] = [];
    const off = bridge.onAddToCart((x) => got.push(x));
    mount(createElement(DoctorAnswer, { result: complaint(), addMode: 'bridge' }));
    await click(byTest('doctor-add')!);
    off();
    expect(got).toEqual([{ unitId: 'u-strip', qty: 1 }]);
    expect(byTest('doctor-add')!.textContent).toContain(en('pharmacy.doctor.option.added'));
  });

  it('adds once: a second tap on the same option adds nothing more, and the button says it is in the cart', async () => {
    const got: unknown[] = [];
    const off = bridge.onAddToCart((x) => got.push(x));
    mount(createElement(DoctorAnswer, { result: complaint(), addMode: 'bridge' }));
    await click(byTest('doctor-add')!);
    await click(byTest('doctor-add')!);
    off();
    expect(got).toHaveLength(1);
    expect((byTest('doctor-add') as HTMLButtonElement).disabled).toBe(true);
  });

  it('for a person who cannot sell, shows the price and quantity but no Add', () => {
    mount(createElement(DoctorAnswer, { result: complaint(), addMode: 'none' }));
    const row = byTest('doctor-option-IN_STOCK')!;
    expect(row.querySelector('[data-testid="doctor-item-price"]')).not.toBeNull();
    expect(byTest('doctor-add')).toBeNull();
    expect(logic.doctorAddMode('PHARMACIST')).toBe('link');
    expect(logic.doctorAddMode('STOCK')).toBe('none');
    expect(logic.doctorAddMode(null)).toBe('none');
  });

  it('on Home, Add to cart is a link that opens Sell with the item', () => {
    mount(createElement(DoctorAnswer, { result: complaint(), addMode: 'link' }));
    const link = byTest('doctor-add')!;
    expect(link.tagName).toBe('A');
    expect(link.getAttribute('href')).toBe('/pharmacy/sell?add=u-strip:1');
  });

  it('draws a REFER with no options at all', () => {
    mount(createElement(DoctorAnswer, { result: refer, addMode: 'bridge' }));
    expect(byTest('doctor-section-options')).toBeNull();
    expect(byTest('doctor-add')).toBeNull();
    expect(byTest('doctor-section-refer')!.textContent).toContain(en(DOCTOR_MESSAGE_KEYS.reason.CHEST_PAIN));
  });
});

// The panel -----------------------------------------------------------------------------------------------------------------

describe('<DoctorPanel>', () => {
  it('asks the server and announces the answer in a live region, with the disclaimer last', async () => {
    actions.askDoctor.mockResolvedValue({ ok: true, data: complaint() });
    mount(createElement(DoctorPanel, { branchId: 'b1', addMode: 'link' }));
    const live = byTest('doctor-live')!;
    expect(live.getAttribute('aria-live')).toBe('polite');
    // In the accessibility tree before anything arrives, or a screen reader may not announce the first answer.
    expect(live.className).not.toMatch(/(^|\s)(empty:)?hidden(\s|$)/);
    let finish: (v: unknown) => void = () => {};
    actions.askDoctor.mockImplementationOnce(() => new Promise((resolve) => (finish = resolve)));
    type(byTest('doctor-complaint')!, 'Headache since this morning');
    type(byTest('doctor-age')!, '30');
    await click(byTest('doctor-ask')!);
    // While asking, the live region itself carries the status: no second live region inserted inside it.
    expect(live.textContent).toContain(en('pharmacy.doctor.asking'));
    expect(live.querySelector('[role="status"]')).toBeNull();
    await act(async () => finish({ ok: true, data: complaint() }));
    await settle();
    expect(byTest('doctor-live')).toBe(live);
    expect(actions.askDoctor).toHaveBeenCalledWith({ mode: 'COMPLAINT', text: 'Headache since this morning', ageYears: 30, branchId: 'b1' });
    expect(byTest('doctor-live')!.contains(byTest('doctor-answer'))).toBe(true);
    expect(byTest('doctor-answer')!.lastElementChild!.getAttribute('data-testid')).toBe('doctor-disclaimer');
  });

  it('shows a calm, translated message when the photo cannot be used, and asks nothing', async () => {
    mount(createElement(DoctorPanel, { branchId: 'b1', addMode: 'link' }), 'ar');
    await click(byTest('doctor-mode-MEDICINE')!);
    const input = byTest('doctor-photo') as HTMLInputElement;
    expect(input.getAttribute('accept')).toBe('image/*');
    expect(input.hasAttribute('capture')).toBe(true);
    const file = new File(['x'], 'a.gif', { type: 'image/gif' });
    await act(async () => {
      Object.defineProperty(input, 'files', { value: [file], configurable: true });
      input.dispatchEvent(new Event('change', { bubbles: true }));
    });
    await settle();
    expect(byTest('doctor-photo-problem')!.textContent).toBe(getStudioTranslator('ar')('pharmacy.doctor.photo.error.TYPE'));
    expect(actions.askDoctor).not.toHaveBeenCalled();
  });

  it('every mode switch and control is labelled in Arabic and Kurdish too (no raw keys)', () => {
    for (const locale of ['ar', 'ckb'] as const) {
      mount(createElement(DoctorPanel, { branchId: 'b1', addMode: 'link' }), locale);
      expect(container.textContent).not.toMatch(/pharmacy\.doctor\./);
    }
  });
});

describe('<DoctorSheet> (phone)', () => {
  it('opens from the floating button, closes with its close button and returns the focus to the button', async () => {
    mount(createElement(DoctorSheet, { branchId: 'b1' }));
    const open = byTest('doctor-fab')!;
    expect(Math.min(...['min-h-11', 'min-h-12', 'min-h-14'].map((c) => (open.className.includes(c) ? 0 : 1)))).toBe(0);
    (open as HTMLElement).focus();
    await click(open);
    const dialog = container.querySelector('dialog')!;
    expect(dialog.hasAttribute('open')).toBe(true);
    expect(dialog.getAttribute('aria-labelledby')).toBeTruthy();
    expect(dialog.querySelector('[data-testid="doctor-complaint"]')).not.toBeNull();
    await click(dialog.querySelector('[data-testid="doctor-sheet-close"]')!);
    expect(dialog.hasAttribute('open')).toBe(false);
    expect(document.activeElement).toBe(open);
  });

  it('closes on Escape (the dialog’s cancel) and returns the focus', async () => {
    mount(createElement(DoctorSheet, { branchId: 'b1' }));
    const open = byTest('doctor-fab')!;
    await click(open);
    const dialog = container.querySelector('dialog')!;
    await act(async () => {
      dialog.removeAttribute('open');
      dialog.dispatchEvent(new Event('close'));
    });
    expect(document.activeElement).toBe(open);
  });

  it('puts the focus in the first field when it opens, and keeps what was typed when it is closed and opened again', async () => {
    mount(createElement(DoctorSheet, { branchId: 'b1' }));
    await click(byTest('doctor-fab')!);
    const dialog = container.querySelector('dialog')!;
    const field = dialog.querySelector('[data-testid="doctor-complaint"]')!;
    expect(document.activeElement).toBe(field);
    type(field, 'Dry cough');
    await click(dialog.querySelector('[data-testid="doctor-sheet-close"]')!);
    await click(byTest('doctor-fab')!);
    expect((dialog.querySelector('[data-testid="doctor-complaint"]') as HTMLTextAreaElement).value).toBe('Dry cough');
  });

  it('closes itself when the screen grows wide enough for the side panel, so the sheet is never open and unseen', async () => {
    const listeners: Array<(e: { matches: boolean }) => void> = [];
    const mql = { matches: false, addEventListener: (_: string, fn: (e: { matches: boolean }) => void) => listeners.push(fn), removeEventListener: vi.fn() };
    const was = window.matchMedia;
    window.matchMedia = vi.fn(() => mql) as never;
    try {
      mount(createElement(DoctorSheet, { branchId: 'b1' }));
      await click(byTest('doctor-fab')!);
      const dialog = container.querySelector('dialog')!;
      expect(dialog.hasAttribute('open')).toBe(true);
      expect(vi.mocked(window.matchMedia).mock.calls[0]![0]).toBe(logic.DOCTOR_SIDE_PANEL_QUERY);
      await act(async () => listeners.forEach((fn) => fn({ matches: true })));
      expect(dialog.hasAttribute('open')).toBe(false);
    } finally {
      window.matchMedia = was;
    }
  });
});

// Who sees it ---------------------------------------------------------------------------------------------------------------

describe('access', () => {
  const actor = { userId: 'u', name: 'U', restaurantId: 'r', restaurantName: 'R', role: 'PHARMACIST' as const, allBranches: false, branchIds: ['b1'], viaMembership: false, aiDoctor: false, support: null, locale: 'en' as const };

  it('draws no slot on Home for a person without access', () => {
    mount(createElement(DoctorSlot, { where: 'home', enabled: false, t: en }));
    expect(container.innerHTML).toBe('');
  });

  // The Doctor is no longer on the sale screen (the cashier replaced it, owner decision): only the Home card is left.
  it('draws the green card that opens the full page on Home for a person with access', () => {
    mount(createElement(DoctorSlot, { where: 'home', enabled: true, t: en }));
    const card = byTest('home-doctor')!;
    expect(card.className).toMatch(/bg-ph-g9|bg-ph-g8/);
    expect(card.querySelector('a[href="/pharmacy/doctor"]')).not.toBeNull();
  });

  it('puts no Doctor item in the nav for a person without access', () => {
    const off = doctorEnabledFor({ actor, aiBudgetMinor: 5000 });
    expect(phNav('PHARMACIST', { branchCount: 1, doctorEnabled: off }).primary.map((i) => i.key)).not.toContain('doctor');
    const on = doctorEnabledFor({ actor: { ...actor, aiDoctor: true }, aiBudgetMinor: 5000 });
    expect(phNav('PHARMACIST', { branchCount: 1, doctorEnabled: on }).primary.map((i) => i.key)).toContain('doctor');
  });

  it('answers 404 on /pharmacy/doctor for a person without access, and reads no history', async () => {
    const { default: DoctorPage } = await import('@/app/pharmacy/(app)/doctor/page');
    access.getPhAccess.mockResolvedValue({ signedIn: true, actor, gate: { state: 'open' }, place: { restaurantId: 'r', branchId: 'b1', branchName: 'Main' } });
    access.doctorNavEnabled.mockResolvedValue(false);
    queries.query.mockReset();
    await expect(DoctorPage()).rejects.toThrow('NEXT_NOT_FOUND');
    expect(queries.query).not.toHaveBeenCalled();
    access.getPhAccess.mockResolvedValue({ signedIn: true, actor: null, gate: null, place: null });
    await expect(DoctorPage()).rejects.toThrow('NEXT_NOT_FOUND');
  });

  it('renders the page with the history for a person with access', async () => {
    const { default: DoctorPage } = await import('@/app/pharmacy/(app)/doctor/page');
    access.getPhAccess.mockResolvedValue({ signedIn: true, actor: { ...actor, aiDoctor: true }, gate: { state: 'open' }, place: { restaurantId: 'r', branchId: 'b1', branchName: 'Main' } });
    access.doctorNavEnabled.mockResolvedValue(true);
    queries.query.mockResolvedValue({ items: [{ id: 'l1', mode: 'COMPLAINT', questionText: 'Dry cough', outcome: 'ANSWERED', createdAt: new Date('2026-11-05T09:00:00Z'), mine: true }] });
    mount(await DoctorPage());
    expect(byTest('doctor-history')!.textContent).toContain('Dry cough');
    expect(byTest('doctor-panel')).not.toBeNull();
    expect(allTest('doctor-history-item')).toHaveLength(1);
  });
});
