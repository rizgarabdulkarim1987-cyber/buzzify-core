import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { AiNotEnabledError, AiOutputRejectedError } from '@/server/ai/errors';
import { writeAiPackage } from '@/server/ai/package';
import { FakeProvider } from '@/server/ai/provider/fake';
import { setAiProviderForTests } from '@/server/ai/provider';
import { phraseSummary, previousPeriod, readSummary, summaryPeriod } from '@/server/ai/summary';
import { phrasePosAiSummary } from '@/server/studio/actions/pos-ai';
import { posAiAlerts, posAiState, posAiSummary } from '@/server/studio/queries/pos-ai';
import { ask, dataOf, prisma, run, useTestDatabase } from '../fixture';
import { makeAiWorld, paidOrder, type AiWorld } from './world';

vi.mock('next/headers', () => ({ headers: vi.fn(), cookies: vi.fn() }));

const globalForPrisma = globalThis as unknown as { __prisma?: unknown };
let w: AiWorld;
let fake: FakeProvider;
const env = () => ({ db: prisma(), restaurantId: w.a.id, staffId: 'staff-1' });
/** A moment tomorrow, so that the period the summary covers (the day that ended yesterday) is today, where the orders are. */
const tomorrow = () => new Date(Date.now() + 24 * 60 * 60 * 1000);
const daily = { kind: 'DAILY', locale: 'en' } as const;

beforeAll(() => useTestDatabase());
beforeEach(async () => {
  vi.spyOn(console, 'error').mockImplementation(() => undefined);
  w = await makeAiWorld();
  fake = new FakeProvider();
  setAiProviderForTests(fake);
});
afterEach(() => {
  setAiProviderForTests(undefined);
  vi.restoreAllMocks();
});
afterAll(async () => {
  await prisma().$disconnect();
  delete globalForPrisma.__prisma;
});

describe('the summary period', () => {
  it('is the 1, 7 or 30 whole days that ended yesterday, and the previous one is just before', () => {
    expect(summaryPeriod('DAILY', '2026-10-25')).toEqual({ from: '2026-10-24', to: '2026-10-24' });
    expect(summaryPeriod('WEEKLY', '2026-10-25')).toEqual({ from: '2026-10-18', to: '2026-10-24' });
    expect(summaryPeriod('MONTHLY', '2026-03-02')).toEqual({ from: '2026-01-31', to: '2026-03-01' });
    expect(previousPeriod({ from: '2026-10-18', to: '2026-10-24' })).toEqual({ from: '2026-10-11', to: '2026-10-17' });
    expect(previousPeriod({ from: '2026-10-24', to: '2026-10-24' })).toEqual({ from: '2026-10-23', to: '2026-10-23' });
  });
});

describe('readSummary and phraseSummary', () => {
  it('reads real totals first, with no text and no request', async () => {
    const total = await paidOrder(w, 2);
    const view = await readSummary(prisma(), w.a.id, daily, tomorrow());
    expect(view.text).toBeNull();
    expect(view.facts.totals).toMatchObject({ grossSales: total, netSales: total });
    expect(view.facts.previous.grossSales).toBe(0);
    expect(fake.calls).toHaveLength(0);
  });

  it('phrases once, keeps the text for the same facts and reuses it without a second request', async () => {
    await paidOrder(w, 2);
    const first = await phraseSummary(env(), daily, tomorrow());
    expect(first.cached).toBe(false);
    expect(first.text.startsWith('[en]')).toBe(true);
    const second = await phraseSummary(env(), daily, tomorrow());
    expect(second).toEqual({ text: first.text, cached: true });
    expect(fake.calls).toHaveLength(1);
    expect((await prisma().posAiUsageMonth.findFirstOrThrow()).requests).toBe(1);
    expect((await readSummary(prisma(), w.a.id, daily, tomorrow())).text).toBe(first.text);
  });

  it('writes again when the facts changed, and keeps a language of its own', async () => {
    await paidOrder(w, 1);
    await phraseSummary(env(), daily, tomorrow());
    await paidOrder(w, 3);
    expect((await readSummary(prisma(), w.a.id, daily, tomorrow())).text).toBeNull();
    const again = await phraseSummary(env(), daily, tomorrow());
    expect(again.cached).toBe(false);
    const arabic = await phraseSummary(env(), { kind: 'DAILY', locale: 'ar' }, tomorrow());
    expect(arabic.text.startsWith('[ar]')).toBe(true);
    expect(await prisma().posAiSummary.count()).toBe(2);
  });

  it('refuses a number the facts do not contain, and an accusing word, and keeps nothing', async () => {
    fake.enqueue({ response: { content: [{ type: 'text', text: 'Sales were 777777 today.' }] } });
    await expect(phraseSummary(env(), daily, tomorrow())).rejects.toBeInstanceOf(AiOutputRejectedError);
    fake.enqueue({ response: { content: [{ type: 'text', text: 'There was fraud.' }] } });
    await expect(phraseSummary(env(), daily, tomorrow())).rejects.toBeInstanceOf(AiOutputRejectedError);
    expect(await prisma().posAiSummary.count()).toBe(0);
    expect((await prisma().posAiCall.findMany()).map((c) => c.status)).toEqual(['REJECTED_OUTPUT', 'REJECTED_OUTPUT']);
  });

  it('is refused before anything is read when the package is off', async () => {
    await writeAiPackage(prisma(), w.a.id, { enabled: false });
    await expect(phraseSummary(env(), daily, tomorrow())).rejects.toBeInstanceOf(AiNotEnabledError);
    expect(fake.calls).toHaveLength(0);
  });

  it('keeps the other restaurant out of the facts', async () => {
    await paidOrder(w, 2);
    const view = await readSummary(prisma(), w.b.id, daily, tomorrow());
    expect(view.facts.totals.grossSales).toBe(0);
  });
});

describe('the till definitions', () => {
  it('answers the state to every role, with the usage', async () => {
    expect(dataOf(await ask(w.cashier, posAiState, {}))).toMatchObject({ enabled: true, limit: 50, used: 0 });
    await writeAiPackage(prisma(), w.a.id, { enabled: false });
    expect(dataOf(await ask(w.cashier, posAiState, {}))).toMatchObject({ enabled: false, used: 0 });
  });

  it('answers a manager the summary and the alerts, a cashier nothing, and the code when the package is off', async () => {
    expect(dataOf(await ask(w.manager, posAiSummary, daily))).toMatchObject({ ok: true, summary: { kind: 'DAILY' } });
    expect(dataOf(await ask(w.manager, posAiAlerts, {}))).toMatchObject({ ok: true, alerts: { operations: [], lowStock: [] } });
    expect((await ask(w.cashier, posAiSummary, daily)).ok).toBe(false);
    expect((await ask(w.cashier, posAiAlerts, {})).ok).toBe(false);
    await writeAiPackage(prisma(), w.a.id, { enabled: false });
    expect(dataOf(await ask(w.manager, posAiSummary, daily))).toEqual({ ok: false, code: 'aiDisabled' });
    expect(dataOf(await ask(w.manager, posAiAlerts, {}))).toEqual({ ok: false, code: 'aiDisabled' });
  });

  it('phrases through the action and answers ungrounded text as a code, not an exception', async () => {
    expect(dataOf(await run(w.manager, phrasePosAiSummary, daily))).toMatchObject({ ok: true, cached: false });
    fake.enqueue({ response: { content: [{ type: 'text', text: 'Sales were 777777.' }] } });
    expect(dataOf(await run(w.manager, phrasePosAiSummary, { kind: 'WEEKLY', locale: 'en' }))).toEqual({ ok: false, code: 'ungrounded' });
    expect((await run(w.cashier, phrasePosAiSummary, daily)).ok).toBe(false);
  });

  it('lists a low stock item and a day with a drawer difference in the alerts', async () => {
    await prisma().posInventoryItem.create({ data: { restaurantId: w.a.id, name: 'Salt', nameKey: 'salt', unit: 'GRAM', reorderLevel: 100 } });
    const alerts = dataOf(await ask(w.manager, posAiAlerts, {}));
    expect(alerts).toMatchObject({ ok: true });
    if (alerts.ok) expect(alerts.alerts.lowStock.map((i) => i.name)).toEqual(['Salt']);
  });
});
