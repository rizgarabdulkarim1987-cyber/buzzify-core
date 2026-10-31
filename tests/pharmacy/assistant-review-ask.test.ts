import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { INSUFFICIENT_DATA } from '@/server/domain/pharmacy/assistant-domain';
import { ask, type AskEnv, type AssistantAnswer } from '@/server/pharmacy/assistant/assistant';
import * as assistantActions from '@/server/pharmacy/actions/assistant';
import { phScopedClient } from '@/server/studio/framework/access';
import { StudioError } from '@/server/studio/framework/result';
import { assistantWorld, scripted, text, tools, type AssistantWorld } from './assistant-mock';
import { asPh, NOW, pharmacy, prisma, resetWorld, useTestDatabase, type Person } from './fixture';
import { sell } from './reports-world';
import { act, codeOf } from './stock-helpers';

/** Review fixes for phase 7 task 4 (Important 4 and 5; Minor 1, 2, 4, 6). Each case failed before the fix. */

let w: AssistantWorld;

beforeAll(async () => {
  useTestDatabase();
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(NOW);
  await resetWorld();
  w = await assistantWorld();
}, 180_000);
afterAll(() => {
  vi.useRealTimers();
});
afterEach(() => {
  vi.setSystemTime(NOW);
});

async function envFor(who: Person, provider: AskEnv['provider']): Promise<AskEnv> {
  const ph = (await asPh(who.userId, w.a.id))!;
  return { scoped: phScopedClient(prisma(), ph), ph, now: NOW, provider };
}
const askAs = async (who: Person, provider: AskEnv['provider'], question: string, opts: Parameters<typeof ask>[2] = {}): Promise<AssistantAnswer> => ask(await envFor(who, provider), question, opts);
const refusal = async (promise: Promise<unknown>): Promise<string> => {
  try {
    await promise;
    return 'OK';
  } catch (error) {
    if (error instanceof StudioError) return error.code;
    throw error;
  }
};

describe('arguments chosen by the model can never make ask throw or widen its scope', () => {
  it('ignores a branch the model names, and skips a reversed or oversized period instead of throwing', async () => {
    const other = await pharmacy('Rv', { branches: 1 });
    for (const input of [
      { branchId: other.branchIds[0], period: { from: '2026-10-27', to: '2026-10-01' } },
      { branchId: 'nonexistent', period: { from: '2020-01-01', to: '2026-10-27' } },
      { period: { from: '2026-02-30', to: '2026-03-01' } },
    ]) {
      const model = scripted(tools({ name: 'slow_movers', input }), text('Nothing to say.'));
      const a = await askAs(w.owner, model, 'good morning, what should I look at today');
      expect(a, JSON.stringify(input)).toBeDefined();
      for (const t of a.tables) expect(t.branches.every((b) => [w.b1, w.b2].includes(b))).toBe(true);
    }
  });

  it('keeps the caller’s branch, whatever branch the model asks for', async () => {
    const model = scripted(tools({ name: 'stock_below_reorder', input: { branchId: w.b2 } }), text('1 product is below its minimum.'));
    const a = await askAs(w.owner, model, 'good morning, what should I look at today', { branchId: w.b1 });
    expect(a.tables.map((t) => t.tool)).toEqual(['stock_below_reorder']);
    expect(a.tables[0]!.branches).toEqual([w.b1]);
  });

  it('does not let the model narrow the scope to a branch the caller did not choose', async () => {
    const model = scripted(tools({ name: 'stock_below_reorder', input: { branchId: w.b2 } }), text('ok'));
    const a = await askAs(w.owner, model, 'good morning, what should I look at today');
    expect([...a.tables[0]!.branches].sort()).toEqual([w.b1, w.b2].sort());
  });

  it('degrades, and does not throw, when a model-planned tool fails', async () => {
    // A branch-limited manager: the model asks for a reversed period and an unreachable branch.
    const model = scripted(tools({ name: 'slow_movers', input: { branchId: w.b2, period: { from: '2026-10-27', to: '2026-10-01' } } }), text('ok'));
    const a = await askAs(w.manager1, model, 'good morning, what should I look at today');
    expect(a.tables.every((t) => t.branches.every((b) => b === w.b1))).toBe(true);
  });
});

describe('the forecast is per product and needs eight distinct weeks of sales', () => {
  const tab = (qty: number) => [{ productId: w.P.id, unitId: w.P.tablet, qty }];
  const pay = (n: bigint) => [{ method: 'CASH', amountMinor: n, clientKey: `fc-${n}-${Math.random().toString(36).slice(2)}-xxxxxxxx` }];

  it('names no product: no estimate, and a different sentence from "insufficient data"', async () => {
    const a = await askAs(w.owner, scripted(), 'Forecast next week');
    expect(a.label).toBe('fact');
    expect(a.forecast).toBeUndefined();
    expect(a.reason).toBe('PRODUCT_NEEDED');
  });

  it('is "insufficient data" for a product with two sales nine weeks apart', async () => {
    vi.setSystemTime(new Date('2026-08-20T09:00:00.000Z'));
    await sell(w, w.cashier1, w.b1, 'IQD', tab(2), pay(200n));
    vi.setSystemTime(new Date('2026-10-22T09:00:00.000Z'));
    await sell(w, w.cashier1, w.b1, 'IQD', tab(3), pay(300n));
    vi.setSystemTime(NOW);
    const a = await askAs(w.owner, scripted(), 'Forecast next week', { productId: w.P.id });
    expect(a.answer).toBe(INSUFFICIENT_DATA);
    expect(a.forecast).toBeUndefined();
  });

  it('is an estimate for the product from eight distinct weeks on, and says what it leaves out', async () => {
    for (const day of ['2026-10-15', '2026-10-08', '2026-10-01', '2026-09-24', '2026-09-17', '2026-09-10']) {
      vi.setSystemTime(new Date(`${day}T09:00:00.000Z`));
      await sell(w, w.cashier1, w.b1, 'IQD', tab(1), pay(100n));
    }
    vi.setSystemTime(NOW);
    const a = await askAs(w.owner, scripted(), 'Forecast next week', { productId: w.P.id });
    expect(a.label).toBe('estimate');
    expect(a.forecast).toMatchObject({ nextWeekUnits: 3, weeksOfHistory: 8 });
    expect(a.answer).toMatch(/stock-?outs?/i);
    // Another product has no sales of its own: the units of P are not its units.
    expect((await askAs(w.owner, scripted(), 'Forecast next week', { productId: w.Q.id })).answer).toBe(INSUFFICIENT_DATA);
    expect(await refusal(askAs(w.cashier1, scripted(), 'Forecast next week', { productId: w.P.id }))).toBe('FORBIDDEN');
  });
});

describe('small defects found in review', () => {
  it('passes a long question to the model whole up to 1000 characters (Minor 1)', async () => {
    const long = `Which batches expire soon? ${'please '.repeat(60)}`.trim();
    const model = scripted(text('3 batches.'));
    await askAs(w.owner, model, long);
    expect(model.requests[0]!.user).toContain('please please please please please please please please please please please please please please please please please please please please');
    expect(model.requests[0]!.user.length).toBeGreaterThan(300);
  });

  it('labels the payables with every branch of the business, not the actor’s branches (Minor 2)', async () => {
    const a = await askAs(w.manager1, null, 'Show unpaid supplier invoices');
    expect(a.tables[0]!.tool).toBe('unpaid_supplier_invoices');
    expect(a.tables[0]!.branches).toEqual([]);
  });

  it('refuses a transfer proposal from a branch that is not the business’s with NOT_FOUND, not an unhandled error (Minor 4)', async () => {
    const other = await pharmacy('Rv2', { branches: 1 });
    const result = await act(w.owner, assistantActions.proposalCreate, {
      restaurantId: w.a.id,
      proposal: { kind: 'TRANSFER', fromBranchId: other.branchIds[0], toBranchId: w.b2, lines: [{ productId: w.P.id, qty: 1 }] },
    });
    expect(codeOf(result)).toBe('NOT_FOUND');
  });

  it('sweeps the transfer tool with a batch in the ask case: a transfer question reaches transfer_candidates (Minor 6)', async () => {
    const batch = (await prisma().phBatch.findFirstOrThrow({ where: { restaurantId: w.a.id }, select: { id: true } })).id;
    const a = await askAs(w.owner, null, 'Can we transfer this batch?', { batchId: batch });
    expect(a.tables.map((t) => t.tool)).toEqual(['transfer_candidates']);
  });
});
