// @vitest-environment jsdom
import { IDBFactory } from 'fake-indexeddb';
import { act, createElement, type ComponentProps, type ReactElement, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Locale } from '@/lib/locale';
import { StudioI18nProvider } from '@/studio/i18n';
import { getStudioTranslator, STUDIO_MESSAGES } from '@/studio/messages';

/**
 * The catalog screens (Task 24) mounted in a browser-like document and used as a person would. The Server Actions are
 * stood in for; drafts go to a fake IndexedDB, as they would to the browser's.
 */

const router = vi.hoisted(() => ({ refresh: vi.fn(), push: vi.fn(), replace: vi.fn() }));
vi.mock('next/navigation', () => ({ useRouter: () => router }));
vi.mock('next/link', () => ({
  default: ({ href, children, ...rest }: { href: string; children: ReactNode }) => createElement('a', { href, ...rest }, children),
}));
const actions = vi.hoisted(() => ({
  searchProducts: vi.fn(),
  listProducts: vi.fn(),
  createProduct: vi.fn(),
  updateProduct: vi.fn(),
  archiveProduct: vi.fn(),
  setPrice: vi.fn(),
  priceHistory: vi.fn(),
  applyImport: vi.fn(),
}));
vi.mock('@/app/pharmacy/_actions/catalog', () => actions);

const { ProductEditor } = await import('@/app/pharmacy/_ui/ProductEditor');
const { ProductSearch } = await import('@/app/pharmacy/_ui/ProductSearch');
const { ImportWizard } = await import('@/app/pharmacy/_ui/ImportWizard');
const { DRAFT_DB, DRAFT_STORE } = await import('@/lib/use-draft');

const en = getStudioTranslator('en');
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let container: HTMLElement;
let root: Root;

function mount(element: ReactElement, locale: Locale = 'en') {
  const props = { locale, messages: STUDIO_MESSAGES[locale] } as ComponentProps<typeof StudioI18nProvider>;
  act(() => root.render(createElement(StudioI18nProvider, props, element)));
}

/** Lets IndexedDB and the effects waiting on it finish. */
const settle = () =>
  act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 30));
  });

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

const field = (label: string) => {
  const found = [...document.querySelectorAll('label')].find((l) => l.textContent?.replace(/\(.*\)/, '').trim() === label);
  if (!found) throw new Error(`no field labelled ${label}`);
  return document.getElementById(found.htmlFor) as HTMLInputElement;
};
const button = (text: string) => [...document.querySelectorAll('button')].find((b) => b.textContent?.trim() === text);
const text = () => container.textContent ?? '';

const LADDER = [
  { id: 'u0', level: 0, label: 'tablet', baseQty: 1, sellable: true },
  { id: 'u1', level: 1, label: 'strip', baseQty: 10, sellable: true },
  { id: 'u2', level: 2, label: 'box', baseQty: 30, sellable: true },
];

const PRODUCT = {
  id: 'p1',
  tradeName: 'Panadol',
  genericName: 'باراسيتامول',
  activeIngredient: 'paracetamol',
  strength: '500 mg',
  form: 'tablet',
  manufacturer: 'GSK',
  rxLevel: 'OTC' as const,
  active: true,
  version: 3,
  packLabel: '30 box',
  units: LADDER,
  categoryId: null,
  requiresCold: false,
  storageNote: '',
  shelfLocation: '',
  imageAssetId: null,
  barcodes: [{ code: '6291234567894', level: 2, shared: false }],
  branchSettings: [],
};

const editorProps = (over: Record<string, unknown> = {}) => ({
  userId: 'user-1',
  product: PRODUCT,
  branches: [{ id: 'b1', name: 'Main street' }],
  categories: [],
  currencies: ['IQD' as const],
  history: [],
  writable: { ok: true as const },
  canChangePrice: true,
  ...over,
});

beforeEach(() => {
  vi.clearAllMocks();
  globalThis.indexedDB = new IDBFactory();
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  document.body.innerHTML = '';
});

describe('the product editor', () => {
  it('the editor shows an unsaved-changes badge after an edit and clears it after save', async () => {
    actions.updateProduct.mockResolvedValue({ ok: true, data: { id: 'p1', version: 4 } });
    mount(createElement(ProductEditor, editorProps()));
    await settle();
    expect(text()).not.toContain(en('pharmacy.catalog.unsaved'));

    type(field(en('pharmacy.catalog.field.tradeName')), 'Panadol Extra');
    expect(text()).toContain(en('pharmacy.catalog.unsaved'));

    await click(button(en('pharmacy.catalog.save'))!);
    await settle();
    expect(actions.updateProduct).toHaveBeenCalledTimes(1);
    expect(actions.updateProduct.mock.calls[0]![0]).toMatchObject({ productId: 'p1', expectedVersion: 3, tradeName: 'Panadol Extra' });
    // The client never names the business: the Server Action fills it in.
    expect(actions.updateProduct.mock.calls[0]![0]).not.toHaveProperty('restaurantId');
    expect(text()).not.toContain(en('pharmacy.catalog.unsaved'));
    expect(text()).toContain(en('pharmacy.catalog.saved'));
  });

  it('a restored draft offers restore or discard', async () => {
    mount(createElement(ProductEditor, editorProps()));
    await settle();
    type(field(en('pharmacy.catalog.field.tradeName')), 'Panadol Night');
    await settle();
    act(() => root.unmount());

    root = createRoot(container);
    mount(createElement(ProductEditor, editorProps()));
    await settle();
    expect(text()).toContain(en('pharmacy.catalog.draft.restored'));
    expect(field(en('pharmacy.catalog.field.tradeName')).value).toBe('Panadol Night');
    expect(button(en('pharmacy.catalog.draft.keep'))).toBeTruthy();

    await click(button(en('pharmacy.catalog.draft.discard'))!);
    await settle();
    expect(field(en('pharmacy.catalog.field.tradeName')).value).toBe('Panadol');
    expect(text()).not.toContain(en('pharmacy.catalog.draft.restored'));
    expect(text()).not.toContain(en('pharmacy.catalog.unsaved'));
  });

  it('leaving with unsaved changes warns', async () => {
    mount(createElement(ProductEditor, editorProps()));
    await settle();
    const leave = () => {
      const event = new Event('beforeunload', { cancelable: true });
      window.dispatchEvent(event);
      return event.defaultPrevented;
    };
    expect(leave()).toBe(false);

    type(field(en('pharmacy.catalog.field.tradeName')), 'Panadol Extra');
    expect(leave()).toBe(true);

    // The way back to the list asks first, and stays when the person says no.
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false);
    const back = [...container.querySelectorAll('a')].find((a) => a.textContent?.includes(en('pharmacy.catalog.back')))!;
    const click = new MouseEvent('click', { bubbles: true, cancelable: true });
    act(() => {
      back.dispatchEvent(click);
    });
    expect(confirm).toHaveBeenCalledWith(en('pharmacy.catalog.leaveConfirm'));
    expect(click.defaultPrevented).toBe(true);
  });

  it('a read-only pharmacy renders no save buttons and says why', async () => {
    mount(createElement(ProductEditor, editorProps({ writable: { ok: false, reason: 'readOnly', until: '2026-12-01T09:00:00.000Z' }, canChangePrice: false })));
    await settle();
    expect(button(en('pharmacy.catalog.save'))).toBeUndefined();
    expect(button(en('pharmacy.catalog.archive'))).toBeUndefined();
    expect(button(en('pharmacy.price.save'))).toBeUndefined();
    const notice = container.querySelector('[data-testid="catalog-write-blocked"]');
    expect(notice?.textContent).toContain(STUDIO_MESSAGES.en['pharmacy.catalog.blocked.readOnly']!.split('{')[0]!.trim());
    expect(notice?.querySelector('svg')).toBeTruthy();
    // Disabled through its fieldset, which is what a browser and assistive technology read.
    expect(field(en('pharmacy.catalog.field.tradeName')).matches(':disabled')).toBe(true);

    // A role that may only look says so too.
    act(() => root.unmount());
    root = createRoot(container);
    mount(createElement(ProductEditor, editorProps({ writable: { ok: false, reason: 'role' }, canChangePrice: false })));
    await settle();
    expect(button(en('pharmacy.catalog.save'))).toBeUndefined();
    expect(text()).toContain(en('pharmacy.catalog.blocked.role'));
  });

  it('the barcode field keeps 0012345678905 as typed', async () => {
    actions.updateProduct.mockResolvedValue({ ok: true, data: { id: 'p1', version: 4 } });
    mount(createElement(ProductEditor, editorProps()));
    await settle();
    const scan = field(en('pharmacy.catalog.barcode.scan'));
    type(scan, '0012345678905');
    await click(button(en('pharmacy.catalog.barcode.add'))!);
    expect(text()).toContain('0012345678905');
    // Arabic-Indic digits from a scanner are the same code in Latin digits, zeros kept.
    type(field(en('pharmacy.catalog.barcode.scan')), '٠٠٧٧');
    await click(button(en('pharmacy.catalog.barcode.add'))!);
    expect(text()).toContain('0077');

    await click(button(en('pharmacy.catalog.save'))!);
    const sent = actions.updateProduct.mock.calls[0]![0] as { barcodes: { code: string }[] };
    expect(sent.barcodes.map((b) => b.code)).toEqual(['6291234567894', '0012345678905', '0077']);
  });

  it('keeps the draft in IndexedDB under the person, screen and product, without the scan buffer', async () => {
    mount(createElement(ProductEditor, editorProps()));
    await settle();
    type(field(en('pharmacy.catalog.field.tradeName')), 'Panadol Cold');
    type(field(en('pharmacy.catalog.barcode.scan')), '99887766');
    await settle();

    const stored = await new Promise<{ key: IDBValidKey; value: unknown }[]>((resolve, reject) => {
      const open = indexedDB.open(DRAFT_DB);
      open.onerror = () => reject(open.error);
      open.onsuccess = () => {
        const store = open.result.transaction(DRAFT_STORE, 'readonly').objectStore(DRAFT_STORE);
        const keys = store.getAllKeys();
        const values = store.getAll();
        values.onsuccess = () => resolve(keys.result.map((key, i) => ({ key, value: values.result[i] })));
      };
    });
    expect(stored.map((s) => s.key)).toEqual(['user-1:product:p1']);
    expect(JSON.stringify(stored[0]!.value)).toContain('Panadol Cold');
    expect(JSON.stringify(stored[0]!.value)).not.toContain('99887766');
  });

  it('works without IndexedDB', async () => {
    // A private window or a browser that refuses storage.
    delete (globalThis as { indexedDB?: unknown }).indexedDB;
    mount(createElement(ProductEditor, editorProps()));
    await settle();
    type(field(en('pharmacy.catalog.field.tradeName')), 'Panadol Extra');
    await settle();
    expect(text()).toContain(en('pharmacy.catalog.unsaved'));
  });

  it('explains a barcode held by an archived product and offers to share it', async () => {
    actions.updateProduct.mockResolvedValue({
      ok: false,
      error: {
        code: 'CONFLICT',
        message: 'This barcode is already on another product. Mark it as shared to use it on both.',
        fields: { phCode: 'BARCODE_IN_USE', productId: 'old', productName: 'Old Panadol', productArchived: 'true', 'barcodes.0.code': 'x' },
      },
    });
    mount(createElement(ProductEditor, editorProps()));
    await settle();
    type(field(en('pharmacy.catalog.field.tradeName')), 'Panadol Extra');
    await click(button(en('pharmacy.catalog.save'))!);
    await settle();
    expect(text()).toContain(en('pharmacy.catalog.barcode.heldArchived', { name: '⁨Old Panadol⁩' }));
    expect(container.querySelector('a[href="/pharmacy/catalog/old"]')).toBeTruthy();
    expect(button(en('pharmacy.catalog.barcode.share'))).toBeTruthy();
  });
});

const ITEM = (over: Record<string, unknown> = {}) => ({
  id: 'p1',
  tradeName: 'Panadol',
  genericName: '',
  activeIngredient: '',
  strength: '500 mg',
  form: 'tablet',
  manufacturer: 'GSK',
  rxLevel: 'OTC' as const,
  active: true,
  version: 1,
  packLabel: '30 box',
  units: LADDER,
  ...over,
});

const searchProps = (over: Record<string, unknown> = {}) => ({
  initial: { items: [ITEM()], nextCursor: null },
  showCost: false,
  canManage: true,
  canImport: true,
  ...over,
});

describe('the catalog list', () => {
  it('an empty catalog shows the empty state with the import and add actions', () => {
    mount(createElement(ProductSearch, searchProps({ initial: { items: [], nextCursor: null } })));
    expect(text()).toContain(en('pharmacy.catalog.empty.title'));
    // The actions sit in the empty state, once each (not again above it).
    expect(container.querySelector('[data-testid="catalog-empty"] a[href="/pharmacy/catalog/new"]')?.textContent).toContain(en('pharmacy.catalog.add'));
    expect(container.querySelector('[data-testid="catalog-empty"] a[href="/pharmacy/catalog/import"]')?.textContent).toContain(en('pharmacy.catalog.import'));
    expect(container.querySelectorAll('a[href="/pharmacy/catalog/new"]')).toHaveLength(1);
    expect(container.querySelectorAll('a[href="/pharmacy/catalog/import"]')).toHaveLength(1);
    expect(container.querySelector('[data-testid="catalog-empty"] svg')).toBeTruthy();
  });

  it('a 120-character mixed-script name wraps and is not clipped at 375px', () => {
    const name = 'Paracetamol باراسيتامول پاراسێتامۆڵ 500 mg '.repeat(4).slice(0, 120);
    expect(name).toHaveLength(120);
    mount(createElement(ProductSearch, searchProps({ initial: { items: [ITEM({ tradeName: name })], nextCursor: null } })));
    const shown = [...container.querySelectorAll('[data-testid="product-name"]')].find((el) => el.textContent === name);
    expect(shown).toBeTruthy();
    // It may break anywhere and is never cut: no ellipsis, no single line, no hidden overflow on it or around it.
    expect(shown!.className).toMatch(/\bbreak-words\b/);
    for (let el: Element | null = shown!; el && el !== container; el = el.parentElement) {
      expect(el.className).not.toMatch(/\b(truncate|whitespace-nowrap|overflow-hidden|line-clamp-\d)\b/);
    }
    expect(shown!.getAttribute('dir')).toBe('auto');
  });

  it('cost is not in the DOM for a cashier', () => {
    mount(createElement(ProductSearch, searchProps({ showCost: false, canManage: false, canImport: false })));
    expect(container.querySelector('[data-cost]')).toBeNull();
    expect(text()).not.toContain(en('pharmacy.catalog.cost'));
    expect(container.querySelector('a[href="/pharmacy/catalog/new"]')).toBeNull();
    expect(container.querySelector('a[href="/pharmacy/catalog/import"]')).toBeNull();

    // With cost.view the column is there, empty until purchases record a cost.
    act(() => root.unmount());
    root = createRoot(container);
    mount(createElement(ProductSearch, searchProps({ showCost: true, initial: { items: [ITEM({ cost: { lastPurchaseMinor: null, currency: null } })], nextCursor: null } })));
    expect(container.querySelector('[data-cost]')?.textContent).toContain(en('pharmacy.catalog.noCost'));
  });

  it('shows strength, form and pack in every row', () => {
    mount(createElement(ProductSearch, searchProps()));
    const row = container.querySelector('[data-testid="product-row"]')!;
    expect(row.textContent).toContain('500 mg');
    expect(row.textContent).toContain('tablet');
    expect(row.textContent).toContain('30 box');
  });

  it('/ focuses the search', () => {
    mount(createElement(ProductSearch, searchProps()));
    act(() => {
      document.body.dispatchEvent(new KeyboardEvent('keydown', { key: '/', bubbles: true, cancelable: true }));
    });
    expect(document.activeElement).toBe(field(en('pharmacy.catalog.search.label')));
  });

  it('says it is offline with an icon, and searching failed with a way to retry', async () => {
    mount(createElement(ProductSearch, searchProps()));
    act(() => {
      Object.defineProperty(navigator, 'onLine', { value: false, configurable: true });
      window.dispatchEvent(new Event('offline'));
    });
    const offline = container.querySelector('[data-testid="catalog-offline"]');
    expect(offline?.textContent).toContain(en('pharmacy.catalog.offline'));
    expect(offline?.querySelector('svg')).toBeTruthy();
    act(() => {
      Object.defineProperty(navigator, 'onLine', { value: true, configurable: true });
      window.dispatchEvent(new Event('online'));
    });
    expect(container.querySelector('[data-testid="catalog-offline"]')).toBeNull();
  });
});

describe('the import wizard', () => {
  const fetchMock = vi.fn();
  beforeEach(() => {
    fetchMock.mockReset();
    vi.stubGlobal('fetch', fetchMock);
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  async function upload(name = 'list.csv') {
    const input = container.querySelector<HTMLInputElement>('input[type="file"]')!;
    const file = new File(['Trade name\nPanadol\n'], name, { type: 'text/csv' });
    Object.defineProperty(input, 'files', { value: [file], configurable: true });
    act(() => {
      input.dispatchEvent(new Event('change', { bubbles: true }));
    });
    await click(button(en('pharmacy.import.preview'))!);
    await settle();
  }

  it('shows each issue in the person’s words, with duplicate and double-mapped headers', async () => {
    fetchMock.mockResolvedValue(
      new Response(
        JSON.stringify({
          ok: true,
          data: {
            batchId: 'batch-1',
            batchHash: 'h',
            headers: ['Name', 'Name', 'Trade', 'Barcode'],
            suggestedMapping: { Name: 'tradeName', Trade: 'tradeName', Barcode: 'barcode' },
            mapping: { Name: 'tradeName', Trade: 'tradeName', Barcode: 'barcode' },
            summary: { ok: 1, warnings: 0, errors: 1, duplicates: 0, rows: 3 },
            firstRowsWithIssues: [
              { rowNumber: 2, status: 'error', issues: [{ code: 'BARCODE_IN_USE', field: 'barcode', severity: 'error', message: 'x' }] },
              {
                rowNumber: 3,
                status: 'ok',
                issues: [
                  { code: 'DEFAULT_APPLIED', field: 'rxLevel', severity: 'info', message: 'x' },
                  { code: 'NOT_IMPORTED', field: 'shelfLocation', severity: 'info', message: 'x' },
                  { code: 'MIN_QTY_IGNORED', field: 'minQty', severity: 'info', message: 'x' },
                  { code: 'PRICE_IGNORED', field: 'salePrice', severity: 'info', message: 'x' },
                ],
              },
            ],
          },
        }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      ),
    );
    mount(createElement(ImportWizard, { canSetPrices: true }));
    await upload();

    expect(fetchMock).toHaveBeenCalledWith('/pharmacy/catalog/import/preview', expect.objectContaining({ method: 'POST' }));
    const sent = fetchMock.mock.calls[0]![1].body as FormData;
    expect(sent.get('restaurantId')).toBeNull();
    expect(text()).toContain(en('pharmacy.import.repeatedHeader', { header: '⁨Name⁩' }));
    expect(text()).toContain(en('pharmacy.import.doubleMapped', { headers: '⁨Name⁩, ⁨Trade⁩', column: en('pharmacy.import.column.tradeName') }));
    for (const code of ['BARCODE_IN_USE', 'DEFAULT_APPLIED', 'NOT_IMPORTED', 'MIN_QTY_IGNORED', 'PRICE_IGNORED']) {
      const words = STUDIO_MESSAGES.en[`pharmacy.import.issue.${code}`]!;
      expect(text()).toContain(words.split('{')[0]!.slice(0, 30));
    }
    // An error row is left out of the apply.
    actions.applyImport.mockResolvedValue({ ok: true, data: { created: 1, prices: 0, skipped: 0, excluded: 1, alreadyApplied: false } });
    await click(button(en('pharmacy.import.apply'))!);
    expect(actions.applyImport).toHaveBeenCalledWith(expect.objectContaining({ batchId: 'batch-1', batchHash: 'h', excludeRowNumbers: [2] }));
    expect(actions.applyImport.mock.calls[0]![0]).not.toHaveProperty('restaurantId');
    await settle();
    expect(text()).toContain(en('pharmacy.import.done', { created: '1' }).slice(0, 10));
  });

  it('names the earlier import date for a file already imported, and too many rows', async () => {
    fetchMock.mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          ok: false,
          error: {
            code: 'CONFLICT',
            message: 'This file was already imported. Give a reason to import it again.',
            fields: { phCode: 'DUPLICATE_IMPORT', batchId: 'b0', importedAt: '2026-10-20T09:00:00.000Z' },
          },
        }),
        { status: 409 },
      ),
    );
    mount(createElement(ImportWizard, { canSetPrices: true }));
    await upload();
    const warning = container.querySelector('[data-testid="import-duplicate"]');
    expect(warning?.textContent).toMatch(/2026|20/);
    expect(field(en('pharmacy.import.overrideReason'))).toBeTruthy();

    fetchMock.mockResolvedValueOnce(
      new Response(JSON.stringify({ ok: false, error: { code: 'INVALID', message: 'Use at most 10,000 rows', fields: { phCode: 'TOO_MANY_ROWS' } } }), { status: 400 }),
    );
    await upload();
    expect(text()).toContain(en('error.text.phImportTooManyRows'));
  });

  it('refuses a file over 5 MB before sending it', async () => {
    mount(createElement(ImportWizard, { canSetPrices: true }));
    const input = container.querySelector<HTMLInputElement>('input[type="file"]')!;
    const file = new File([new Uint8Array(5 * 1024 * 1024 + 1)], 'big.csv', { type: 'text/csv' });
    Object.defineProperty(input, 'files', { value: [file], configurable: true });
    act(() => {
      input.dispatchEvent(new Event('change', { bubbles: true }));
    });
    expect(text()).toContain(en('pharmacy.import.tooBig'));
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
