import { describe, expect, it } from 'vitest';
import type { LocalOrder } from '@/lib/pos-sync/local-state';
import type { SyncSnapshot } from '@/lib/pos-sync/snapshot';
import type { PaperRow } from '@/server/domain/pos/paper';
import type { PaperFormat } from '@/server/domain/pos/paper-docs';
import { offlineKitchenDocs, offlineReceiptDoc } from '@/server/domain/pos/offline-docs';

const t = (key: string, vars?: Record<string, string | number>) => (vars ? `${key}:${Object.values(vars).join(',')}` : key);
const fmt: PaperFormat = { money: (n) => `${n}$`, number: (n) => String(n), stamp: () => 'STAMP' };
const text = (rows: PaperRow[]) => rows.filter((r): r is Extract<PaperRow, { kind: 'text' }> => r.kind === 'text');

const line = (id: string, over: Partial<LocalOrder['lines'][number]> = {}): LocalOrder['lines'][number] => ({
  id, productId: 'p', name: 'Kebab', quantity: 2, unitPrice: 5000, promoPerUnit: 0, options: [], note: '', discount: null, cancelled: false, sent: false, ...over,
});

const order = (over: Partial<LocalOrder> = {}): LocalOrder => ({
  key: 'op:abc', serverId: null, number: null, provisional: 'P-ABCD-3', tableId: 't1', status: 'OPEN', version: 1, seatedAt: '2026-10-29T10:00:00Z', invoiceDiscount: null,
  lines: [line('l1')], waiting: 1, attention: false, paid: null, cancelled: false, ...over,
});

const snapshot = {
  rates: { serviceRatePercent: 0, taxRatePercent: 10, roundingStep: 0 },
  business: { name: 'Grill House', address: 'Street 1', phone: '0770', taxNumber: 'T-9', footer: 'Thanks' },
  user: { id: 'u', name: 'Ali', locale: 'en', can: { discount: true, cancel: true, pay: true } },
  catalog: null,
  printers: [],
} as unknown as SyncSnapshot;

describe('offlineReceiptDoc', () => {
  const paid = order({ paid: { total: 11_000, amountReceived: 20_000, change: 9_000 } });

  it('shows the provisional number and the provisional line', () => {
    const flat = text(offlineReceiptDoc(paid, 4, snapshot, t, fmt).rows).map((r) => r.left);
    expect(flat).toContain('pos.receipt.heading:P-ABCD-3');
    expect(flat).toContain('pos.offline.receiptProvisional');
    expect(JSON.stringify(offlineReceiptDoc(paid, 4, snapshot, t, fmt))).toContain('P-ABCD-3');
  });

  it('totals equal what the screen shows', () => {
    const rows = text(offlineReceiptDoc(paid, 4, snapshot, t, fmt).rows);
    expect(rows.find((r) => r.left === 'pos.totals.total')?.right).toBe('11000$');
    expect(rows.find((r) => r.left === '2 × Kebab')?.right).toBe('10000$');
    expect(rows.find((r) => r.left === 'pos.pay.change')?.right).toBe('9000$');
  });

  it('prints without business details', () => {
    const bare = { ...snapshot, business: undefined } as unknown as SyncSnapshot;
    const rows = text(offlineReceiptDoc(paid, 4, bare, t, fmt).rows).map((r) => r.left);
    expect(rows).toContain('2 × Kebab');
    expect(rows).not.toContain('Grill House');
  });
});

describe('offlineKitchenDocs', () => {
  const catalog = { categories: [], products: [{ id: 'p', sectionId: 's1' }, { id: 'q', sectionId: null }] } as unknown as SyncSnapshot['catalog'];
  const snap = { ...snapshot, catalog, printers: [{ id: 'k', name: 'Grill', role: 'KITCHEN', sectionId: 's1' }] } as unknown as SyncSnapshot;

  it('groups unsent lines by section', () => {
    const o = order({ lines: [line('a'), line('b', { productId: 'q', name: 'Tea' }), line('c', { sent: true, name: 'Old' })] });
    const docs = offlineKitchenDocs(o, 4, snap, t, fmt, new Set());
    expect(docs.map((d) => d.sectionId).sort()).toEqual([null, 's1']);
    const flat = docs.flatMap((d) => text(d.doc.rows).map((r) => r.left));
    expect(flat).toContain('2 × Kebab');
    expect(flat).toContain('2 × Tea');
    expect(flat).not.toContain('2 × Old');
  });

  it('makes no ticket when everything was sent', () => {
    expect(offlineKitchenDocs(order({ lines: [line('a', { sent: true })] }), 4, snap, t, fmt, new Set())).toEqual([]);
  });

  it('prints a cancellation slip once for a sent line that was cancelled', () => {
    const o = order({ lines: [line('a', { sent: true, cancelled: true })] });
    const first = offlineKitchenDocs(o, 4, snap, t, fmt, new Set());
    expect(first).toHaveLength(1);
    expect(first[0]?.slipKey).toBeTruthy();
    expect(offlineKitchenDocs(o, 4, snap, t, fmt, new Set([first[0]!.slipKey!]))).toEqual([]);
  });
});
