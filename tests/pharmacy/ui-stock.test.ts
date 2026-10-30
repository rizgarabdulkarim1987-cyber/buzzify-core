// @vitest-environment jsdom
import { act, createElement, type ComponentProps, type ReactElement, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Locale } from '@/lib/locale';
import type { BatchView, MovementView, ProductBalance } from '@/server/pharmacy/stock-reads';
import { StudioI18nProvider } from '@/studio/i18n';
import { getStudioTranslator, STUDIO_MESSAGES } from '@/studio/messages';

/**
 * The stock screens (Phase 2, Task 9a) mounted in a browser-like document and used as a person would. The Server Actions
 * are stood in for. jsdom has no layout, so "no sideways scroll at 375 px" is checked as what causes it (no nowrap, no
 * fixed widths, wrapping rows); the real measurement is tests/e2e/pharmacy-stock.spec.ts, and axe runs there too.
 */

const router = vi.hoisted(() => ({ refresh: vi.fn(), push: vi.fn(), replace: vi.fn() }));
vi.mock('next/navigation', () => ({ useRouter: () => router }));
vi.mock('next/link', () => ({
  default: ({ href, children, ...rest }: { href: string; children: ReactNode }) => createElement('a', { href, ...rest }, children),
}));
vi.mock('@/studio/request-locale', () => ({ requestStudioLocale: async () => 'en' }));
const actions = vi.hoisted(() => ({
  stockBalances: vi.fn(),
  stockMovements: vi.fn(),
  adjustStock: vi.fn(),
  damageStock: vi.fn(),
  releaseQuarantine: vi.fn(),
  reverseMovement: vi.fn(),
}));
vi.mock('@/app/pharmacy/_actions/stock', () => actions);

const { StockList } = await import('@/app/pharmacy/_ui/StockList');
const { MovementList } = await import('@/app/pharmacy/_ui/MovementList');
const { BatchActions } = await import('@/app/pharmacy/_ui/BatchActions');
const { OfflineNotice } = await import('@/app/pharmacy/_ui/OfflineNotice');
const { StockBlocked } = await import('@/app/pharmacy/_ui/StockBlocked');
const { default: StockError } = await import('@/app/pharmacy/(app)/stock/error');
const { default: StockLoading } = await import('@/app/pharmacy/(app)/stock/loading');
const { default: MovementsLoading } = await import('@/app/pharmacy/(app)/stock/movements/loading');

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

function type(input: HTMLInputElement, value: string) {
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!;
  act(() => {
    setter.call(input, value);
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });
}

function choose(select: HTMLSelectElement, value: string) {
  const setter = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value')!.set!;
  act(() => {
    setter.call(select, value);
    select.dispatchEvent(new Event('change', { bubbles: true }));
  });
}

const field = (label: string) => {
  const found = [...document.querySelectorAll('label')].find((l) => l.textContent?.trim() === label);
  if (!found) throw new Error(`no field labelled ${label}`);
  return document.getElementById(found.htmlFor) as HTMLInputElement & HTMLSelectElement;
};
const button = (text: string) => [...document.querySelectorAll('button')].find((b) => b.textContent?.trim() === text) as HTMLButtonElement | undefined;
const text = () => container.textContent ?? '';

const TODAY = '2026-10-27';
const bucket = (over: Record<string, number | string> = {}) => ({ branchId: 'b1', available: 10, reserved: 0, quarantine: 0, damaged: 0, sellable: 10, ...over });

const batch = (over: Partial<BatchView> = {}): BatchView => ({
  batchId: 'bt1',
  lot: 'LOT-A1',
  expiryDate: '2027-03-31',
  expiryPrecision: 'MONTH',
  status: 'ACTIVE',
  expired: false,
  buckets: [bucket()],
  ...over,
});

const product = (over: Partial<ProductBalance> = {}): ProductBalance => ({
  productId: 'p1',
  tradeName: 'Panadol',
  strength: '500 mg',
  form: 'tablet',
  active: true,
  branches: [{ ...bucket(), minQty: 0 }],
  batches: [batch()],
  ...over,
});

const listProps = (over: Record<string, unknown> = {}) => ({
  items: [product()],
  t: en,
  locale: 'en' as Locale,
  today: TODAY,
  branchNames: { b1: 'Main street', b2: 'Airport road' },
  showCost: false,
  adjustBranchId: 'b1' as string | null,
  ...over,
});

const MOVE = (over: Partial<MovementView> = {}): MovementView => ({
  id: 'm1',
  type: 'ADJUST',
  branchId: 'b1',
  productId: 'p1',
  batchId: 'bt1',
  lot: 'LOT-A1',
  availableDelta: 5,
  reservedDelta: 0,
  quarantineDelta: 0,
  damagedDelta: 0,
  reason: 'Counted twice',
  userId: 'user-12345678-abcd',
  reversesId: null,
  receiptId: null,
  countId: null,
  createdAt: '2026-10-26T10:15:00.000Z',
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

describe('the stock list', () => {
  it('shows per-branch totals, and batches in the order the server gave (first to expire first)', () => {
    const items = [
      product({
        branches: [{ ...bucket({ available: 14, quarantine: 3, sellable: 8 }), minQty: 20 }],
        batches: [
          batch({ batchId: 'x', lot: 'FIRST', expiryDate: '2026-11-15', expiryPrecision: 'DAY' }),
          batch({ batchId: 'y', lot: 'SECOND', expiryDate: '2027-03-31', expiryPrecision: 'MONTH' }),
        ],
      }),
    ];
    mount(createElement(StockList, listProps({ items })));
    const row = container.querySelector('[data-testid="stock-row"]')!;
    for (const label of ['available', 'sellable', 'reserved', 'quarantine', 'damaged', 'min']) {
      expect(row.textContent).toContain(en(`pharmacy.stock.col.${label}`));
    }
    expect(row.textContent).toContain('Panadol');
    expect(row.textContent).toContain('500 mg · tablet');
    // Low: sellable 8 is under the minimum 20, said in words.
    expect(row.querySelector('[data-chip="low"]')?.textContent).toBe(en('pharmacy.stock.lowBadge'));
    const lots = [...container.querySelectorAll('[data-testid="batch-lot"]')].map((el) => el.textContent);
    expect(lots).toEqual(['FIRST', 'SECOND']);
    const expiries = [...container.querySelectorAll('[data-testid="batch-expiry"]')].map((el) => el.textContent!.replace(/[⁦⁩]/g, ''));
    expect(expiries).toEqual(['15/11/2026', '03/2027']);
  });

  it('reads lot and expiry left to right, and uses native details with no animation', () => {
    mount(createElement(StockList, listProps()));
    expect(container.querySelector('[data-testid="batch-lot"]')!.getAttribute('dir')).toBe('ltr');
    expect(container.querySelector('[data-testid="batch-expiry"]')!.getAttribute('dir')).toBe('ltr');
    expect(container.querySelector('details[data-testid="stock-batches"]')).toBeTruthy();
    // The shared Button and Field classes carry transition utilities that [data-motion='none'] switches off for the whole
    // pharmacy document; what the pharmacy folder owns is held to no motion by tests/pharmacy/ui-no-motion.test.ts.
    expect(container.querySelector('[data-testid="stock-batches"] summary')).toBeTruthy();
  });

  it('names every condition of a batch with an icon and a word', () => {
    const batches = [
      batch({ batchId: 'e', lot: 'E', expired: true, expiryDate: '2026-09-30', expiryPrecision: 'DAY' }),
      batch({ batchId: 's', lot: 'S', expiryDate: '2026-11-15', expiryPrecision: 'DAY' }),
      batch({ batchId: 'r', lot: 'R', status: 'RECALLED' }),
      batch({ batchId: 'b', lot: 'B', status: 'BLOCKED' }),
      batch({ batchId: 'q', lot: 'Q', buckets: [bucket({ available: 0, quarantine: 4, sellable: 0 })] }),
    ];
    mount(createElement(StockList, listProps({ items: [product({ batches })] })));
    const expected: Record<string, string> = {
      expired: 'pharmacy.stock.status.expired',
      expiringSoon: 'pharmacy.stock.status.expiringSoon',
      recalled: 'pharmacy.stock.status.recalled',
      blocked: 'pharmacy.stock.status.blocked',
      quarantine: 'pharmacy.stock.status.quarantine',
    };
    for (const [kind, key] of Object.entries(expected)) {
      const chip = container.querySelector(`[data-chip="${kind}"]`);
      expect(chip, kind).toBeTruthy();
      expect(chip!.textContent).toBe(en(key));
      expect(chip!.querySelector('svg')).toBeTruthy();
    }
  });

  it('shows cost only when the payload carries it', () => {
    const costed = batch({ unitCostMinor: '1250', currency: 'IQD', costUnitId: 'u1' });
    mount(createElement(StockList, listProps({ items: [product({ batches: [costed] })], showCost: true })));
    expect(container.querySelector('[data-cost]')!.textContent).toContain('1,250');
    act(() => root.unmount());
    root = createRoot(container);
    mount(createElement(StockList, listProps({ items: [product({ batches: [costed] })], showCost: false })));
    expect(container.querySelector('[data-cost]')).toBeNull();
    expect(text()).not.toContain(en('pharmacy.stock.batch.cost'));
    // A role without cost.view gets no cost keys at all.
    act(() => root.unmount());
    root = createRoot(container);
    mount(createElement(StockList, listProps({ showCost: true })));
    expect(container.querySelector('[data-cost]')).toBeNull();
  });

  it('draws no change control without a branch to change, and names the branch when several are shown', () => {
    const two = product({
      branches: [
        { ...bucket(), minQty: 0 },
        { ...bucket({ branchId: 'b2', available: 2, sellable: 2 }), minQty: 0 },
      ],
      batches: [batch({ buckets: [bucket(), bucket({ branchId: 'b2', available: 2, sellable: 2 })] })],
    });
    mount(createElement(StockList, listProps({ items: [two], adjustBranchId: null })));
    expect(container.querySelector('[data-testid="batch-actions"]')).toBeNull();
    expect(text()).toContain('Main street');
    expect(text()).toContain('Airport road');
  });

  it('renders right to left in Arabic and Sorani with logical CSS only, and says the words in that language', () => {
    for (const locale of ['ar', 'ckb'] as const) {
      act(() => root.unmount());
      root = createRoot(container);
      const t = getStudioTranslator(locale);
      mount(createElement(StockList, listProps({ t, locale, items: [product({ batches: [batch({ expired: true, expiryDate: '2026-09-30', expiryPrecision: 'DAY' })] })] })), locale);
      expect(document.documentElement.dir).toBe('rtl');
      expect(text()).toContain(t('pharmacy.stock.col.available'));
      expect(text()).toContain(t('pharmacy.stock.status.expired'));
      expect(text()).not.toContain(en('pharmacy.stock.col.available'));
      expect(container.innerHTML).not.toMatch(/class="[^"]*\b(?:ml|mr|pl|pr|left|right|text-left|text-right|rounded-l|rounded-r|border-l|border-r)-/);
      // Lot and date stay left to right inside the right-to-left sentence.
      expect(container.querySelector('[data-testid="batch-lot"]')!.getAttribute('dir')).toBe('ltr');
    }
  });

  it('cannot scroll sideways at 375px: no nowrap, no fixed widths, rows that wrap', () => {
    const longName = 'Paracetamol باراسيتامول پاراسێتامۆڵ 500 mg '.repeat(4).slice(0, 120);
    mount(createElement(StockList, listProps({ items: [product({ tradeName: longName })] })));
    // Buttons keep the shared nowrap (their labels are one or two words); everything else must be free to wrap.
    for (const el of container.querySelectorAll('*:not(button)')) {
      expect(el.getAttribute('class') ?? '').not.toMatch(/\b(whitespace-nowrap|truncate|overflow-x-scroll|overflow-x-auto|min-w-\[|w-\[\d+px\])/);
    }
    const name = [...container.querySelectorAll('span[dir="auto"]')].find((el) => el.textContent === longName)!;
    expect(name.className).toMatch(/\bbreak-words\b/);
    expect(container.querySelectorAll('dl.flex-wrap').length).toBeGreaterThan(0);
  });

  it('gives every interactive control a name and a touch target of at least 44px', () => {
    mount(createElement(StockList, listProps()));
    for (const el of container.querySelectorAll('summary, a')) {
      expect((el.textContent ?? '').trim(), el.outerHTML).not.toBe('');
      expect(el.className).toMatch(/\bmin-h-11\b/);
    }
    for (const svg of container.querySelectorAll('svg')) expect(svg.getAttribute('aria-hidden')).toBe('true');
  });
});

describe('changing stock on a batch', () => {
  const open = () => mount(createElement(BatchActions, { batchId: 'bt1', lot: 'LOT-A1' }));

  it('moves stock between buckets with a reason and an idempotency key, then refreshes', async () => {
    actions.adjustStock.mockResolvedValue({ ok: true, data: { id: 'm9', replayed: false, reversed: false } });
    open();
    choose(field(en('pharmacy.stock.act.op')), 'move');
    choose(field(en('pharmacy.stock.act.from')), 'available');
    choose(field(en('pharmacy.stock.act.to')), 'quarantine');
    type(field(en('pharmacy.stock.act.qty')), '4');
    type(field(en('pharmacy.stock.act.reason')), 'Suspect packaging');
    await click(button(en('pharmacy.stock.act.save'))!);
    await settle();
    expect(actions.adjustStock).toHaveBeenCalledTimes(1);
    const sent = actions.adjustStock.mock.calls[0]![0];
    expect(sent).toMatchObject({ batchId: 'bt1', direction: 'move', bucketFrom: 'available', bucketTo: 'quarantine', baseQty: 4, reason: 'Suspect packaging' });
    expect(String(sent.clientKey).length).toBeGreaterThanOrEqual(8);
    // The browser never names the business or the branch.
    expect(sent).not.toHaveProperty('restaurantId');
    expect(sent).not.toHaveProperty('branchId');
    expect(router.refresh).toHaveBeenCalled();
    expect(container.querySelector('[data-testid="batch-action-done"]')!.textContent).toContain(en('pharmacy.stock.act.done'));
  });

  it('asks a second time before taking stock out, and sends nothing on the first click', async () => {
    actions.adjustStock.mockResolvedValue({ ok: true, data: { id: 'm9', replayed: false, reversed: false } });
    open();
    choose(field(en('pharmacy.stock.act.op')), 'out');
    type(field(en('pharmacy.stock.act.qty')), '2');
    type(field(en('pharmacy.stock.act.reason')), 'Broken box');
    await click(button(en('pharmacy.stock.act.review'))!);
    expect(actions.adjustStock).not.toHaveBeenCalled();
    expect(text()).toContain(en('pharmacy.stock.act.confirmText'));
    expect(container.querySelector('[role="alert"] svg')).toBeTruthy();
    await click(button(en('pharmacy.stock.act.confirm'))!);
    await settle();
    expect(actions.adjustStock).toHaveBeenCalledTimes(1);
    expect(actions.adjustStock.mock.calls[0]![0]).toMatchObject({ direction: 'out', bucketFrom: 'available', baseQty: 2 });
  });

  it('cancelling the confirmation sends nothing', async () => {
    open();
    choose(field(en('pharmacy.stock.act.op')), 'damage');
    type(field(en('pharmacy.stock.act.qty')), '1');
    type(field(en('pharmacy.stock.act.reason')), 'Dropped');
    await click(button(en('pharmacy.stock.act.review'))!);
    await click(button(en('pharmacy.stock.act.cancel'))!);
    expect(actions.damageStock).not.toHaveBeenCalled();
    expect(text()).not.toContain(en('pharmacy.stock.act.confirmText'));
  });

  it('writes off as damaged and releases from quarantine through their own actions', async () => {
    actions.damageStock.mockResolvedValue({ ok: true, data: { id: 'm1', replayed: false, reversed: false } });
    actions.releaseQuarantine.mockResolvedValue({ ok: true, data: { id: 'm2', replayed: false, reversed: false } });
    open();
    choose(field(en('pharmacy.stock.act.op')), 'damage');
    type(field(en('pharmacy.stock.act.qty')), '3');
    type(field(en('pharmacy.stock.act.reason')), 'Water damage');
    await click(button(en('pharmacy.stock.act.review'))!);
    await click(button(en('pharmacy.stock.act.confirm'))!);
    await settle();
    expect(actions.damageStock.mock.calls[0]![0]).toMatchObject({ batchId: 'bt1', fromBucket: 'available', baseQty: 3 });

    choose(field(en('pharmacy.stock.act.op')), 'release');
    expect(field(en('pharmacy.stock.act.decision')).value).toBe('RESTOCK');
    type(field(en('pharmacy.stock.act.qty')), '1');
    type(field(en('pharmacy.stock.act.reason')), 'Checked and fine');
    await click(button(en('pharmacy.stock.act.save'))!);
    await settle();
    expect(actions.releaseQuarantine.mock.calls[0]![0]).toMatchObject({ batchId: 'bt1', decision: 'RESTOCK', baseQty: 1 });
  });

  it('shows the server refusal inline in the person language, with an icon, and keeps what was typed', async () => {
    actions.adjustStock.mockResolvedValue({ ok: false, error: { code: 'CONFLICT', message: 'This batch is expired: it cannot go back on sale' } });
    open();
    type(field(en('pharmacy.stock.act.qty')), '4');
    type(field(en('pharmacy.stock.act.reason')), 'Found more');
    await click(button(en('pharmacy.stock.act.save'))!);
    await settle();
    const alert = container.querySelector('[data-testid="batch-action-error"]')!;
    expect(alert.textContent).toContain('This batch is expired');
    expect(alert.querySelector('svg')).toBeTruthy();
    expect(field(en('pharmacy.stock.act.qty')).value).toBe('4');
    expect(router.refresh).not.toHaveBeenCalled();
  });

  it('puts a field problem under its field', async () => {
    actions.adjustStock.mockResolvedValue({ ok: false, error: { code: 'INVALID', message: 'Check the highlighted fields', fields: { reason: 'Use at least 3 characters' } } });
    open();
    type(field(en('pharmacy.stock.act.qty')), '1');
    type(field(en('pharmacy.stock.act.reason')), 'ab');
    await click(button(en('pharmacy.stock.act.save'))!);
    await settle();
    expect(field(en('pharmacy.stock.act.reason')).getAttribute('aria-invalid')).toBe('true');
  });

  it('says a replayed change was already saved', async () => {
    actions.adjustStock.mockResolvedValue({ ok: true, data: { id: 'm9', replayed: true, reversed: false } });
    open();
    type(field(en('pharmacy.stock.act.qty')), '4');
    type(field(en('pharmacy.stock.act.reason')), 'Found more');
    await click(button(en('pharmacy.stock.act.save'))!);
    await settle();
    expect(text()).toContain(en('pharmacy.stock.act.replayed'));
  });

  it('does not send while offline, and says so', async () => {
    Object.defineProperty(navigator, 'onLine', { value: false, configurable: true });
    open();
    act(() => {
      window.dispatchEvent(new Event('offline'));
    });
    type(field(en('pharmacy.stock.act.qty')), '4');
    type(field(en('pharmacy.stock.act.reason')), 'Found more');
    expect(button(en('pharmacy.stock.act.save'))!.disabled).toBe(true);
    expect(actions.adjustStock).not.toHaveBeenCalled();
  });
});

describe('the movement list', () => {
  it('shows type with icon and word, signed deltas, lot, who as a short id and when', () => {
    mount(createElement(MovementList, { items: [MOVE({ type: 'DAMAGE', availableDelta: -3, damagedDelta: 3 })], t: en, reverseBranchId: null }));
    const row = container.querySelector('[data-testid="movement-row"]')!;
    expect(row.textContent).toContain(en('pharmacy.movements.type.DAMAGE'));
    expect(row.querySelector('svg')).toBeTruthy();
    expect([...row.querySelectorAll('[data-testid="movement-delta"]')].map((el) => el.textContent)).toEqual(['−3', '+3']);
    expect(row.querySelector('[data-testid="movement-who"]')!.textContent).toBe('user-123');
    expect(row.textContent).toContain('Counted twice');
    expect(row.textContent).toContain('LOT-A1');
    expect(row.textContent).toContain('26/10/2026');
    expect(row.querySelector('[data-testid="reverse-movement"]')).toBeNull();
  });

  it('offers reverse only for reversible kinds in the chosen branch, never on a reversal or an already reversed line', () => {
    const items = [
      MOVE({ id: 'a', type: 'ADJUST' }),
      MOVE({ id: 'b', type: 'SALE' }),
      MOVE({ id: 'c', type: 'ADJUST', branchId: 'b2' }),
      MOVE({ id: 'd', type: 'ADJUST', reversesId: 'e' }),
      MOVE({ id: 'e', type: 'DAMAGE' }),
    ];
    mount(createElement(MovementList, { items, t: en, reverseBranchId: 'b1' }));
    const rows = [...container.querySelectorAll('[data-testid="movement-row"]')];
    expect(rows.map((r) => !!r.querySelector('[data-testid="reverse-movement"]'))).toEqual([true, false, false, false, false]);
    // The reversal says it reverses an earlier line; the original says it was reversed. Both with icon and word.
    expect(rows[3]!.querySelector('[data-chip="reversal"]')!.textContent).toBe(en('pharmacy.movements.reversal'));
    expect(rows[3]!.querySelector('[data-chip="reversal"] svg')).toBeTruthy();
    expect(rows[4]!.querySelector('[data-chip="reversed"]')!.textContent).toBe(en('pharmacy.movements.reversed'));
  });

  it('reverses with a reason and shows the server refusal inline', async () => {
    actions.reverseMovement.mockResolvedValueOnce({ ok: false, error: { code: 'CONFLICT', message: 'This kind of movement cannot be reversed here' } });
    actions.reverseMovement.mockResolvedValueOnce({ ok: true, data: { id: 'r1', reversesId: 'a' } });
    mount(createElement(MovementList, { items: [MOVE({ id: 'a' })], t: en, reverseBranchId: 'b1' }));
    type(field(en('pharmacy.movements.reverse.reason')), 'Entered twice');
    await click(button(en('pharmacy.movements.reverse.confirm'))!);
    await settle();
    expect(actions.reverseMovement).toHaveBeenCalledWith({ movementId: 'a', reason: 'Entered twice' });
    expect(container.querySelector('[data-testid="reverse-error"]')!.textContent).toContain('cannot be reversed here');
    expect(container.querySelector('[data-testid="reverse-error"] svg')).toBeTruthy();
    await click(button(en('pharmacy.movements.reverse.confirm'))!);
    await settle();
    expect(text()).toContain(en('pharmacy.movements.reverse.done'));
    expect(router.refresh).toHaveBeenCalled();
  });

  it('is right to left in Arabic and Sorani with the type named in that language', () => {
    for (const locale of ['ar', 'ckb'] as const) {
      act(() => root.unmount());
      root = createRoot(container);
      const t = getStudioTranslator(locale);
      mount(createElement(MovementList, { items: [MOVE()], t, reverseBranchId: 'b1' }), locale);
      expect(text()).toContain(t('pharmacy.movements.type.ADJUST'));
      expect(container.innerHTML).not.toMatch(/class="[^"]*\b(?:ml|mr|pl|pr|left|right|text-left|text-right)-/);
      expect(container.querySelector('[data-testid="movement-delta"]')!.getAttribute('dir')).toBe('ltr');
    }
  });
});

describe('states carry text and an icon', () => {
  it('offline', () => {
    Object.defineProperty(navigator, 'onLine', { value: false, configurable: true });
    mount(createElement(OfflineNotice));
    act(() => {
      window.dispatchEvent(new Event('offline'));
    });
    const notice = container.querySelector('[data-testid="stock-offline"]')!;
    expect(notice.textContent).toBe(en('pharmacy.stock.offline'));
    expect(notice.querySelector('svg')).toBeTruthy();
  });

  it('online shows nothing', () => {
    mount(createElement(OfflineNotice));
    expect(container.querySelector('[data-testid="stock-offline"]')).toBeNull();
  });

  it.each(['readOnly', 'role', 'support'] as const)('read-only reason %s', (reason) => {
    mount(createElement(StockBlocked, { reason, t: en }));
    const notice = container.querySelector('[data-testid="stock-write-blocked"]')!;
    expect(notice.textContent).toBe(en(`pharmacy.stock.blocked.${reason}`));
    expect(notice.querySelector('svg')).toBeTruthy();
  });

  it('failed to load, with a way to try again', async () => {
    const reset = vi.fn();
    mount(createElement(StockError, { error: new Error('boom'), reset }));
    const alert = container.querySelector('[role="alert"]')!;
    expect(alert.textContent).toContain(en('pharmacy.stock.loadFailed'));
    expect(alert.textContent).toContain(en('pharmacy.stock.loadFailedBody'));
    expect(alert.querySelectorAll('svg').length).toBeGreaterThanOrEqual(2);
    await click(button(en('pharmacy.stock.retry'))!);
    expect(reset).toHaveBeenCalled();
  });

  it('loading', async () => {
    mount(await StockLoading());
    expect(container.querySelector('[role="status"]')!.textContent).toBe(en('pharmacy.stock.loading'));
    expect(container.querySelector('[role="status"] svg')).toBeTruthy();
    act(() => root.unmount());
    root = createRoot(container);
    mount(await MovementsLoading());
    expect(container.querySelector('[role="status"]')!.textContent).toBe(en('pharmacy.movements.loading'));
  });
});

describe('the stock messages', () => {
  const placeholders = (s: string) => [...s.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort();
  const mine = (key: string) => key.startsWith('pharmacy.stock.') || key.startsWith('pharmacy.movements.') || key === 'pharmacy.nav.stock' || key === 'pharmacy.nav.movements';
  const keys = Object.keys(STUDIO_MESSAGES.en).filter(mine);

  it('has every key in English, Arabic and Sorani with the same placeholders and no empty text', () => {
    expect(keys.length).toBeGreaterThan(100);
    for (const locale of ['ar', 'ckb'] as const) {
      for (const key of keys) {
        const value = STUDIO_MESSAGES[locale][key];
        expect(value, `${locale} ${key}`).toBeTruthy();
        expect(placeholders(value!), `${locale} ${key}`).toEqual(placeholders(STUDIO_MESSAGES.en[key]!));
      }
      const extra = Object.keys(STUDIO_MESSAGES[locale]).filter(mine).filter((key) => !(key in STUDIO_MESSAGES.en));
      expect(extra).toEqual([]);
    }
  });

  it('has a label for every bucket, status, decision, operation and movement type the screens can show', () => {
    const wanted = [
      ...['available', 'reserved', 'quarantine', 'damaged'].map((b) => `pharmacy.stock.bucket.${b}`),
      ...['expired', 'expiringSoon', 'recalled', 'blocked', 'quarantine', 'ok'].map((s) => `pharmacy.stock.status.${s}`),
      ...['RESTOCK', 'DAMAGE'].map((d) => `pharmacy.stock.act.decision.${d}`),
      ...['in', 'out', 'move', 'damage', 'release'].map((o) => `pharmacy.stock.act.op.${o}`),
      ...['RECEIPT', 'SALE', 'RETURN_IN', 'RETURN_QUARANTINE', 'ADJUST', 'DAMAGE', 'TRANSFER_OUT', 'TRANSFER_IN', 'SUPPLIER_RETURN', 'COUNT', 'QUARANTINE_RELEASE'].map((m) => `pharmacy.movements.type.${m}`),
    ];
    for (const locale of ['en', 'ar', 'ckb'] as const) for (const key of wanted) expect(STUDIO_MESSAGES[locale][key], `${locale} ${key}`).toBeTruthy();
  });
});
