// @vitest-environment jsdom
import { act, createElement, type ComponentProps, type ReactElement, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Locale } from '@/lib/locale';
import type { ExpiryRow } from '@/server/pharmacy/expiry';
import { StudioI18nProvider } from '@/studio/i18n';
import { getStudioTranslator, STUDIO_MESSAGES } from '@/studio/messages';

/**
 * The expiry screen (Phase 2, Task 9c) mounted in a browser-like document: the rows with their time left in words, the
 * bands as icon and text, the totals, and the follow-up form with its explanations and the server's refusals. The Server
 * Action is stood in for. Layout and axe checks are in tests/e2e/pharmacy-counts-expiry.spec.ts.
 */

const router = vi.hoisted(() => ({ refresh: vi.fn(), push: vi.fn(), replace: vi.fn() }));
vi.mock('next/navigation', () => ({ useRouter: () => router }));
vi.mock('next/link', () => ({
  default: ({ href, children, ...rest }: { href: string; children: ReactNode }) => createElement('a', { href, ...rest }, children),
}));
vi.mock('@/studio/request-locale', () => ({ requestStudioLocale: async () => 'en' }));
const actions = vi.hoisted(() => ({ setExpiryStatus: vi.fn() }));
vi.mock('@/app/pharmacy/_actions/expiry', () => actions);

const { ExpiryList, ExpiryTotalsRow, BandChip, leftText } = await import('@/app/pharmacy/_ui/ExpiryList');
const { default: ExpiryError } = await import('@/app/pharmacy/(app)/stock/expiry/error');
const { default: ExpiryLoading } = await import('@/app/pharmacy/(app)/stock/expiry/loading');

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

async function choose(select: HTMLSelectElement, value: string) {
  await act(async () => {
    select.value = value;
    select.dispatchEvent(new Event('change', { bubbles: true }));
  });
}

const button = (label: string) => [...document.querySelectorAll('button')].find((b) => b.textContent?.trim().startsWith(label)) as HTMLButtonElement | undefined;
const text = () => container.textContent ?? '';
const bare = (el: Element | null | undefined) => (el?.textContent ?? '').replace(/[⁦-⁩]/g, '');

const row = (over: Partial<ExpiryRow> = {}): ExpiryRow => ({
  product: { productId: 'p1', tradeName: 'Panadol', strength: '500 mg', form: 'tablet' },
  batch: { batchId: 'b1', lot: 'LOT-9', expiryDate: '2026-11-30', expiryPrecision: 'MONTH', status: 'ACTIVE' },
  branchId: 'br1',
  buckets: { available: 12, reserved: 2, quarantine: 0 },
  band: 'd30',
  daysToExpiry: 34,
  action: { status: 'NEW', assigneeId: null, note: '' },
  ...over,
});

const list = (items: ExpiryRow[], over: Record<string, unknown> = {}) =>
  createElement(ExpiryList, { items, t: en, userId: 'user-1', canFollow: true, branchNames: null, ...over });

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

describe('the expiry rows', () => {
  it('says the time left in words', () => {
    expect(leftText(en, 0)).toBe('Expires today');
    expect(leftText(en, 1)).toBe('1 day left');
    expect(leftText(en, 34)).toBe('34 days left');
    expect(leftText(en, -1)).toBe('Expired 1 day ago');
    expect(leftText(en, -12)).toBe('Expired 12 days ago');
  });

  it('shows product, lot and expiry left to right, the band, the stock and the follow-up status', () => {
    mount(list([row()]));
    expect(text()).toContain('Panadol');
    expect(text()).toContain('500 mg · tablet');
    expect(container.querySelector('[data-testid="expiry-lot"]')?.getAttribute('dir')).toBe('ltr');
    expect(bare(container.querySelector('[data-testid="expiry-date"]'))).toBe('11/2026');
    expect(container.querySelector('[data-testid="expiry-left"]')?.textContent).toBe('34 days left');
    expect(text()).toContain('Available12');
    expect(text()).toContain('Reserved2');
    const band = container.querySelector('span[data-band="d30"]')!;
    expect(band.querySelector('svg')).not.toBeNull();
    expect(text()).toContain('Within 30 days');
    expect(container.querySelector('[data-follow="NEW"]')?.textContent).toBe('New');
  });

  it('a day-precision expiry reads DD/MM/YYYY and an expired batch says how long ago, with an icon', () => {
    mount(list([row({ batch: { batchId: 'b2', lot: 'X1', expiryDate: '2026-10-20', expiryPrecision: 'DAY', status: 'ACTIVE' }, band: 'expired', daysToExpiry: -7 })]));
    expect(bare(container.querySelector('[data-testid="expiry-date"]'))).toBe('20/10/2026');
    expect(container.querySelector('[data-testid="expiry-left"]')?.textContent).toBe('Expired 7 days ago');
    const band = container.querySelector('span[data-band="expired"]')!;
    expect(band.textContent).toBe('Expired');
    expect(band.querySelector('svg')).not.toBeNull();
  });

  it('recalled, blocked and quarantined batches carry their own chips, and branch names show on all branches', () => {
    mount(list([row({ batch: { batchId: 'b3', lot: 'R1', expiryDate: '2026-12-01', expiryPrecision: 'DAY', status: 'RECALLED' }, buckets: { available: 1, reserved: 0, quarantine: 3 } })], { branchNames: { br1: 'Main street' } }));
    expect(container.querySelector('[data-chip="recalled"]')?.querySelector('svg')).not.toBeNull();
    expect(container.querySelector('[data-chip="quarantine"]')).not.toBeNull();
    expect(text()).toContain('Branch: Main street');
  });

  it('shows who has it and the note, and every band chip has an icon', () => {
    mount(list([row({ action: { status: 'IN_PROGRESS', assigneeId: 'user-1', note: 'Call the supplier' } }), row({ batch: { batchId: 'b4', lot: 'L4', expiryDate: '2027-01-31', expiryPrecision: 'MONTH', status: 'ACTIVE' }, action: { status: 'DISPOSED', assigneeId: 'other', note: '' } })]));
    expect(text()).toContain('Assigned toYou');
    expect(text()).toContain('Assigned toSomeone else');
    expect(text()).toContain('Call the supplier');
    for (const band of ['expired', 'd30', 'd60', 'd90', 'd180'] as const) {
      mount(createElement(BandChip, { band, t: en }));
      expect(container.querySelector('svg')).not.toBeNull();
      expect(text()).toBe(en(`pharmacy.expiry.band.${band}`));
    }
  });

  it('draws no follow-up form for a role that may not adjust stock', () => {
    mount(list([row()], { canFollow: false }));
    expect(container.querySelector('[data-testid="expiry-followup"]')).toBeNull();
    expect(container.querySelector('[data-follow="NEW"]')).not.toBeNull();
  });
});

describe('the totals', () => {
  it('shows expired and the bands up to the horizon, each with an icon and a number', () => {
    mount(createElement(ExpiryTotalsRow, { totals: { expired: 2, d30: 1, d60: 0, d90: 4, d180: 9 }, days: 60, t: en }));
    const items = [...container.querySelectorAll('[data-total]')];
    expect(items.map((i) => i.getAttribute('data-total'))).toEqual(['expired', 'd30', 'd60']);
    expect(items.map((i) => i.textContent)).toEqual(['Expired2', 'Within 30 days1', '31 to 60 days0']);
    for (const item of items) expect(item.querySelector('svg')).not.toBeNull();
    mount(createElement(ExpiryTotalsRow, { totals: { expired: 0, d30: 0, d60: 0, d90: 0, d180: 0 }, days: 180, t: en }));
    expect(container.querySelectorAll('[data-total]')).toHaveLength(5);
  });
});

describe('the follow-up form', () => {
  const open = () => mount(list([row({ action: { status: 'NEW', assigneeId: null, note: '' } })]));
  const selects = () => [...container.querySelectorAll('select')] as HTMLSelectElement[];

  it('saves a status, assignee and note without naming the place', async () => {
    actions.setExpiryStatus.mockResolvedValue({ ok: true, data: { changed: true, disposedQty: 0, labelOnly: false } });
    open();
    await choose(selects()[0]!, 'IN_PROGRESS');
    await choose(selects()[1]!, 'me');
    type(container.querySelector('textarea')!, 'Ask the supplier');
    await click(button('Save follow-up'));
    await settle();
    expect(actions.setExpiryStatus).toHaveBeenCalledWith({ batchId: 'b1', status: 'IN_PROGRESS', assigneeId: 'user-1', note: 'Ask the supplier' });
    expect(JSON.stringify(actions.setExpiryStatus.mock.calls[0])).not.toMatch(/restaurantId|branchId/);
    expect(container.querySelector('[data-testid="expiry-saved"]')?.textContent).toBe('Follow-up saved.');
    expect(router.refresh).toHaveBeenCalled();
  });

  it('leaving the assignee alone sends nothing for it; "Nobody" clears it', async () => {
    actions.setExpiryStatus.mockResolvedValue({ ok: true, data: { changed: false, disposedQty: 0, labelOnly: false } });
    mount(list([row({ action: { status: 'NEW', assigneeId: 'other', note: '' } })]));
    expect(selects()[1]!.value).toBe('keep');
    await click(button('Save follow-up'));
    await settle();
    expect(actions.setExpiryStatus.mock.calls[0]![0]).not.toHaveProperty('assigneeId');
    expect(container.querySelector('[data-testid="expiry-saved"]')?.textContent).toBe('Nothing changed.');
    await choose(selects()[1]!, 'none');
    await click(button('Save follow-up'));
    await settle();
    expect(actions.setExpiryStatus.mock.calls[1]![0]).toMatchObject({ assigneeId: null });
  });

  it('Moved and Returned say they are labels only and the result says no stock moved', async () => {
    actions.setExpiryStatus.mockResolvedValue({ ok: true, data: { changed: true, disposedQty: 0, labelOnly: true } });
    open();
    expect(container.querySelector('[data-testid="expiry-label-only"]')).toBeNull();
    await choose(selects()[0]!, 'MOVED');
    expect(container.querySelector('[data-testid="expiry-label-only"]')?.textContent).toContain('labels only for now');
    await click(button('Save follow-up'));
    await settle();
    expect(container.querySelector('[data-testid="expiry-saved"]')?.textContent).toBe('Follow-up saved as a label. No stock was moved.');
  });

  it('Disposed with stock left asks for the exact quantity and says it is written off as damaged', async () => {
    actions.setExpiryStatus.mockResolvedValue({ ok: true, data: { changed: true, disposedQty: 12, labelOnly: false } });
    open();
    await choose(selects()[0]!, 'DISPOSED');
    const qty = container.querySelector<HTMLInputElement>('input[inputmode="numeric"]')!;
    expect(qty.getAttribute('dir')).toBe('ltr');
    expect(text()).toContain('enter 12 (available plus quarantine)');
    expect(text()).toContain('written off as damaged');
    type(qty, '١٢');
    await click(button('Save follow-up'));
    await settle();
    expect(actions.setExpiryStatus).toHaveBeenCalledWith({ batchId: 'b1', status: 'DISPOSED', assigneeId: null, note: '', disposeQty: 12 });
    expect(container.querySelector('[data-testid="expiry-saved"]')?.textContent).toBe('Follow-up saved. 12 units were written off as damaged.');
  });

  it('Disposed with no stock left needs no quantity', async () => {
    mount(list([row({ buckets: { available: 0, reserved: 3, quarantine: 0 } })]));
    await choose(selects()[0]!, 'DISPOSED');
    expect(container.querySelector('input[inputmode="numeric"]')).toBeNull();
  });

  it('a wrong quantity is refused in words that say what to enter', async () => {
    actions.setExpiryStatus.mockResolvedValue({ ok: false, error: { code: 'CONFLICT', message: 'Stock left', fields: { phCode: 'STOCK_LEFT', left: '12' } } });
    open();
    await choose(selects()[0]!, 'DISPOSED');
    type(container.querySelector<HTMLInputElement>('input[inputmode="numeric"]')!, '5');
    await click(button('Save follow-up'));
    await settle();
    const alert = container.querySelector('[data-testid="expiry-error"]')!;
    expect(alert.textContent).toContain('enter exactly that quantity');
    expect(alert.querySelector('svg')).not.toBeNull();
  });

  it('offline: the save is disabled', () => {
    Object.defineProperty(navigator, 'onLine', { value: false, configurable: true });
    open();
    act(() => {
      window.dispatchEvent(new Event('offline'));
    });
    expect(button('Save follow-up')!.disabled).toBe(true);
  });
});

describe('states and words', () => {
  it('loading and error have text and an icon, and error offers a retry', async () => {
    mount(await ExpiryLoading());
    expect(container.querySelector('[role="status"] svg')).not.toBeNull();
    expect(text()).toBe('Loading expiry list…');
    const reset = vi.fn();
    mount(createElement(ExpiryError, { error: new Error('x'), reset }));
    expect(container.querySelector('[role="alert"] svg')).not.toBeNull();
    await click(button('Try again'));
    expect(reset).toHaveBeenCalled();
  });

  it.each(['ar', 'ckb'] as const)('reads right to left in %s with logical classes, lot and expiry left to right', (locale) => {
    mount(list([row({ action: { status: 'IN_PROGRESS', assigneeId: 'user-1', note: '' } })]), locale);
    expect(document.documentElement.dir).toBe('rtl');
    const html = container.innerHTML;
    expect(html).not.toMatch(/\b(?:ml|mr|pl|pr|left|right)-\d/);
    expect(html).not.toMatch(/\btext-(?:left|right)\b/);
    expect([...container.querySelectorAll('.whitespace-nowrap')].filter((el) => !el.classList.contains('s-btn'))).toEqual([]);
    expect(container.querySelector('[data-testid="expiry-lot"]')?.getAttribute('dir')).toBe('ltr');
    expect(container.querySelector('[data-testid="expiry-date"]')?.getAttribute('dir')).toBe('ltr');
    expect(text()).not.toContain('pharmacy.expiry');
  });

  it('touch targets: every control is at least 44px by class', () => {
    mount(list([row()]));
    for (const el of container.querySelectorAll('input:not([type="checkbox"]), select, button, summary')) {
      expect(el.className + (el.parentElement?.className ?? ''), el.outerHTML.slice(0, 80)).toMatch(/min-h-11/);
    }
  });

  it('en, ar and ckb have the same expiry keys with the same placeholders', () => {
    const keys = Object.keys(STUDIO_MESSAGES.en).filter((k) => k.startsWith('pharmacy.expiry.') || k === 'pharmacy.nav.expiry');
    expect(keys.length).toBeGreaterThan(50);
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
