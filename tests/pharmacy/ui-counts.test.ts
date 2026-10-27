// @vitest-environment jsdom
import { act, createElement, type ComponentProps, type ReactElement, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Locale } from '@/lib/locale';
import type { CountDetail, CountLineView } from '@/server/pharmacy/counts';
import { StudioI18nProvider } from '@/studio/i18n';
import { getStudioTranslator, STUDIO_MESSAGES } from '@/studio/messages';

/**
 * The stock count screens (Phase 2, Task 9c) mounted in a browser-like document and used as a person would: start a
 * count, enter numbers from the keyboard, save, submit, review the differences, approve, and read the server's refusals.
 * The Server Actions are stood in for. jsdom has no layout, so the sideways-scroll and axe checks are in
 * tests/e2e/pharmacy-counts-expiry.spec.ts.
 */

const router = vi.hoisted(() => ({ refresh: vi.fn(), push: vi.fn(), replace: vi.fn() }));
vi.mock('next/navigation', () => ({ useRouter: () => router }));
vi.mock('next/link', () => ({
  default: ({ href, children, ...rest }: { href: string; children: ReactNode }) => createElement('a', { href, ...rest }, children),
}));
vi.mock('@/studio/request-locale', () => ({ requestStudioLocale: async () => 'en' }));
const actions = vi.hoisted(() => ({
  openCount: vi.fn(),
  recordCounts: vi.fn(),
  submitCount: vi.fn(),
  cancelCount: vi.fn(),
  approveCount: vi.fn(),
}));
vi.mock('@/app/pharmacy/_actions/counts', () => actions);

const { CountWorkspace } = await import('@/app/pharmacy/_ui/CountWorkspace');
const { CountStart } = await import('@/app/pharmacy/_ui/CountStart');
const { CountStatus } = await import('@/app/pharmacy/_ui/CountStatus');
const { CountBlocked } = await import('@/app/pharmacy/_ui/CountBlocked');
const { digitsOf, unsavedEntries } = await import('@/app/pharmacy/_ui/count-draft');
const { default: CountsError } = await import('@/app/pharmacy/(app)/stock/counts/error');
const { default: CountsLoading } = await import('@/app/pharmacy/(app)/stock/counts/loading');

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

async function click(element: Element | undefined) {
  await act(async () => {
    (element as HTMLElement).click();
  });
}

function type(input: HTMLInputElement | HTMLTextAreaElement, value: string) {
  const proto = input instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
  const setter = Object.getOwnPropertyDescriptor(proto, 'value')!.set!;
  act(() => {
    setter.call(input, value);
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });
}

async function press(element: Element, key: string) {
  await act(async () => {
    element.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true }));
    await new Promise((resolve) => setTimeout(resolve, 10));
  });
}

const button = (label: string) => [...document.querySelectorAll('button')].find((b) => b.textContent?.trim().startsWith(label)) as HTMLButtonElement | undefined;
const text = () => container.textContent ?? '';
const inputs = () => [...container.querySelectorAll<HTMLInputElement>('[data-count-input]')];
const failure = (code: string, message: string, fields: Record<string, string> = {}) => ({ ok: false, error: { code: 'CONFLICT', message, fields: { phCode: code, ...fields } } });

const line = (n: number, over: Partial<CountLineView> = {}): CountLineView => ({
  lineId: `l${n}`,
  productId: `p${n}`,
  productName: n === 1 ? 'Panadol' : n === 2 ? 'Amoxil' : 'Brufen',
  batchId: `b${n}`,
  lot: `LOT-${n}`,
  expiryDate: n === 1 ? '2027-03-31' : '2027-06-14',
  expiryPrecision: n === 1 ? 'MONTH' : 'DAY',
  countedQty: null,
  expectedQty: 10 * n,
  ...over,
});

const detail = (over: Partial<CountDetail> = {}): CountDetail => ({
  id: 'c1',
  status: 'OPEN',
  branchId: 'b1',
  scope: 'BRANCH',
  scopeValue: '',
  blind: false,
  note: '',
  countedById: 'user-1',
  approvedById: null,
  lineCount: 3,
  version: 4,
  createdAt: '2026-10-27T08:00:00.000Z',
  submittedAt: null,
  approvedAt: null,
  reason: '',
  lines: [line(1), line(2), line(3)],
  ...over,
});

const props = (count: CountDetail, over: Record<string, unknown> = {}) => ({ userId: 'user-1', restaurantId: 'r1', count, canCount: true, canApprove: true, ...over });

/** A submitted count: Panadol 12 vs 10 (+2), Amoxil 17 vs 20 (-3), Brufen 30 vs 30 (match). */
const submitted = (over: Partial<CountDetail> = {}) =>
  detail({
    status: 'SUBMITTED',
    lines: [line(1, { countedQty: 12, difference: 2 }), line(2, { countedQty: 17, difference: -3 }), line(3, { countedQty: 30, difference: 0 })],
    ...over,
  });

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
  Object.defineProperty(navigator, 'onLine', { value: true, configurable: true });
});

describe('count entries', () => {
  it('digits only, Arabic-Indic digits read as Latin, and only new valid numbers are sent', () => {
    expect(digitsOf('١٢a3')).toBe('123');
    expect(digitsOf('۴۵')).toBe('45');
    const lines = [line(1, { countedQty: 5 }), line(2), line(3)];
    expect(unsavedEntries(lines, { l1: '5', l2: '7', l3: '' })).toEqual([{ lineId: 'l2', countedQty: 7 }]);
    expect(unsavedEntries(lines, { l1: '6' })).toEqual([{ lineId: 'l1', countedQty: 6 }]);
    expect(unsavedEntries(lines, { l2: '2000000000' })).toEqual([]);
  });
});

describe('the counting sheet', () => {
  it('a blind count shows no expected quantity and says so; an open one shows it', () => {
    mount(createElement(CountWorkspace, props(detail({ blind: true, lines: [line(1, { expectedQty: undefined }), line(2, { expectedQty: undefined })] }))));
    expect(container.querySelector('[data-testid="count-blind-notice"]')?.textContent).toContain('Blind count');
    expect(container.querySelectorAll('[data-testid="count-expected"]')).toHaveLength(0);
    act(() => root.unmount());
    root = createRoot(container);
    mount(createElement(CountWorkspace, props(detail())));
    expect([...container.querySelectorAll('[data-testid="count-expected"]')].map((e) => e.textContent)).toEqual(['10', '20', '30']);
    expect(container.querySelector('[data-testid="count-blind-notice"]')).toBeNull();
  });

  it('shows product, lot left to right, and the expiry as MM/YYYY or DD/MM/YYYY', () => {
    mount(createElement(CountWorkspace, props(detail())));
    expect(text()).toContain('Panadol');
    expect(container.querySelector('[data-testid="count-lot"]')?.getAttribute('dir')).toBe('ltr');
    expect(text()).toContain('03/2027');
    expect(text()).toContain('14/06/2027');
    expect(container.querySelector('[data-testid="count-progress"]')?.textContent).toBe('0 of 3 lines counted');
  });

  it('Enter and the arrow keys move between lines', async () => {
    mount(createElement(CountWorkspace, props(detail())));
    const [a, b, c] = inputs();
    a!.focus();
    await press(a!, 'Enter');
    expect(document.activeElement).toBe(b);
    await press(b!, 'ArrowDown');
    expect(document.activeElement).toBe(c);
    await press(c!, 'ArrowUp');
    expect(document.activeElement).toBe(b);
  });

  it('saves only the typed numbers, with no place in the payload, and says how many', async () => {
    actions.recordCounts.mockResolvedValue({ ok: true, data: { id: 'c1', recorded: 2, version: 5 } });
    mount(createElement(CountWorkspace, props(detail())));
    type(inputs()[0]!, '١٢');
    type(inputs()[2]!, '30');
    expect(container.textContent).toContain('Unsaved changes');
    await click(button('Save counts'));
    await settle();
    expect(actions.recordCounts).toHaveBeenCalledWith({
      countId: 'c1',
      lines: [
        { lineId: 'l1', countedQty: 12 },
        { lineId: 'l3', countedQty: 30 },
      ],
    });
    expect(JSON.stringify(actions.recordCounts.mock.calls[0])).not.toMatch(/restaurantId|branchId/);
    expect(container.querySelector('[data-testid="count-done"]')?.textContent).toBe('2 counts saved.');
    expect(router.refresh).toHaveBeenCalled();
  });

  it('submit with lines not counted needs the skip choice, saves first, then submits', async () => {
    actions.recordCounts.mockResolvedValue({ ok: true, data: {} });
    actions.submitCount.mockResolvedValue({ ok: true, data: { id: 'c1', status: 'SUBMITTED', uncounted: 2 } });
    mount(createElement(CountWorkspace, props(detail())));
    type(inputs()[0]!, '9');
    await click(button('Submit count'));
    const panel = container.querySelector('[data-testid="count-submit-panel"]')!;
    expect(panel.textContent).toContain('2 lines are not counted.');
    const yes = button('Submit for approval')!;
    expect(yes.disabled).toBe(true);
    await click(panel.querySelector('input[type="checkbox"]')!);
    expect(yes.disabled).toBe(false);
    await click(yes);
    await settle();
    expect(actions.recordCounts).toHaveBeenCalledWith({ countId: 'c1', lines: [{ lineId: 'l1', countedQty: 9 }] });
    expect(actions.submitCount).toHaveBeenCalledWith({ countId: 'c1', skipUncounted: true });
    expect(container.querySelector('[data-testid="count-done"]')?.textContent).toBe('The count was submitted for approval.');
  });

  it('with every line counted there is nothing to skip', async () => {
    actions.recordCounts.mockResolvedValue({ ok: true, data: {} });
    actions.submitCount.mockResolvedValue({ ok: true, data: {} });
    mount(createElement(CountWorkspace, props(detail())));
    inputs().forEach((input, i) => type(input, String(i + 1)));
    expect(text()).toContain('Every line is counted.');
    await click(button('Submit count'));
    expect(container.querySelector('[data-testid="count-submit-panel"] input[type="checkbox"]')).toBeNull();
    await click(button('Submit for approval'));
    await settle();
    expect(actions.submitCount).toHaveBeenCalledWith({ countId: 'c1', skipUncounted: false });
  });

  it('only the lines not counted can be shown', async () => {
    mount(createElement(CountWorkspace, props(detail({ lines: [line(1, { countedQty: 3 }), line(2), line(3)] }))));
    expect(container.querySelectorAll('[data-testid="count-line"]')).toHaveLength(3);
    await click(container.querySelector('input[type="checkbox"]')!);
    expect(container.querySelectorAll('[data-testid="count-line"]')).toHaveLength(2);
  });

  it('another person counting is refused in words with what to do next', async () => {
    actions.recordCounts.mockResolvedValue(failure('COUNT_OWNED', 'Another person is already counting this; cancel it to count again'));
    mount(createElement(CountWorkspace, props(detail())));
    type(inputs()[0]!, '4');
    await click(button('Save counts'));
    await settle();
    const alert = container.querySelector('[data-testid="count-error"]')!;
    expect(alert.textContent).toBe('Another person is already counting this. Ask them to continue, or cancel this count and start a new one.');
    expect(alert.querySelector('svg')).not.toBeNull();
  });

  it('cancel asks first, then cancels and says stock was not changed', async () => {
    actions.cancelCount.mockResolvedValue({ ok: true, data: { id: 'c1', status: 'CANCELLED' } });
    mount(createElement(CountWorkspace, props(detail())));
    await click(button('Cancel count'));
    expect(actions.cancelCount).not.toHaveBeenCalled();
    await click(button('Cancel the count'));
    await settle();
    expect(actions.cancelCount).toHaveBeenCalledWith({ countId: 'c1' });
    expect(container.querySelector('[data-testid="count-done"]')?.textContent).toContain('Stock was not changed');
  });

  it('a role that cannot count sees the numbers read only, with no inputs or save', () => {
    mount(createElement(CountWorkspace, props(detail({ lines: [line(1, { countedQty: 8 }), line(2), line(3)] }), { canCount: false })));
    expect(inputs()).toHaveLength(0);
    expect(button('Save counts')).toBeUndefined();
    expect(text()).toContain('8');
  });

  it('offline: says so and disables saving', async () => {
    Object.defineProperty(navigator, 'onLine', { value: false, configurable: true });
    mount(createElement(CountWorkspace, props(detail())));
    act(() => {
      window.dispatchEvent(new Event('offline'));
    });
    expect(container.querySelector('[data-testid="count-offline"]')?.querySelector('svg')).not.toBeNull();
    expect(button('Save counts')!.disabled).toBe(true);
  });
});

describe('the review and the approval', () => {
  it('lists expected, counted and difference with an icon and a word for each', () => {
    mount(createElement(CountWorkspace, props(submitted())));
    expect(container.querySelector('[data-testid="count-summary"]')?.textContent).toBe('3 lines counted, 2 differ, net −1');
    const surplus = container.querySelector('[data-diff="surplus"]')!;
    const shortage = container.querySelector('[data-diff="shortage"]')!;
    const match = container.querySelector('[data-diff="match"]')!;
    expect(surplus.textContent).toBe('Surplus +2');
    expect(shortage.textContent).toBe('Shortage −3');
    expect(match.textContent).toBe('Matches');
    for (const chip of [surplus, shortage, match]) expect(chip.querySelector('svg')).not.toBeNull();
    expect([...container.querySelectorAll('[data-testid="count-counted"]')].map((e) => e.textContent)).toEqual(['12', '17', '30']);
  });

  it('can show only the lines that differ', async () => {
    mount(createElement(CountWorkspace, props(submitted())));
    await click(container.querySelector('input[type="checkbox"]')!);
    expect(container.querySelectorAll('[data-testid="count-line"]')).toHaveLength(2);
  });

  it('a skipped line says it was not counted', () => {
    mount(createElement(CountWorkspace, props(submitted({ lines: [line(1, { countedQty: 12, difference: 2 }), line(2)] }))));
    expect(text()).toContain('Not counted');
  });

  it('approving with differences needs a reason and sends the version it reviewed', async () => {
    actions.approveCount.mockResolvedValue({ ok: true, data: { movements: 2, netDifference: -1 } });
    mount(createElement(CountWorkspace, props(submitted())));
    const reason = container.querySelector<HTMLTextAreaElement>('[data-testid="count-approve"] textarea')!;
    expect(reason.required).toBe(true);
    type(reason, 'Shelf recount agreed');
    await click(button('Approve and update stock'));
    await settle();
    expect(actions.approveCount).toHaveBeenCalledWith({ countId: 'c1', reason: 'Shelf recount agreed', expectedVersion: 4 });
    expect(container.querySelector('[data-testid="count-done"]')?.textContent).toBe('Count approved. 2 corrections were made to stock, net −1.');
  });

  it('when nothing differs the reason is optional and the review says so', () => {
    mount(createElement(CountWorkspace, props(submitted({ lines: [line(1, { countedQty: 10, difference: 0 })] }))));
    expect(container.querySelector<HTMLTextAreaElement>('[data-testid="count-approve"] textarea')!.required).toBe(false);
    expect(text()).toContain('Approving changes no stock.');
  });

  it('a stale count names the product and lot and says to cancel and count again', async () => {
    actions.approveCount.mockResolvedValue(failure('STALE_COUNT', 'Panadol (lot LOT-1) was already corrected by another count: cancel this count and count again', { lineId: 'l1', batchId: 'b1' }));
    mount(createElement(CountWorkspace, props(submitted())));
    type(container.querySelector<HTMLTextAreaElement>('[data-testid="count-approve"] textarea')!, 'Recount');
    await click(button('Approve and update stock'));
    await settle();
    const message = container.querySelector('[data-testid="count-error"]')!.textContent!;
    expect(message).toContain('Panadol (lot LOT-1)');
    expect(message).toContain('Cancel this count and count again.');
  });

  it('a second person is needed: the refusal says who must approve', async () => {
    actions.approveCount.mockResolvedValue(failure('SELF_APPROVAL', 'Someone else must approve a count you made'));
    mount(createElement(CountWorkspace, props(submitted())));
    type(container.querySelector<HTMLTextAreaElement>('[data-testid="count-approve"] textarea')!, 'Recount');
    await click(button('Approve and update stock'));
    await settle();
    expect(container.querySelector('[data-testid="count-error"]')?.textContent).toBe('You made this count, and another person in this branch may approve stock changes. Ask them to approve it.');
    expect(text()).toContain('If you made this count, someone else who may adjust stock must approve it');
  });

  it('not enough stock left names the line and what to do', async () => {
    actions.approveCount.mockResolvedValue(failure('INSUFFICIENT_STOCK', 'Amoxil (lot LOT-2) has only 1 left', { lineId: 'l2', batchId: 'b2', have: '1', difference: '-3' }));
    mount(createElement(CountWorkspace, props(submitted())));
    type(container.querySelector<HTMLTextAreaElement>('[data-testid="count-approve"] textarea')!, 'Recount');
    await click(button('Approve and update stock'));
    await settle();
    const message = container.querySelector('[data-testid="count-error"]')!.textContent!;
    expect(message).toContain('Amoxil (lot LOT-2) has only 1 left');
    expect(message).toContain('difference of -3');
    expect(message).toContain('Nothing was changed.');
  });

  it('a role that cannot approve sees the review and a sentence, not the form', () => {
    mount(createElement(CountWorkspace, props(submitted(), { canApprove: false })));
    expect(container.querySelector('[data-testid="count-approve"]')).toBeNull();
    expect(container.querySelector('[data-testid="count-cannot-approve"]')?.textContent).toContain('not approve');
  });

  it('an approved count shows its reason and a cancelled one says nothing was applied', () => {
    mount(createElement(CountWorkspace, props(submitted({ status: 'APPROVED', reason: 'Recount agreed', approvedAt: '2026-10-27T09:30:00.000Z' }))));
    expect(container.querySelector('[data-testid="count-approved-view"]')?.textContent).toContain('Reason: Recount agreed');
    expect(container.querySelector('[data-testid="count-approve"]')).toBeNull();
    act(() => root.unmount());
    root = createRoot(container);
    mount(createElement(CountWorkspace, props(submitted({ status: 'CANCELLED' }))));
    expect(container.querySelector('[data-testid="count-cancelled-view"]')?.textContent).toContain('Nothing was applied');
  });

  it('the submitted count can be cancelled by someone who may count, after a second step', async () => {
    actions.cancelCount.mockResolvedValue({ ok: true, data: {} });
    mount(createElement(CountWorkspace, props(submitted())));
    await click(button('Cancel count'));
    await click(button('Cancel the count'));
    await settle();
    expect(actions.cancelCount).toHaveBeenCalledWith({ countId: 'c1' });
  });
});

describe('starting a count', () => {
  const categories = [{ id: 'cat1', name: 'Analgesics' }];

  it('starts a category count with the blind choice and goes to its sheet', async () => {
    actions.openCount.mockResolvedValue({ ok: true, data: { id: 'new1', status: 'OPEN' } });
    mount(createElement(CountStart, { branchName: 'Main street', categories }));
    const select = container.querySelectorAll('select')[0] as HTMLSelectElement;
    await act(async () => {
      select.value = 'CATEGORY';
      select.dispatchEvent(new Event('change', { bubbles: true }));
    });
    const category = container.querySelectorAll('select')[1] as HTMLSelectElement;
    await act(async () => {
      category.value = 'cat1';
      category.dispatchEvent(new Event('change', { bubbles: true }));
    });
    await click(container.querySelector('input[type="checkbox"]')!);
    await click(button('Start counting'));
    await settle();
    expect(actions.openCount).toHaveBeenCalledWith({ scope: 'CATEGORY', categoryId: 'cat1', blind: true, note: '' });
    expect(router.push).toHaveBeenCalledWith('/pharmacy/stock/counts/new1');
  });

  it('a shelf count sends the location, and an empty scope is refused in words', async () => {
    actions.openCount.mockResolvedValue({ ok: false, error: { code: 'INVALID', message: 'Nothing in stock matches this scope', fields: { scope: 'Nothing in stock matches this scope', phCode: 'EMPTY_SCOPE' } } });
    mount(createElement(CountStart, { branchName: 'Main street', categories }));
    const select = container.querySelectorAll('select')[0] as HTMLSelectElement;
    await act(async () => {
      select.value = 'LOCATION';
      select.dispatchEvent(new Event('change', { bubbles: true }));
    });
    type(container.querySelector<HTMLInputElement>('input[maxlength="100"]')!, 'A1');
    await click(button('Start counting'));
    await settle();
    expect(actions.openCount).toHaveBeenCalledWith({ scope: 'LOCATION', location: 'A1', blind: false, note: '' });
    expect(container.querySelector('[data-testid="count-start-error"]')?.textContent).toBe('Nothing in stock matches this choice. Pick another category or shelf.');
    expect(router.push).not.toHaveBeenCalled();
  });
});

describe('states and words', () => {
  it('each count state is an icon and a word', () => {
    for (const status of ['OPEN', 'SUBMITTED', 'APPROVED', 'CANCELLED'] as const) {
      mount(createElement(CountStatus, { status, t: en }));
      const chip = container.querySelector(`[data-status="${status}"]`)!;
      expect(chip.querySelector('svg')).not.toBeNull();
      expect(chip.textContent).toBe(en(`pharmacy.counts.status.${status}`));
    }
  });

  it('blocked, loading and error states have text and an icon', async () => {
    for (const reason of ['readOnly', 'role', 'support'] as const) {
      mount(createElement(CountBlocked, { reason, t: en }));
      expect(container.querySelector('svg')).not.toBeNull();
      expect(text()).toBe(en(`pharmacy.counts.blocked.${reason}`));
    }
    mount(await CountsLoading());
    expect(container.querySelector('[role="status"] svg')).not.toBeNull();
    expect(text()).toBe('Loading counts…');
    const reset = vi.fn();
    mount(createElement(CountsError, { error: new Error('x'), reset }));
    expect(container.querySelector('[role="alert"] svg')).not.toBeNull();
    await click(button('Try again'));
    expect(reset).toHaveBeenCalled();
  });

  it.each(['ar', 'ckb'] as const)('the sheet and the review read right to left in %s with logical classes only', (locale) => {
    mount(createElement(CountWorkspace, props(detail())), locale);
    expect(document.documentElement.dir).toBe('rtl');
    expect(container.querySelector('[data-testid="count-lot"]')?.getAttribute('dir')).toBe('ltr');
    expect(inputs()[0]!.getAttribute('dir')).toBe('ltr');
    act(() => root.unmount());
    root = createRoot(container);
    mount(createElement(CountWorkspace, props(submitted())), locale);
    const html = container.innerHTML;
    expect(html).not.toMatch(/\b(?:ml|mr|pl|pr|left|right)-\d/);
    expect(html).not.toMatch(/\btext-(?:left|right)\b/);
    expect([...container.querySelectorAll('.whitespace-nowrap')].filter((el) => !el.classList.contains('s-btn'))).toEqual([]);
    expect(text()).not.toContain('pharmacy.counts');
  });

  it('touch targets: every control is at least 44px by class', () => {
    mount(createElement(CountWorkspace, props(detail())));
    for (const el of container.querySelectorAll('input:not([type="checkbox"]), select, button')) {
      expect(el.className + (el.parentElement?.className ?? ''), el.outerHTML.slice(0, 80)).toMatch(/min-h-11/);
    }
    act(() => root.unmount());
    root = createRoot(container);
    mount(createElement(CountWorkspace, props(submitted())));
    for (const el of container.querySelectorAll('input:not([type="checkbox"]), select, button')) {
      expect(el.className + (el.parentElement?.className ?? ''), el.outerHTML.slice(0, 80)).toMatch(/min-h-11/);
    }
  });

  it('en, ar and ckb have the same count keys with the same placeholders', () => {
    const keys = Object.keys(STUDIO_MESSAGES.en).filter((k) => k.startsWith('pharmacy.counts.') || k === 'pharmacy.nav.counts');
    expect(keys.length).toBeGreaterThan(90);
    const holes = (m: Record<string, string>) => (k: string) => [...(m[k] ?? '').matchAll(/\{(\w+)\}/g)].map((x) => x[1]).sort().join(',');
    for (const locale of ['ar', 'ckb'] as const) {
      const other = STUDIO_MESSAGES[locale] as Record<string, string>;
      for (const key of keys) {
        expect(other[key], `${locale} ${key}`).toBeTruthy();
        expect(holes(other)(key), `${locale} ${key}`).toBe(holes(STUDIO_MESSAGES.en as Record<string, string>)(key));
      }
    }
  });
});
