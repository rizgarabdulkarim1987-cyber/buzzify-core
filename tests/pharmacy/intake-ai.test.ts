import { createHash } from 'node:crypto';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { AiProviderError } from '@/server/ai/errors';
import { FakeProvider } from '@/server/ai/provider/fake';
import type { AiRequest, AiResponse } from '@/server/ai/provider/types';
import { parseAiPricingEnv } from '@/server/env';
import { estimateCostMicroUsd } from '@/server/domain/pharmacy/intake';
import type { PhRole } from '@/server/domain/pharmacy/permissions';
import {
  claimFileForExtraction,
  estimateInputTokens,
  reclaimStaleReservations,
  releaseFile,
  runPharmacyAi,
  usageView,
  worstCaseMicroUsd,
  type AiPricing,
  type RunArgs,
} from '@/server/pharmacy/intake/ai';
import * as intakeQueries from '@/server/pharmacy/queries/intake';
import { asPh, NOW, person, pharmacy, prisma, resetWorld, useTestDatabase } from './fixture';
import { ask, codeOf, dataOf } from './stock-helpers';

/** One micro-dollar per token, both ways: a call whose tokens add up to 10,000 costs exactly one cent. */
const PRICE: AiPricing = { inputPerMtok: 1_000_000n, outputPerMtok: 1_000_000n };
const CENT = 10_000n;
const MIN = 60_000;
const REQ: Omit<AiRequest, 'signal' | 'maxTokens' | 'purpose'> = {
  system: 'Extract the invoice.',
  messages: [{ role: 'user', content: [{ type: 'text', text: 'INVOICE-SECRET-TEXT 12 x Panadol' }] }],
};
/** The output cap that makes the worst case of REQ exactly one cent. */
const ONE_CENT_OUT = 10_000 - estimateInputTokens(REQ);

let fileSeq = 0;
const fid = () => `file-${(fileSeq += 1)}-ai`;

/** A fake model that waits before it answers, so calls overlap; counts what reached it. */
class SlowFake extends FakeProvider {
  reached = 0;
  constructor(private readonly delayMs = 0) {
    super();
  }
  override async complete(req: AiRequest): Promise<AiResponse> {
    this.reached += 1;
    if (this.delayMs) await new Promise((r) => setTimeout(r, this.delayMs));
    return super.complete(req);
  }
}

async function world(opts: { budgetCents?: number; subscription?: 'ACTIVE' | 'none' } = {}) {
  const a = await pharmacy('A', { branches: 2, ...(opts.subscription ? { subscription: opts.subscription } : {}) });
  await prisma().appPlan.create({
    data: { applicationId: 'pharmacy', code: 'standard', name: { en: 'Standard' }, limits: { branches: 5, users: 20, storageMb: 50, aiMonthlyBudgetMinor: opts.budgetCents ?? 100 } },
  });
  const [b1, b2] = a.branchIds as [string, string];
  const staff = (label: string, role: PhRole, branches = [b1]) => person(label, { staff: [a.id, role, branches] });
  const owner = await person('owner', { membership: [a.id, 'OWNER'] });
  return {
    a,
    b1,
    b2,
    owner,
    pic: await staff('pic', 'PHARMACIST_IN_CHARGE'),
    manager: await staff('manager', 'BRANCH_MANAGER', [b1, b2]),
    accountant: await staff('accountant', 'ACCOUNTANT'),
    stock: await staff('stock', 'STOCK'),
    cashier: await staff('cashier', 'CASHIER'),
    pharmacist: await staff('pharmacist', 'PHARMACIST'),
  };
}
type World = Awaited<ReturnType<typeof world>>;

const call = (w: World, over: Partial<RunArgs> = {}, opts: Parameters<typeof runPharmacyAi>[2] = {}) =>
  runPharmacyAi(prisma(), { restaurantId: w.a.id, fileId: fid(), purpose: 'extract', input: REQ, maxOutputTokens: ONE_CENT_OUT, now: NOW, ...over }, { pricing: PRICE, ...opts });

const usageRow = (w: World, month = '2026-10') => prisma().phAiUsageMonth.findUnique({ where: { restaurantId_month: { restaurantId: w.a.id, month } } });
const calls = (w: World) => prisma().phAiCall.findMany({ where: { restaurantId: w.a.id }, orderBy: { createdAt: 'asc' } });

/** A real batch and file, straight in the database, in the given state. */
async function seedFile(w: World, status: 'UPLOADED' | 'EXTRACTING' | 'EXTRACTED' | 'FAILED', since?: Date) {
  const n = (fileSeq += 1);
  const batch = await prisma().phIntakeBatch.create({ data: { restaurantId: w.a.id, branchId: w.b1, clientKey: `ai-batch-${n}-aaaa`, payloadHash: 'x', createdById: w.owner.userId }, select: { id: true } });
  const file = await prisma().phIntakeFile.create({
    data: {
      restaurantId: w.a.id,
      batchId: batch.id,
      sha256: createHash('sha256').update(`ai-file-${n}`).digest('hex'),
      storageKey: `intake/${w.a.id}/ai-${n}`,
      mediaType: 'application/pdf',
      bytes: 100,
      pages: 1,
      status,
      ...(status === 'EXTRACTING' ? { extractingSince: since ?? NOW } : {}),
      ...(status === 'FAILED' ? { failureCode: 'AI_TIMEOUT' } : {}),
      expiresAt: new Date(NOW.getTime() + 30 * 86_400_000),
      uploadedById: w.owner.userId,
    },
    select: { id: true },
  });
  return file.id;
}

/** An open reservation, with the pool's `reserved` raised to match, as a crashed worker leaves it. */
async function seedReservation(w: World, fileId: string, microUsd: bigint, createdAt: Date, month = '2026-10') {
  await prisma().phAiUsageMonth.upsert({
    where: { restaurantId_month: { restaurantId: w.a.id, month } },
    create: { restaurantId: w.a.id, month, reservedMicroUsd: microUsd },
    update: { reservedMicroUsd: { increment: microUsd } },
  });
  await prisma().phAiReservation.create({ data: { restaurantId: w.a.id, month, microUsd, fileId, createdAt } });
}

beforeAll(() => {
  useTestDatabase();
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(NOW);
});
afterAll(() => {
  vi.useRealTimers();
});
beforeEach(async () => {
  await resetWorld();
});
afterEach(() => {
  vi.setSystemTime(NOW);
});

describe('the pricing environment', () => {
  it('has no defaults: both prices or neither, positive whole numbers', () => {
    expect(parseAiPricingEnv({})).toBeNull();
    expect(parseAiPricingEnv({ AI_PRICE_INPUT_USD_MICRO_PER_MTOK: '', AI_PRICE_OUTPUT_USD_MICRO_PER_MTOK: '  ' })).toBeNull();
    expect(parseAiPricingEnv({ AI_PRICE_INPUT_USD_MICRO_PER_MTOK: '3000000', AI_PRICE_OUTPUT_USD_MICRO_PER_MTOK: '15000000' })).toEqual({ inputPerMtok: 3_000_000n, outputPerMtok: 15_000_000n });
    expect(() => parseAiPricingEnv({ AI_PRICE_INPUT_USD_MICRO_PER_MTOK: '3000000' })).toThrow(/AI_PRICE_OUTPUT_USD_MICRO_PER_MTOK/);
    expect(() => parseAiPricingEnv({ AI_PRICE_OUTPUT_USD_MICRO_PER_MTOK: '3000000' })).toThrow(/AI_PRICE_INPUT_USD_MICRO_PER_MTOK/);
    for (const bad of ['0', '-5', '1.5', '3e6', 'abc']) {
      expect(() => parseAiPricingEnv({ AI_PRICE_INPUT_USD_MICRO_PER_MTOK: bad, AI_PRICE_OUTPUT_USD_MICRO_PER_MTOK: '1' })).toThrow();
    }
  });
});

describe('refusals before any provider call', () => {
  it('refuses when no pricing is set, with zero provider calls and nothing reserved', async () => {
    const w = await world();
    const provider = new SlowFake();
    vi.stubEnv('AI_PRICE_INPUT_USD_MICRO_PER_MTOK', '');
    vi.stubEnv('AI_PRICE_OUTPUT_USD_MICRO_PER_MTOK', '');
    const result = await runPharmacyAi(prisma(), { restaurantId: w.a.id, fileId: fid(), purpose: 'extract', input: REQ, maxOutputTokens: 100, now: NOW }, { provider });
    expect(result).toEqual({ ok: false, code: 'AI_PRICING_NOT_SET' });
    expect(provider.reached).toBe(0);
    expect(await usageRow(w)).toBeNull();
    vi.unstubAllEnvs();
  });

  it('refuses a plan with no AI budget, and a business with no live plan', async () => {
    const zero = await world({ budgetCents: 0 });
    const provider = new SlowFake();
    expect(await call(zero, {}, { provider })).toEqual({ ok: false, code: 'AI_NOT_IN_PLAN' });
    expect(provider.reached).toBe(0);
    expect(await usageRow(zero)).toBeNull();
    await resetWorld();
    const none = await world({ subscription: 'none' });
    expect(await call(none, {}, { provider })).toEqual({ ok: false, code: 'AI_NOT_IN_PLAN' });
    expect(provider.reached).toBe(0);
  });
});

describe('a call that works', () => {
  it('settles the exact cost, clears the reservation and logs metadata only', async () => {
    const w = await world();
    const provider = new SlowFake();
    provider.enqueue({ response: { content: [{ type: 'text', text: '{"lines":[]}' }], inputTokens: 700, outputTokens: 300, model: 'fake-model' } });
    const fileId = fid();
    const result = await call(w, { fileId }, { provider });
    const cost = estimateCostMicroUsd({ inputTokens: 700, outputTokens: 300 }, PRICE);
    expect(cost).toBe(1000n);
    expect(result).toMatchObject({ ok: true, text: '{"lines":[]}', costMicroUsd: cost, overrunMicroUsd: 0n, usage: { inputTokens: 700, outputTokens: 300 } });
    const row = await usageRow(w);
    expect(row).toMatchObject({ spentMicroUsd: cost, reservedMicroUsd: 0n, calls: 1, inputTokens: 700n, outputTokens: 300n });
    expect(await prisma().phAiReservation.count()).toBe(0);
    const logged = await calls(w);
    expect(logged).toHaveLength(1);
    expect(logged[0]).toMatchObject({ purpose: 'extract', model: 'fake-model', status: 'OK', costMicroUsd: cost, fileId, inputTokens: 700, outputTokens: 300 });
    expect(logged[0]!.ms).toBeGreaterThanOrEqual(0);
  });

  it('charges the worst case when the provider reports no usage', async () => {
    const w = await world();
    const provider = new SlowFake();
    provider.enqueue({ response: { content: [{ type: 'text', text: '{}' }], inputTokens: 0, outputTokens: 0 } });
    const result = await call(w, {}, { provider });
    expect(result).toMatchObject({ ok: true, costMicroUsd: CENT });
    expect(await usageRow(w)).toMatchObject({ spentMicroUsd: CENT, reservedMicroUsd: 0n });
  });

  it('charges the reserved amount and keeps the paid answer when the actual cost is above it', async () => {
    const w = await world();
    const provider = new SlowFake();
    provider.enqueue({ response: { content: [{ type: 'text', text: 'PAID-ANSWER' }], inputTokens: 20_000, outputTokens: 5_000 } });
    const result = await call(w, {}, { provider });
    expect(worstCaseMicroUsd(REQ, ONE_CENT_OUT, PRICE)).toBe(CENT);
    expect(result).toMatchObject({ ok: true, text: 'PAID-ANSWER', costMicroUsd: CENT, overrunMicroUsd: 15_000n });
    expect(await usageRow(w)).toMatchObject({ spentMicroUsd: CENT, reservedMicroUsd: 0n });
    expect((await calls(w))[0]).toMatchObject({ status: 'OK', costMicroUsd: CENT });
  });
});

describe('a call that fails', () => {
  it('releases the reservation on a provider error and logs ERROR at cost 0', async () => {
    const w = await world();
    const provider = new SlowFake();
    provider.enqueue('error');
    const fileId = fid();
    expect(await call(w, { fileId }, { provider })).toEqual({ ok: false, code: 'AI_PROVIDER_ERROR' });
    expect(await usageRow(w)).toMatchObject({ spentMicroUsd: 0n, reservedMicroUsd: 0n });
    expect(await prisma().phAiReservation.count()).toBe(0);
    expect((await calls(w))[0]).toMatchObject({ status: 'ERROR', costMicroUsd: 0n, fileId });
  });

  it('maps a provider timeout and a local abort to AI_TIMEOUT, both free', async () => {
    const w = await world();
    const provider = new SlowFake();
    provider.enqueue('timeout');
    expect(await call(w, {}, { provider })).toEqual({ ok: false, code: 'AI_TIMEOUT' });
    const hanging = new SlowFake();
    hanging.complete = (req: AiRequest) =>
      new Promise<AiResponse>((_, reject) => {
        req.signal.addEventListener('abort', () => reject(req.signal.reason));
      });
    expect(await call(w, {}, { provider: hanging, timeoutMs: 30 })).toEqual({ ok: false, code: 'AI_TIMEOUT' });
    expect(await usageRow(w)).toMatchObject({ spentMicroUsd: 0n, reservedMicroUsd: 0n });
    expect((await calls(w)).map((c) => [c.status, c.costMicroUsd])).toEqual([['TIMEOUT', 0n], ['TIMEOUT', 0n]]);
  });

  it('refusal is AI_REFUSED and costs what the provider reported', async () => {
    const w = await world();
    const provider = new SlowFake();
    provider.enqueue({ response: { stop: 'refusal', content: [], inputTokens: 400, outputTokens: 0 } });
    expect(await call(w, {}, { provider })).toEqual({ ok: false, code: 'AI_REFUSED' });
    expect(await usageRow(w)).toMatchObject({ spentMicroUsd: 400n, reservedMicroUsd: 0n });
    expect((await calls(w))[0]).toMatchObject({ status: 'ERROR', costMicroUsd: 400n });
  });

  it('a caller-side abort is a clean failure that releases the reservation', async () => {
    const w = await world();
    const hanging = new SlowFake();
    hanging.complete = (req: AiRequest) =>
      new Promise<AiResponse>((_, reject) => {
        req.signal.addEventListener('abort', () => reject(new AiProviderError()));
      });
    const controller = new AbortController();
    const running = call(w, {}, { provider: hanging, signal: controller.signal });
    await vi.waitFor(async () => expect((await usageRow(w))?.reservedMicroUsd).toBe(CENT));
    controller.abort();
    expect(await running).toEqual({ ok: false, code: 'AI_PROVIDER_ERROR' });
    expect(await usageRow(w)).toMatchObject({ spentMicroUsd: 0n, reservedMicroUsd: 0n });
  });
});

describe('the budget stops', () => {
  it('lets exactly N worst-case calls through when N+3 fire at once, and never exceeds the budget', async () => {
    const N = 4;
    const w = await world({ budgetCents: N });
    const provider = new SlowFake(150);
    let peak = 0n;
    let polling = true;
    const poller = (async () => {
      while (polling) {
        const row = await usageRow(w);
        if (row) peak = row.spentMicroUsd + row.reservedMicroUsd > peak ? row.spentMicroUsd + row.reservedMicroUsd : peak;
        await new Promise((r) => setTimeout(r, 3));
      }
    })();
    const results = await Promise.all(Array.from({ length: N + 3 }, () => call(w, {}, { provider })));
    polling = false;
    await poller;
    expect(provider.reached).toBe(N);
    expect(results.filter((r) => r.ok)).toHaveLength(N);
    expect(results.filter((r) => !r.ok).map((r) => (r.ok ? '' : r.code))).toEqual(Array(3).fill('AI_BUDGET_REACHED'));
    expect(peak).toBeLessThanOrEqual(BigInt(N) * CENT);
    expect(peak).toBeGreaterThan(0n);
    const row = await usageRow(w);
    expect(row!.reservedMicroUsd).toBe(0n);
    expect(row!.spentMicroUsd).toBeLessThanOrEqual(BigInt(N) * CENT);
  });

  it('counts spent plus the worst case: a cheap first call still leaves too little for the next worst case, and the refusal is logged as BUDGET', async () => {
    const w = await world({ budgetCents: 1 });
    const provider = new SlowFake();
    provider.enqueue({ response: { content: [{ type: 'text', text: '{}' }], inputTokens: 100, outputTokens: 100 } });
    expect((await call(w, {}, { provider })).ok).toBe(true);
    const fileId = fid();
    expect(await call(w, { fileId }, { provider })).toEqual({ ok: false, code: 'AI_BUDGET_REACHED' });
    expect(provider.reached).toBe(1);
    expect(await usageRow(w)).toMatchObject({ spentMicroUsd: 200n, reservedMicroUsd: 0n, calls: 1 });
    expect((await calls(w)).map((c) => [c.status, c.costMicroUsd, c.fileId === fileId])).toEqual([['OK', 200n, false], ['BUDGET', 0n, true]]);
    expect(await prisma().phAiReservation.count()).toBe(0);
  });

  it('allows one call in flight per file', async () => {
    const w = await world();
    const provider = new SlowFake(120);
    const fileId = fid();
    const [x, y] = await Promise.all([call(w, { fileId }, { provider }), call(w, { fileId }, { provider })]);
    expect([x.ok, y.ok].sort()).toEqual([false, true]);
    expect([x, y].find((r) => !r.ok)).toEqual({ ok: false, code: 'EXTRACTION_IN_PROGRESS' });
    expect(provider.reached).toBe(1);
    expect(await usageRow(w)).toMatchObject({ reservedMicroUsd: 0n });
    expect(await prisma().phAiReservation.count()).toBe(0);
  });

  it('replaces a reservation older than the lease, returning its funds first', async () => {
    const w = await world({ budgetCents: 1 });
    const fileId = fid();
    await seedReservation(w, fileId, CENT, new Date(NOW.getTime() - 11 * MIN));
    const provider = new SlowFake();
    const result = await call(w, { fileId }, { provider });
    expect(result.ok).toBe(true);
    expect((await usageRow(w))!.reservedMicroUsd).toBe(0n);
    expect(await prisma().phAiReservation.count()).toBe(0);
  });
});

describe('reclaiming reservations', () => {
  it('returns the funds of reservations whose file is not extracting or whose lease is stale, and counts none as spend', async () => {
    const w = await world();
    const live = await seedFile(w, 'EXTRACTING', new Date(NOW.getTime() - 2 * MIN));
    const stale = await seedFile(w, 'EXTRACTING', new Date(NOW.getTime() - 11 * MIN));
    const done = await seedFile(w, 'UPLOADED');
    for (const id of [live, stale, done]) await seedReservation(w, id, 2000n, new Date(NOW.getTime() - MIN));
    expect((await usageRow(w))!.reservedMicroUsd).toBe(6000n);
    const out = await reclaimStaleReservations(prisma(), NOW, 10 * MIN);
    expect(out).toEqual({ released: 2, microUsd: 4000n });
    const row = await usageRow(w);
    expect(row).toMatchObject({ reservedMicroUsd: 2000n, spentMicroUsd: 0n });
    expect((await prisma().phAiReservation.findMany({ select: { fileId: true } })).map((r) => r.fileId)).toEqual([live]);
    // Nothing more to do on a second run.
    expect(await reclaimStaleReservations(prisma(), NOW, 10 * MIN)).toEqual({ released: 0, microUsd: 0n });
  });

  it('a stale extracting file is claimable again after the reclaim', async () => {
    const w = await world();
    const stale = await seedFile(w, 'EXTRACTING', new Date(NOW.getTime() - 11 * MIN));
    await seedReservation(w, stale, 2000n, new Date(NOW.getTime() - 11 * MIN));
    await reclaimStaleReservations(prisma(), NOW, 10 * MIN);
    expect(await claimFileForExtraction(prisma(), w.a.id, stale, NOW)).toBe(true);
    const file = await prisma().phIntakeFile.findUniqueOrThrow({ where: { id: stale } });
    expect(file).toMatchObject({ status: 'EXTRACTING', attempts: 1 });
    expect(file.extractingSince?.getTime()).toBe(NOW.getTime());
  });
});

describe('the Baghdad month', () => {
  it('books 21:30 UTC on the 31st into the next month, in its own row', async () => {
    const w = await world();
    const provider = new SlowFake();
    expect((await call(w, {}, { provider })).ok).toBe(true);
    const lateOct = new Date('2026-10-31T20:59:00.000Z');
    const nov = new Date('2026-10-31T21:30:00.000Z');
    expect((await call(w, { now: lateOct }, { provider })).ok).toBe(true);
    expect((await call(w, { now: nov }, { provider })).ok).toBe(true);
    expect((await usageRow(w, '2026-10'))!.calls).toBe(2);
    expect((await usageRow(w, '2026-11'))!.calls).toBe(1);
  });
});

describe('claiming a file for extraction', () => {
  it('lets exactly one of two racing claims win, and stamps the lease and attempt', async () => {
    const w = await world();
    const id = await seedFile(w, 'UPLOADED');
    const [x, y] = await Promise.all([claimFileForExtraction(prisma(), w.a.id, id, NOW), claimFileForExtraction(prisma(), w.a.id, id, NOW)]);
    expect([x, y].sort()).toEqual([false, true]);
    const file = await prisma().phIntakeFile.findUniqueOrThrow({ where: { id } });
    expect(file).toMatchObject({ status: 'EXTRACTING', attempts: 1 });
    expect(file.extractingSince?.getTime()).toBe(NOW.getTime());
  });

  it('claims UPLOADED and FAILED, not EXTRACTED, not a fresh lease, not another business', async () => {
    const w = await world();
    const failed = await seedFile(w, 'FAILED');
    expect(await claimFileForExtraction(prisma(), w.a.id, failed, NOW)).toBe(true);
    expect((await prisma().phIntakeFile.findUniqueOrThrow({ where: { id: failed } })).failureCode).toBeNull();
    const extracted = await seedFile(w, 'EXTRACTED');
    expect(await claimFileForExtraction(prisma(), w.a.id, extracted, NOW)).toBe(false);
    const fresh = await seedFile(w, 'EXTRACTING', new Date(NOW.getTime() - MIN));
    expect(await claimFileForExtraction(prisma(), w.a.id, fresh, NOW)).toBe(false);
    const own = await seedFile(w, 'UPLOADED');
    expect(await claimFileForExtraction(prisma(), 'someone-else', own, NOW)).toBe(false);
    expect(await claimFileForExtraction(prisma(), w.a.id, 'no-such-file', NOW)).toBe(false);
  });

  it('releases a claimed file to EXTRACTED, FAILED (with a code) or back to UPLOADED, clearing the lease', async () => {
    const w = await world();
    const a = await seedFile(w, 'UPLOADED');
    await claimFileForExtraction(prisma(), w.a.id, a, NOW);
    expect(await releaseFile(prisma(), w.a.id, a, { status: 'EXTRACTED', now: NOW })).toBe(true);
    expect(await prisma().phIntakeFile.findUniqueOrThrow({ where: { id: a } })).toMatchObject({ status: 'EXTRACTED', extractingSince: null, failureCode: null, extractedAt: NOW });
    const b = await seedFile(w, 'UPLOADED');
    await claimFileForExtraction(prisma(), w.a.id, b, NOW);
    expect(await releaseFile(prisma(), w.a.id, b, { status: 'FAILED', failureCode: 'AI_TIMEOUT', now: NOW })).toBe(true);
    expect(await prisma().phIntakeFile.findUniqueOrThrow({ where: { id: b } })).toMatchObject({ status: 'FAILED', extractingSince: null, failureCode: 'AI_TIMEOUT' });
    const c = await seedFile(w, 'UPLOADED');
    await claimFileForExtraction(prisma(), w.a.id, c, NOW);
    expect(await releaseFile(prisma(), w.a.id, c, { status: 'UPLOADED', now: NOW })).toBe(true);
    expect(await prisma().phIntakeFile.findUniqueOrThrow({ where: { id: c } })).toMatchObject({ status: 'UPLOADED', extractingSince: null });
    // A file that is not being extracted is left alone.
    expect(await releaseFile(prisma(), w.a.id, c, { status: 'EXTRACTED', now: NOW })).toBe(false);
  });
});

describe('what is kept', () => {
  it('has no prompt or answer column, and none of the invoice text lands in any row', async () => {
    const w = await world();
    const provider = new SlowFake();
    provider.enqueue({ response: { content: [{ type: 'text', text: 'ANSWER-WITH-SUPPLIER-NAME' }], inputTokens: 50, outputTokens: 50 } });
    await call(w, {}, { provider });
    // eslint-disable-next-line no-restricted-properties -- schema introspection, no tenant rows
    const columns = await prisma().$queryRaw<{ column_name: string }[]>`SELECT column_name FROM information_schema.columns WHERE table_name = 'PhAiCall' ORDER BY column_name`;
    expect(columns.map((c) => c.column_name).sort()).toEqual(['costMicroUsd', 'createdAt', 'fileId', 'id', 'inputTokens', 'model', 'ms', 'outputTokens', 'purpose', 'restaurantId', 'status']);
    const dump = JSON.stringify(
      [await prisma().phAiCall.findMany(), await prisma().phAiUsageMonth.findMany(), await prisma().phAiReservation.findMany(), await prisma().auditLog.findMany()],
      (_k, v) => (typeof v === 'bigint' ? v.toString() : v),
    );
    expect(dump).not.toContain('INVOICE-SECRET-TEXT');
    expect(dump).not.toContain('ANSWER-WITH-SUPPLIER-NAME');
  });
});

describe('the usage query', () => {
  const at = (w: World) => ({ restaurantId: w.a.id, branchId: w.b1 });

  it('shows the month, budget, spend and tokens as strings to a role with purchase.manage and report.view', async () => {
    const w = await world({ budgetCents: 5 });
    const provider = new SlowFake();
    provider.enqueue({ response: { content: [{ type: 'text', text: '{}' }], inputTokens: 700, outputTokens: 300 } });
    await call(w, {}, { provider });
    await seedReservation(w, fid(), 2000n, NOW);
    for (const who of [w.owner, w.pic, w.manager, w.accountant]) {
      const view = dataOf(await ask(who, intakeQueries.usage, at(w)));
      expect(view).toEqual({
        month: '2026-10',
        budgetMicroUsd: '50000',
        spentMicroUsd: '1000',
        reservedMicroUsd: '2000',
        remainingMicroUsd: '47000',
        calls: 1,
        inputTokens: '700',
        outputTokens: '300',
      });
    }
  });

  it('is empty (zeros) before any call, and refuses the roles without both permissions', async () => {
    const w = await world({ budgetCents: 5 });
    expect(dataOf(await ask(w.owner, intakeQueries.usage, at(w)))).toMatchObject({ month: '2026-10', budgetMicroUsd: '50000', spentMicroUsd: '0', remainingMicroUsd: '50000', calls: 0 });
    for (const who of [w.cashier, w.pharmacist, w.stock]) expect(codeOf(await ask(who, intakeQueries.usage, at(w)))).toBe('FORBIDDEN');
  });

  it('leaves the money keys out for an actor without cost.view, keeping counts', async () => {
    const w = await world({ budgetCents: 5 });
    const ph = (await asPh(w.pic.userId, w.a.id, w.b1))!;
    const scoped = (await import('@/server/data/tenant-db')).scopedClient(prisma(), { restaurantId: w.a.id, allBranches: true });
    const view = await usageView(scoped, { ...ph, role: 'PHARMACIST' } as typeof ph, NOW);
    expect(view).toEqual({ month: '2026-10', calls: 0, inputTokens: '0', outputTokens: '0' });
  });
});
