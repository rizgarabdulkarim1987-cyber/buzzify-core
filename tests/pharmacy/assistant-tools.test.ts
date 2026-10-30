import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { ASSISTANT_TOOLS } from '@/server/domain/pharmacy/assistant-domain';
import * as invoiceActions from '@/server/pharmacy/actions/supplier-invoices';
import * as receiptActions from '@/server/pharmacy/actions/receipts';
import { runTool, type ToolEnv } from '@/server/pharmacy/assistant/tools';
import { toolOutputs } from '@/server/pharmacy/assistant/tool-shapes';
import { phScopedClient } from '@/server/studio/framework/access';
import { StudioError } from '@/server/studio/framework/result';
import { assistantWorld, type AssistantWorld } from './assistant-mock';
import { asPh, grant, NOW, person, prisma, resetWorld, useTestDatabase, type Person } from './fixture';
import { build, type Biz } from './reports-world';
import { act, dataOf } from './stock-helpers';

/* eslint-disable @typescript-eslint/no-explicit-any -- tool outputs are read off the wire and checked by value */

/**
 * The six tools (phase 7, task 4; R7-6) against the hand-figure world of assistant-mock.ts. Each figure is written out beside the
 * data that makes it. Today is 2026-10-27 (NOW), Baghdad day 2026-10-27; the 30-day window is 2026-09-28..2026-10-27.
 */

const denied = vi.hoisted(() => new Set<string>());
vi.mock('@/server/domain/pharmacy/permissions', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/server/domain/pharmacy/permissions')>();
  return { ...actual, canPh: (role: Parameters<typeof actual.canPh>[0], permission: Parameters<typeof actual.canPh>[1]) => !denied.has(permission) && actual.canPh(role, permission) };
});

let w: AssistantWorld;
let u: Biz;

beforeAll(async () => {
  useTestDatabase();
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(NOW);
  await resetWorld();
  w = await assistantWorld();
  u = await build('U', false);
}, 180_000);
afterAll(() => {
  vi.useRealTimers();
  denied.clear();
});

async function envOf(who: Person, restaurantId: string): Promise<ToolEnv> {
  const ph = await asPh(who.userId, restaurantId);
  if (!ph) throw new Error('no pharmacy actor');
  return { scoped: phScopedClient(prisma(), ph), ph, now: NOW };
}
const run = async (who: Person, name: string, input: unknown = {}, restaurantId = w.a.id): Promise<any> => runTool(await envOf(who, restaurantId), name, input);
const codeOf = async (promise: Promise<unknown>): Promise<string> => {
  try {
    await promise;
    return 'OK';
  } catch (error) {
    if (error instanceof StudioError) return error.code;
    throw error;
  }
};
const withDenied = async <T>(perms: string[], body: () => Promise<T>): Promise<T> => {
  for (const p of perms) denied.add(p);
  try {
    return await body();
  } finally {
    denied.clear();
  }
};

describe('batches_expiring', () => {
  it('lists the expired and the expiring batches with the hand figures, soonest first, with cost for the owner', async () => {
    const out = await run(w.owner, 'batches_expiring');
    expect(out).toMatchObject({ tool: 'batches_expiring', days: 90, dataAsOf: NOW.toISOString(), period: null, branches: [w.b1, w.b2], truncated: false });
    expect(out.totals).toEqual({ expired: 1, d30: 2, d60: 0, d90: 0, d180: 0 });
    expect(out.rows.map((r: any) => [r.lot, r.branchId, r.units, r.daysToExpiry, r.band])).toEqual([
      ['ZOLD', w.b1, 50, -26, 'expired'],
      ['HLOT', w.b1, 5, 14, 'd30'],
      ['XEXP', w.b2, 10, 24, 'd30'],
    ]);
    const x = out.rows.find((r: any) => r.lot === 'XEXP');
    expect(x).toMatchObject({ tradeName: 'PanadolT', batchId: w.extra.x, expiryDate: '2026-11-20', unitCostMinor: '705', currency: 'IQD' });
    expect(out.rows.find((r: any) => r.lot === 'ZOLD')).toMatchObject({ unitCostMinor: null, currency: null });
  });

  it('keeps a horizon: 30 days leaves nothing out here, and a branch narrows the rows', async () => {
    const b2 = await run(w.owner, 'batches_expiring', { days: 30, branchId: w.b2 });
    expect(b2.rows.map((r: any) => r.lot)).toEqual(['XEXP']);
    expect(b2.branches).toEqual([w.b2]);
    expect(b2.days).toBe(30);
  });

  it('shows a branch-limited person their own branch only, and refuses a branch that is not theirs', async () => {
    const own = await run(w.manager1, 'batches_expiring');
    expect(own.branches).toEqual([w.b1]);
    expect(own.rows.map((r: any) => r.lot)).toEqual(['ZOLD', 'HLOT']);
    expect(await codeOf(run(w.manager1, 'batches_expiring', { branchId: w.b2 }))).toBe('FORBIDDEN');
  });

  it('leaves the cost keys out entirely without cost.view', async () => {
    const out = await withDenied(['cost.view'], () => run(w.owner, 'batches_expiring'));
    expect(out.rows.length).toBe(3);
    for (const r of out.rows) expect(Object.keys(r)).not.toEqual(expect.arrayContaining(['unitCostMinor']));
    expect(JSON.stringify(out)).not.toMatch(/unitCostMinor|"currency"/);
  });
});

describe('stock_below_reorder', () => {
  it('lists the product whose sellable stock is under the branch minimum: Panadol at branch 1 (199 of 200)', async () => {
    const out = await run(w.owner, 'stock_below_reorder');
    expect(out.total).toBe(1);
    expect(out.rows).toEqual([{ productId: w.P.id, tradeName: 'PanadolT', strength: '', form: '', branchId: w.b1, minQty: 200, sellable: 199, deficit: 1, reorderQty: 100 }]);
    expect(out.truncated).toBe(false);
    expect(out.branches).toEqual([w.b1, w.b2]);
  });

  it('answers a branch with nothing short with an empty list', async () => {
    const out = await run(w.owner, 'stock_below_reorder', { branchId: w.b2 });
    expect(out).toMatchObject({ total: 0, rows: [], branches: [w.b2] });
  });
});

describe('slow_movers', () => {
  it('ranks products with stock by units sold in the last 30 days, fewest first, then the most stock', async () => {
    const out = await run(w.owner, 'slow_movers');
    expect(out.period).toEqual({ from: '2026-09-28', to: '2026-10-27' });
    expect(out.days).toBe(30);
    // Q: 200 on hand (the expired Z is not sellable), sold 0. Hostile: 5 on hand, sold 0. P: 199 + 200 + 200 + 10 = 609, sold 1.
    expect(out.rows.map((r: any) => [r.productId, r.soldUnits, r.onHandUnits])).toEqual([
      [w.Q.id, 0, 200],
      [w.extra.hostileProductId, 0, 5],
      [w.P.id, 1, 609],
    ]);
  });

  it('counts only the branch asked for, and only the sales inside the period', async () => {
    const b2 = await run(w.owner, 'slow_movers', { branchId: w.b2 });
    expect(b2.rows.map((r: any) => [r.productId, r.soldUnits, r.onHandUnits])).toEqual([
      [w.P.id, 0, 410],
      [w.Q.id, 0, 100],
    ]);
    const before = await run(w.owner, 'slow_movers', { period: { from: '2026-09-01', to: '2026-09-27' } });
    expect(before.rows.every((r: any) => r.soldUnits === 0)).toBe(true);
    expect(await codeOf(run(w.owner, 'slow_movers', { period: { from: '2026-10-27', to: '2026-10-01' } }))).toBe('INVALID');
  });
});

describe('transfer_candidates', () => {
  it('suggests moving the spare of batch X from branch 2 to branch 1, which is 1 short of its minimum', async () => {
    const out = await run(w.owner, 'transfer_candidates', { batchId: w.extra.x });
    expect(out.batch).toMatchObject({ batchId: w.extra.x, lot: 'XEXP', expiryDate: '2026-11-20', status: 'ACTIVE' });
    expect(out.notSuggested).toBeNull();
    // Branch 2 holds 10 of X (410 sellable of P against a minimum of 100): it can spare all 10. Branch 1 has 199 of 200.
    expect(out.rows).toEqual([{ fromBranchId: w.b2, toBranchId: w.b1, availableAtSource: 10, destSellable: 199, destMinQty: 200, suggestedQty: 1 }]);
  });

  it('suggests nothing when no branch is short, and nothing at all for an expired batch', async () => {
    expect((await run(w.owner, 'transfer_candidates', { batchId: w.extra.h })).rows).toEqual([]);
    const expired = await run(w.owner, 'transfer_candidates', { batchId: w.extra.z });
    expect(expired).toMatchObject({ notSuggested: 'EXPIRED', rows: [] });
  });

  it('suggests nothing for a recalled batch', async () => {
    const recalled = await prisma().phBatch.create({ data: { restaurantId: w.a.id, productId: w.P.id, lot: 'RECALL1', expiryDate: new Date('2028-01-01T00:00:00.000Z'), status: 'RECALLED' }, select: { id: true } });
    expect(await run(w.owner, 'transfer_candidates', { batchId: recalled.id })).toMatchObject({ notSuggested: 'NOT_ACTIVE', rows: [] });
  });

  it('does not see the other branch for a person of branch 1 only, and does not find another business’s batch', async () => {
    const own = await run(w.manager1, 'transfer_candidates', { batchId: w.extra.x });
    expect(own.rows).toEqual([]);
    expect(own.branches).toEqual([w.b1]);
    expect(await codeOf(run(w.owner, 'transfer_candidates', { batchId: u.ids.pb1! }))).toBe('NOT_FOUND');
    expect(await codeOf(run(w.owner, 'transfer_candidates', { batchId: 'no-such-batch' }))).toBe('NOT_FOUND');
  });
});

describe('margin_change', () => {
  it('compares the margin of the last 30 days with the 30 days before, per currency: 100 net, 30 margin (3,000 bp) against nothing', async () => {
    const out = await run(w.owner, 'margin_change');
    expect(out.period).toEqual({ from: '2026-09-28', to: '2026-10-27' });
    expect(out.previous).toEqual({ from: '2026-08-29', to: '2026-09-27' });
    // One tablet sold at 100; its batch costs 705 per strip of 10, so 70 per tablet: margin 30 of 100.
    expect(out.byCurrency).toEqual([{ currency: 'IQD', netMinor: '100', marginMinor: '30', marginBp: 3000, previousNetMinor: '0', previousMarginMinor: '0', previousMarginBp: null, changeBp: null }]);
  });

  it('gives the move in basis points when both periods sold', async () => {
    const out = await run(w.owner, 'margin_change', { period: { from: '2026-10-27', to: '2026-10-27' } });
    expect(out.previous).toEqual({ from: '2026-10-26', to: '2026-10-26' });
    expect(out.byCurrency[0]).toMatchObject({ netMinor: '100', marginBp: 3000, previousMarginBp: null, changeBp: null });
  });
});

describe('unpaid_supplier_invoices', () => {
  let ids: { a: string; b: string; usd: string };
  const nextKey = (() => {
    let n = 0;
    return (p: string) => `${p}-${(n += 1)}-aaaa`;
  })();

  async function invoiceFor(biz: Biz, total: number, over: { currency: 'IQD' | 'USD'; number: string; dueDate: string }): Promise<string> {
    const supplier = await prisma().phSupplier.create({ data: { restaurantId: biz.a.id, name: `Supplier ${over.number}`, nameKey: over.number.toLowerCase(), defaultCurrency: over.currency, termsDays: 30, clientKey: nextKey('sup'), createdById: biz.owner.userId }, select: { id: true } });
    const made = dataOf(
      await act(biz.owner, receiptActions.create, {
        restaurantId: biz.a.id,
        branchId: biz.b1,
        clientKey: nextKey('rcpt'),
        supplierId: supplier.id,
        supplierName: '',
        reference: 'GRN',
        receivedOn: '2026-07-20',
        lines: [{ productId: biz.P.id, unitId: biz.P.strip, qty: 1, lot: nextKey('lot'), expiry: '2028-03-15', unitCostMinor: String(total), currency: over.currency }],
      }),
    );
    dataOf(await act(biz.owner, receiptActions.confirm, { restaurantId: biz.a.id, branchId: biz.b1, receiptId: made.id }));
    const line = await prisma().phReceiptLine.findFirstOrThrow({ where: { receiptId: made.id }, select: { id: true } });
    return dataOf(
      await act(biz.owner, invoiceActions.create, {
        restaurantId: biz.a.id,
        clientKey: nextKey('inv'),
        supplierId: supplier.id,
        number: over.number,
        invoiceDate: '2026-10-01',
        dueDate: over.dueDate,
        currency: over.currency,
        lines: [{ receiptLineId: line.id, qtyInvoiced: 1, unitCostMinor: String(total) }],
      }),
    ).id;
  }

  beforeAll(async () => {
    ids = {
      a: await invoiceFor(u, 500_000, { currency: 'IQD', number: 'A-1', dueDate: '2026-10-20' }),
      b: await invoiceFor(u, 250_000, { currency: 'IQD', number: 'B-1', dueDate: '2026-11-20' }),
      usd: await invoiceFor(u, 20_000, { currency: 'USD', number: 'U-1', dueDate: '2026-10-30' }),
    };
  }, 120_000);

  it('lists what is owed, oldest due first, with totals per currency that are never added together', async () => {
    const out = await run(u.owner, 'unpaid_supplier_invoices', {}, u.a.id);
    expect(out.rows.map((r: any) => [r.invoiceId, r.number, r.currency, r.dueDate, r.daysOverdue, r.balanceMinor])).toEqual([
      [ids.a, 'A-1', 'IQD', '2026-10-20', 7, '500000'],
      [ids.usd, 'U-1', 'USD', '2026-10-30', 0, '20000'],
      [ids.b, 'B-1', 'IQD', '2026-11-20', 0, '250000'],
    ]);
    expect(out.totals).toEqual([
      { currency: 'IQD', count: 2, balanceMinor: '750000', overdueMinor: '500000' },
      { currency: 'USD', count: 1, balanceMinor: '20000', overdueMinor: '0' },
    ]);
  });

  it('shows the accountant and the stock keeper the same list, and leaves the money out without cost.view', async () => {
    const stock = await run(u.stockP, 'unpaid_supplier_invoices', {}, u.a.id);
    expect(stock.rows).toHaveLength(3);
    const bare = await withDenied(['cost.view'], () => run(u.owner, 'unpaid_supplier_invoices', {}, u.a.id));
    expect(bare.rows).toHaveLength(3);
    expect(JSON.stringify(bare)).not.toMatch(/balanceMinor|overdueMinor/);
    expect(bare.totals).toEqual([{ currency: 'IQD', count: 2 }, { currency: 'USD', count: 1 }]);
  });

  it('does not show another business its rows', async () => {
    const mine = await run(w.owner, 'unpaid_supplier_invoices');
    expect(mine.rows).toEqual([]);
    expect(JSON.stringify(mine)).not.toContain(ids.a);
  });
});

describe('who may run which tool', () => {
  const TEXT_INPUT = (tool: string) => (tool === 'transfer_candidates' ? { batchId: w.extra.x } : {});

  it('refuses a cashier, a pharmacist and a support actor every tool, and a stock keeper all but the payables', async () => {
    for (const tool of ASSISTANT_TOOLS) {
      expect(await codeOf(run(w.cashier1, tool, TEXT_INPUT(tool))), `cashier ${tool}`).toBe('FORBIDDEN');
      expect(await codeOf(run(w.pharmacist, tool, TEXT_INPUT(tool))), `pharmacist ${tool}`).toBe('FORBIDDEN');
      expect(await codeOf(run(w.stockP, tool, TEXT_INPUT(tool))), `stock ${tool}`).toBe(tool === 'unpaid_supplier_invoices' ? 'OK' : 'FORBIDDEN');
    }
    const support = await person('supportT', { superAdmin: true });
    await grant(support, w.a.id, { scopes: ['catalog.read', 'stock.read'] });
    for (const tool of ASSISTANT_TOOLS) expect(await codeOf(run(support, tool, TEXT_INPUT(tool))), `support ${tool}`).toBe('FORBIDDEN');
  });

  it('gives the pharmacist in charge everything but the margin, and the accountant and manager all six', async () => {
    for (const tool of ASSISTANT_TOOLS) {
      expect(await codeOf(run(w.pic, tool, TEXT_INPUT(tool))), `pic ${tool}`).toBe(tool === 'margin_change' ? 'FORBIDDEN' : 'OK');
      expect(await codeOf(run(w.accountant, tool, TEXT_INPUT(tool))), `accountant ${tool}`).toBe('OK');
      expect(await codeOf(run(w.manager1, tool, TEXT_INPUT(tool))), `manager ${tool}`).toBe('OK');
    }
  });

  it.each([['report.view'], ['profit.view'], ['cost.view']])('refuses the margin without %s even for the owner', async (missing) => {
    expect(await withDenied([missing], () => codeOf(run(w.owner, 'margin_change')))).toBe('FORBIDDEN');
  });

  it('refuses the four report tools without report.view and the payables without purchase.manage', async () => {
    for (const tool of ['batches_expiring', 'stock_below_reorder', 'slow_movers', 'transfer_candidates', 'margin_change']) {
      expect(await withDenied(['report.view'], () => codeOf(run(w.owner, tool, TEXT_INPUT(tool)))), tool).toBe('FORBIDDEN');
    }
    expect(await withDenied(['purchase.manage'], () => codeOf(run(w.owner, 'unpaid_supplier_invoices')))).toBe('FORBIDDEN');
  });

  it('refuses an unknown tool and an input that carries anything off its shape', async () => {
    expect(await codeOf(run(w.owner, 'drop_tables'))).toBe('INVALID');
    expect(await codeOf(run(w.owner, 'batches_expiring', { days: 45 }))).toBe('INVALID');
    expect(await codeOf(run(w.owner, 'batches_expiring', { sql: 'select 1' }))).toBe('INVALID');
    expect(await codeOf(run(w.owner, 'transfer_candidates', {}))).toBe('INVALID');
  });
});

describe('isolation between businesses', () => {
  it('shows each business only its own ids in every tool', async () => {
    for (const tool of ASSISTANT_TOOLS) {
      const theirs = JSON.stringify(await run(u.owner, tool, tool === 'transfer_candidates' ? { batchId: u.ids.pb1! } : {}, u.a.id));
      const mine = JSON.stringify(await run(w.owner, tool, tool === 'transfer_candidates' ? { batchId: w.extra.x } : {}));
      expect(theirs, tool).not.toContain(w.a.id);
      expect(theirs, tool).not.toContain(w.P.id);
      expect(theirs, tool).not.toContain(w.extra.x);
      expect(mine, tool).not.toContain(u.a.id);
      expect(mine, tool).not.toContain(u.P.id);
    }
  });

  it('parses every output with its strict shape (no key outside the whitelist can come out)', async () => {
    for (const tool of ASSISTANT_TOOLS) {
      const out = await run(w.owner, tool, tool === 'transfer_candidates' ? { batchId: w.extra.x } : {});
      expect(toolOutputs[tool].safeParse(out).success, tool).toBe(true);
    }
  });
});
