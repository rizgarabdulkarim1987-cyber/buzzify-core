import { createHash } from 'node:crypto';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { AiProviderError } from '@/server/ai/errors';
import { FakeProvider } from '@/server/ai/provider/fake';
import { setAiProviderForTests } from '@/server/ai/provider';
import { createAnthropicProvider } from '@/server/ai/provider/anthropic';
import { modelFor } from '@/server/ai/provider/models';
import { createOpenAiProvider, openAiModelFor } from '@/server/ai/provider/openai';
import type { AiRequest, AiResponse } from '@/server/ai/provider/types';
import { parseAiPricingEnv } from '@/server/env';
import { estimateCostMicroUsd, fitsContext, INPUT_BOUND, inputTokensUpperBound } from '@/server/domain/pharmacy/intake';
import type { PhRole } from '@/server/domain/pharmacy/permissions';
import {
  claimFileForExtraction,
  estimateInputTokens,
  releaseFile,
  runPharmacyAi,
  sweepAiReservations,
  usageView,
  worstCaseMicroUsd,
  type AiPricing,
  type CallAudit,
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
const ONE_CENT_OUT = 10_000 - estimateInputTokens(REQ)!;
/** What a timeout or abort books: the input side of the worst case (output cost removed). */
const INPUT_SIDE = BigInt(estimateInputTokens(REQ)!);

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

/** A fake model that holds every call at the gate until `release()`: calls overlap with no timing assumptions. */
class GatedFake extends FakeProvider {
  reached = 0;
  private open!: () => void;
  private readonly gate = new Promise<void>((resolve) => {
    this.open = resolve;
  });
  release() {
    this.open();
  }
  override async complete(req: AiRequest): Promise<AiResponse> {
    this.reached += 1;
    await this.gate;
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

/** A call on a file this test claimed (EXTRACTING since NOW) unless it names one. */
const call = async (w: World, over: Partial<RunArgs> = {}, opts: Parameters<typeof runPharmacyAi>[2] = {}) => {
  const fileId = over.fileId ?? (await seedFile(w, 'EXTRACTING', NOW));
  return runPharmacyAi(prisma(), { restaurantId: w.a.id, fileId, lease: NOW, purpose: 'extract', input: REQ, maxOutputTokens: ONE_CENT_OUT, now: NOW, ...over }, { pricing: PRICE, ...opts });
};

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
  it('has no defaults: the two prices and the model they are for, all or none, prices positive whole numbers', () => {
    const full = { AI_PRICE_INPUT_USD_MICRO_PER_MTOK: '3000000', AI_PRICE_OUTPUT_USD_MICRO_PER_MTOK: '15000000', AI_PRICE_MODEL: 'claude-opus-5-5' };
    expect(parseAiPricingEnv({})).toBeNull();
    expect(parseAiPricingEnv({ AI_PRICE_INPUT_USD_MICRO_PER_MTOK: '', AI_PRICE_OUTPUT_USD_MICRO_PER_MTOK: '  ', AI_PRICE_MODEL: ' ' })).toBeNull();
    expect(parseAiPricingEnv(full)).toEqual({ inputPerMtok: 3_000_000n, outputPerMtok: 15_000_000n, model: 'claude-opus-5-5' });
    expect(() => parseAiPricingEnv({ ...full, AI_PRICE_OUTPUT_USD_MICRO_PER_MTOK: '' })).toThrow(/AI_PRICE_OUTPUT_USD_MICRO_PER_MTOK/);
    expect(() => parseAiPricingEnv({ ...full, AI_PRICE_INPUT_USD_MICRO_PER_MTOK: '' })).toThrow(/AI_PRICE_INPUT_USD_MICRO_PER_MTOK/);
    // prices without the model they are for are as good as none: the price must say which model it prices
    expect(() => parseAiPricingEnv({ ...full, AI_PRICE_MODEL: '' })).toThrow(/AI_PRICE_MODEL/);
    expect(() => parseAiPricingEnv({ AI_PRICE_MODEL: 'claude-opus-5-5' })).toThrow(/AI_PRICE_INPUT_USD_MICRO_PER_MTOK/);
    for (const bad of ['0', '-5', '1.5', '3e6', 'abc']) {
      expect(() => parseAiPricingEnv({ ...full, AI_PRICE_INPUT_USD_MICRO_PER_MTOK: bad, AI_PRICE_OUTPUT_USD_MICRO_PER_MTOK: '1' })).toThrow();
    }
  });

  it('the Anthropic and OpenAI providers say which model they use for extraction (what the price is checked against)', () => {
    expect(createAnthropicProvider('k'.repeat(30), { ask: 'my-claude' }).modelFor?.('extract')).toBe('my-claude');
    expect(createAnthropicProvider('k'.repeat(30)).modelFor?.('extract')).toBe(modelFor('extract'));
    expect(createOpenAiProvider('k'.repeat(30), { ask: 'my-gpt' }).modelFor?.('extract')).toBe('my-gpt');
    expect(createOpenAiProvider('k'.repeat(30)).modelFor?.('extract')).toBe(openAiModelFor('extract'));
  });
});

describe('the input size bound (pure)', () => {
  it('counts text by bytes (a token is at least a byte), an image by its stored size capped, a PDF by its pages, plus the overhead', () => {
    expect(inputTokensUpperBound(0, [])).toBe(INPUT_BOUND.overheadTokens);
    expect(inputTokensUpperBound(3_000, [])).toBe(3_000 + INPUT_BOUND.overheadTokens);
    expect(inputTokensUpperBound(Buffer.byteLength('فاتورة'.repeat(100)), [])).toBe(Buffer.byteLength('فاتورة'.repeat(100)) + INPUT_BOUND.overheadTokens);
    expect(inputTokensUpperBound(0, [{ kind: 'image', widthPx: 100, heightPx: 75 }])).toBe(INPUT_BOUND.overheadTokens + 2 * 10);
    expect(inputTokensUpperBound(0, [{ kind: 'image', widthPx: 4000, heightPx: 6000 }])).toBe(INPUT_BOUND.overheadTokens + INPUT_BOUND.imageTokensMax);
    expect(inputTokensUpperBound(0, [{ kind: 'pdf', pages: 10 }])).toBe(INPUT_BOUND.overheadTokens + 10 * INPUT_BOUND.pdfPageTokensMax);
  });

  it('cannot bound a missing, zero, fractional or absurd hint, or an eleven page PDF', () => {
    for (const bad of [{ kind: 'image', widthPx: 0, heightPx: 10 }, { kind: 'image', widthPx: 1.5, heightPx: 10 }, { kind: 'pdf', pages: 11 }, { kind: 'pdf', pages: 0 }] as const) {
      expect(inputTokensUpperBound(10, [bad])).toBeNull();
    }
    expect(inputTokensUpperBound(-1, [])).toBeNull();
    expect(fitsContext(INPUT_BOUND.contextTokens - 100, 100)).toBe(true);
    expect(fitsContext(INPUT_BOUND.contextTokens - 100, 101)).toBe(false);
  });
});

describe('refusals before any provider call', () => {
  it('refuses when no pricing is set, with zero provider calls and nothing reserved', async () => {
    const w = await world();
    const provider = new SlowFake();
    vi.stubEnv('AI_PRICE_INPUT_USD_MICRO_PER_MTOK', '');
    vi.stubEnv('AI_PRICE_OUTPUT_USD_MICRO_PER_MTOK', '');
    const fileId = await seedFile(w, 'EXTRACTING');
    const result = await runPharmacyAi(prisma(), { restaurantId: w.a.id, fileId, lease: NOW, purpose: 'extract', input: REQ, maxOutputTokens: 100, now: NOW }, { provider });
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

  it('refuses a file whose hints do not match its media parts, or that cannot fit the model, before reserving', async () => {
    const w = await world();
    const provider = new SlowFake();
    const pdfPart = { type: 'document' as const, mediaType: 'application/pdf' as const, base64: 'AAAA' };
    const withPdf = { ...REQ, messages: [{ role: 'user' as const, content: [...REQ.messages[0]!.content, pdfPart] }] };
    expect(await call(w, { input: withPdf }, { provider })).toEqual({ ok: false, code: 'AI_INPUT_TOO_LARGE' });
    expect(await call(w, { media: [{ kind: 'pdf', pages: 1 }] }, { provider })).toEqual({ ok: false, code: 'AI_INPUT_TOO_LARGE' });
    expect(await call(w, { input: withPdf, media: [{ kind: 'pdf', pages: 11 }] }, { provider })).toEqual({ ok: false, code: 'AI_INPUT_TOO_LARGE' });
    expect(await call(w, { maxOutputTokens: INPUT_BOUND.contextTokens }, { provider })).toEqual({ ok: false, code: 'AI_INPUT_TOO_LARGE' });
    expect(provider.reached).toBe(0);
    expect(await usageRow(w)).toBeNull();
    expect(await calls(w)).toHaveLength(0);
  });
});

describe('real sized files against a normal budget', () => {
  it('an 8 MB image part and a 10-page PDF part are bounded by their stored size, not their bytes, and fit a 100-cent budget', async () => {
    const w = await world({ budgetCents: 100 });
    const provider = new SlowFake();
    const eightMb = Buffer.alloc(8 * 1024 * 1024, 7).toString('base64');
    const image = { ...REQ, messages: [{ role: 'user' as const, content: [...REQ.messages[0]!.content, { type: 'image' as const, mediaType: 'image/jpeg' as const, base64: eightMb }] }] };
    const pdf = { ...REQ, messages: [{ role: 'user' as const, content: [...REQ.messages[0]!.content, { type: 'document' as const, mediaType: 'application/pdf' as const, base64: eightMb }] }] };
    const hintImage = [{ kind: 'image', widthPx: 3000, heightPx: 4000 }] as const;
    const hintPdf = [{ kind: 'pdf', pages: 10 }] as const;
    const imageTokens = estimateInputTokens(image, hintImage)!;
    const pdfTokens = estimateInputTokens(pdf, hintPdf)!;
    expect(imageTokens).toBeLessThan(5_000);
    expect(pdfTokens).toBeGreaterThan(90_000);
    expect(pdfTokens).toBeLessThan(95_000);
    const real: AiPricing = { inputPerMtok: 5_000_000n, outputPerMtok: 25_000_000n };
    expect(worstCaseMicroUsd(pdf, 8_000, real, hintPdf)!).toBeLessThan(1_000_000n);
    // what a real provider reports for such a page (the fake would count the 8 MB of base64 as text)
    provider.enqueue({ response: { content: [{ type: 'text', text: '{}' }], inputTokens: 3_000, outputTokens: 1_000 } });
    provider.enqueue({ response: { content: [{ type: 'text', text: '{}' }], inputTokens: 40_000, outputTokens: 2_000 } });
    const a = await call(w, { input: image, media: hintImage, maxOutputTokens: 4_000 }, { provider, pricing: real });
    const b = await call(w, { input: pdf, media: hintPdf, maxOutputTokens: 4_000 }, { provider, pricing: real });
    expect(a.ok).toBe(true);
    expect(b.ok).toBe(true);
    expect(provider.reached).toBe(2);
    expect(JSON.stringify(provider.calls[0]!.messages).length).toBeGreaterThan(8 * 1024 * 1024);
  });
});

describe('a call that works', () => {
  it('settles the exact cost, clears the reservation, logs metadata only and audits the figures', async () => {
    const w = await world();
    const provider = new SlowFake();
    provider.enqueue({ response: { content: [{ type: 'text', text: '{"lines":[]}' }], inputTokens: 700, outputTokens: 300, model: 'fake-model' } });
    const audits: CallAudit[] = [];
    const fileId = await seedFile(w, 'EXTRACTING');
    const result = await call(w, { fileId }, { provider, audit: async (c) => void audits.push(c) });
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
    expect(audits).toEqual([{ fileId, status: 'OK', model: 'fake-model', inputTokens: 700, outputTokens: 300, costMicroUsd: '1000', overrunMicroUsd: '0', reservedMicroUsd: '10000', settled: 1 }]);
  });

  it('charges the worst case when the provider reports no usage', async () => {
    const w = await world();
    const provider = new SlowFake();
    provider.enqueue({ response: { content: [{ type: 'text', text: '{}' }], inputTokens: 0, outputTokens: 0 } });
    const result = await call(w, {}, { provider });
    expect(result).toMatchObject({ ok: true, costMicroUsd: CENT });
    expect(await usageRow(w)).toMatchObject({ spentMicroUsd: CENT, reservedMicroUsd: 0n });
  });

  it('books the ACTUAL cost in full, keeps the paid answer and audits the overrun when the actual cost is above the reservation', async () => {
    const w = await world();
    const provider = new SlowFake();
    provider.enqueue({ response: { content: [{ type: 'text', text: 'PAID-ANSWER' }], inputTokens: 20_000, outputTokens: 5_000 } });
    const audits: CallAudit[] = [];
    const spy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const result = await call(w, {}, { provider, audit: async (c) => void audits.push(c) });
    expect(worstCaseMicroUsd(REQ, ONE_CENT_OUT, PRICE)).toBe(CENT);
    expect(result).toMatchObject({ ok: true, text: 'PAID-ANSWER', costMicroUsd: 25_000n, overrunMicroUsd: 15_000n });
    expect(audits[0]).toMatchObject({ costMicroUsd: '25000', overrunMicroUsd: '15000', reservedMicroUsd: '10000' });
    expect(await usageRow(w)).toMatchObject({ spentMicroUsd: 25_000n, reservedMicroUsd: 0n });
    expect((await calls(w))[0]).toMatchObject({ status: 'OK', costMicroUsd: 25_000n });
    // an overrun is an error to look at: the bound was not an upper bound
    expect(spy).toHaveBeenCalledWith(expect.stringContaining('overrun'), expect.anything());
    spy.mockRestore();
  });

  it('after an overrun the next reservation sees the real spend: spent above the budget refuses every further call this month', async () => {
    const w = await world({ budgetCents: 2 });
    const spy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const provider = new SlowFake();
    provider.enqueue({ response: { content: [{ type: 'text', text: '{}' }], inputTokens: 20_000, outputTokens: 5_000 } });
    expect((await call(w, {}, { provider })).ok).toBe(true);
    spy.mockRestore();
    expect((await usageRow(w))!.spentMicroUsd).toBe(25_000n);
    const second = new SlowFake();
    expect(await call(w, {}, { provider: second })).toEqual({ ok: false, code: 'AI_BUDGET_REACHED' });
    expect(second.reached).toBe(0);
    const row = await usageRow(w);
    expect(row!.reservedMicroUsd).toBe(0n);
    // the overshoot is bounded: one overrun, never more than one call's excess
    expect(row!.spentMicroUsd - 2n * CENT).toBe(5_000n);
  });

  it('when the sweeper already booked the reservation, an overrun adds only the excess over what it booked', async () => {
    const w = await world();
    const spy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const provider = new GatedFake();
    const fileId = await seedFile(w, 'EXTRACTING', NOW);
    provider.enqueue({ response: { content: [{ type: 'text', text: '{}' }], inputTokens: 20_000, outputTokens: 5_000 } });
    const running = call(w, { fileId }, { provider });
    await vi.waitFor(() => expect(provider.reached).toBe(1), { timeout: 30_000, interval: 5 });
    expect((await sweepAiReservations(prisma(), new Date(NOW.getTime() + 30 * MIN))).swept).toBe(1);
    provider.release();
    expect((await running).ok).toBe(true);
    spy.mockRestore();
    expect(await usageRow(w)).toMatchObject({ reservedMicroUsd: 0n, spentMicroUsd: 25_000n });
  });

  it('a settle whose reply was lost and is retried writes the call row once (the retry finds the reservation gone and its own row there)', async () => {
    const w = await world();
    const provider = new GatedFake();
    const fileId = await seedFile(w, 'EXTRACTING', NOW);
    provider.enqueue({ response: { content: [{ type: 'text', text: '{}' }], inputTokens: 700, outputTokens: 300, model: 'fake-model' } });
    const running = call(w, { fileId }, { provider });
    await vi.waitFor(() => expect(provider.reached).toBe(1), { timeout: 30_000, interval: 5 });
    // what a first settle attempt that committed (but whose reply was lost) leaves behind
    await prisma().phAiReservation.deleteMany({ where: { fileId } });
    await prisma().phAiUsageMonth.update({ where: { restaurantId_month: { restaurantId: w.a.id, month: '2026-10' } }, data: { reservedMicroUsd: 0n, spentMicroUsd: 1000n, calls: 1 } });
    await prisma().phAiCall.create({ data: { restaurantId: w.a.id, purpose: 'extract', model: 'fake-model', status: 'OK', costMicroUsd: 1000n, fileId, inputTokens: 700, outputTokens: 300 } });
    provider.release();
    expect((await running).ok).toBe(true);
    expect((await calls(w)).filter((c) => c.fileId === fileId)).toHaveLength(1);
    expect(await usageRow(w)).toMatchObject({ reservedMicroUsd: 0n, spentMicroUsd: 1000n });
  });

  it('refuses when the price was declared for another model than the one that would run, before reserving or calling', async () => {
    const w = await world();
    const provider = Object.assign(new SlowFake(), { modelFor: () => 'claude-opus-5-5' });
    const fileId = await seedFile(w, 'EXTRACTING');
    expect(await call(w, { fileId }, { provider, pricing: { ...PRICE, model: 'gpt-5' } })).toEqual({ ok: false, code: 'AI_PRICING_MODEL_MISMATCH' });
    expect(provider.reached).toBe(0);
    expect(await usageRow(w)).toBeNull();
    expect(await prisma().phAiReservation.count()).toBe(0);
    // the same price for the model that runs is fine; a provider that does not name its model (a test double) is not checked
    expect((await call(w, { fileId }, { provider, pricing: { ...PRICE, model: 'claude-opus-5-5' } })).ok).toBe(true);
    expect((await call(w, {}, { provider: new SlowFake(), pricing: { ...PRICE, model: 'anything' } })).ok).toBe(true);
  });

  it('survives an audit callback that fails', async () => {
    const w = await world();
    const spy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const result = await call(w, {}, { provider: new SlowFake(), audit: () => Promise.reject(new Error('audit down')) });
    expect(result.ok).toBe(true);
    expect(spy).toHaveBeenCalledWith(expect.stringContaining('could not audit'), expect.anything());
    spy.mockRestore();
  });
});

describe('a call that fails', () => {
  it('a provider error before any output releases the reservation and costs nothing', async () => {
    const w = await world();
    const provider = new SlowFake();
    provider.enqueue('error');
    const fileId = await seedFile(w, 'EXTRACTING');
    expect(await call(w, { fileId }, { provider })).toEqual({ ok: false, code: 'AI_PROVIDER_ERROR' });
    expect(await usageRow(w)).toMatchObject({ spentMicroUsd: 0n, reservedMicroUsd: 0n });
    expect(await prisma().phAiReservation.count()).toBe(0);
    expect((await calls(w))[0]).toMatchObject({ status: 'ERROR', costMicroUsd: 0n, fileId });
  });

  it('a timeout (provider-reported or by our own clock) books the input side as spend: the provider probably billed it', async () => {
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
    expect(await usageRow(w)).toMatchObject({ spentMicroUsd: 2n * INPUT_SIDE, reservedMicroUsd: 0n });
    expect((await calls(w)).map((c) => [c.status, c.costMicroUsd])).toEqual([['TIMEOUT', INPUT_SIDE], ['TIMEOUT', INPUT_SIDE]]);
    expect(INPUT_SIDE).toBeGreaterThan(0n);
    expect(INPUT_SIDE).toBeLessThan(CENT);
  });

  it('refusal is AI_REFUSED and costs what the provider reported', async () => {
    const w = await world();
    const provider = new SlowFake();
    provider.enqueue({ response: { stop: 'refusal', content: [], inputTokens: 400, outputTokens: 0 } });
    expect(await call(w, {}, { provider })).toEqual({ ok: false, code: 'AI_REFUSED' });
    expect(await usageRow(w)).toMatchObject({ spentMicroUsd: 400n, reservedMicroUsd: 0n });
    expect((await calls(w))[0]).toMatchObject({ status: 'ERROR', costMicroUsd: 400n });
  });

  it("a caller-side abort reaches the provider's signal, ends cleanly and books the input side", async () => {
    const w = await world();
    let providerSignal: AbortSignal | undefined;
    const hanging = new SlowFake();
    hanging.complete = (req: AiRequest) =>
      new Promise<AiResponse>((_, reject) => {
        providerSignal = req.signal;
        req.signal.addEventListener('abort', () => reject(new AiProviderError()));
      });
    const controller = new AbortController();
    const running = call(w, {}, { provider: hanging, signal: controller.signal });
    await vi.waitFor(async () => expect((await usageRow(w))?.reservedMicroUsd).toBe(CENT));
    await vi.waitFor(() => expect(providerSignal).toBeDefined());
    expect(providerSignal!.aborted).toBe(false);
    controller.abort();
    expect(await running).toEqual({ ok: false, code: 'AI_PROVIDER_ERROR' });
    expect(providerSignal!.aborted).toBe(true);
    expect(await usageRow(w)).toMatchObject({ spentMicroUsd: INPUT_SIDE, reservedMicroUsd: 0n });
  });

  it('a business that does not exist is refused by code, never an exception', async () => {
    const result = await runPharmacyAi(prisma(), { restaurantId: 'no-such-business', fileId: 'x', lease: NOW, purpose: 'extract', input: REQ, maxOutputTokens: 10, now: NOW }, { provider: new SlowFake(), pricing: PRICE });
    expect(result).toEqual({ ok: false, code: 'AI_NOT_IN_PLAN' });
  });

  it('no provider configured is AI_NOT_CONFIGURED, nothing reserved', async () => {
    const w = await world();
    setAiProviderForTests(null);
    try {
      const fileId = await seedFile(w, 'EXTRACTING');
      const result = await runPharmacyAi(prisma(), { restaurantId: w.a.id, fileId, lease: NOW, purpose: 'extract', input: REQ, maxOutputTokens: ONE_CENT_OUT, now: NOW }, { pricing: PRICE });
      expect(result).toEqual({ ok: false, code: 'AI_NOT_CONFIGURED' });
      expect(await prisma().phAiReservation.count()).toBe(0);
    } finally {
      setAiProviderForTests(undefined);
    }
  });
});

describe('the budget stops', () => {
  it('lets exactly N worst-case calls through when N+3 fire at once, however slow the machine (10 rounds, gated on a barrier)', async () => {
    const N = 4;
    for (let round = 0; round < 10; round += 1) {
      await resetWorld();
      const w = await world({ budgetCents: N });
      const provider = new GatedFake();
      let peak = 0n;
      let polling = true;
      const poller = (async () => {
        while (polling) {
          const row = await usageRow(w);
          if (row) peak = row.spentMicroUsd + row.reservedMicroUsd > peak ? row.spentMicroUsd + row.reservedMicroUsd : peak;
          await new Promise((r) => setTimeout(r, 3));
        }
      })();
      const files = await Promise.all(Array.from({ length: N + 3 }, () => seedFile(w, 'EXTRACTING', NOW)));
      let refused = 0;
      const running = files.map((fileId) =>
        call(w, { fileId }, { provider }).then((r) => {
          if (!r.ok) refused += 1;
          return r;
        }),
      );
      // Nothing is let out until every attempt has either reached the model or been refused: no call settles (and frees budget) before all have tried to reserve.
      await vi.waitFor(() => expect(provider.reached + refused).toBe(N + 3), { timeout: 60_000, interval: 5 });
      provider.release();
      const results = await Promise.all(running);
      polling = false;
      await poller;
      expect(provider.reached).toBe(N);
      expect(results.filter((r) => r.ok)).toHaveLength(N);
      expect(results.filter((r) => !r.ok).map((r) => (r.ok ? '' : r.code))).toEqual(Array(3).fill('AI_BUDGET_REACHED'));
      expect(peak).toBeLessThanOrEqual(BigInt(N) * CENT);
      const row = await usageRow(w);
      expect(row!.reservedMicroUsd).toBe(0n);
      expect(row!.spentMicroUsd).toBeLessThanOrEqual(BigInt(N) * CENT);
    }
  }, 300_000);

  it('counts spent plus the worst case: a cheap first call still leaves too little for the next worst case, and the refusal is logged as BUDGET', async () => {
    const w = await world({ budgetCents: 1 });
    const provider = new SlowFake();
    provider.enqueue({ response: { content: [{ type: 'text', text: '{}' }], inputTokens: 100, outputTokens: 100 } });
    expect((await call(w, {}, { provider })).ok).toBe(true);
    const fileId = await seedFile(w, 'EXTRACTING');
    expect(await call(w, { fileId }, { provider })).toEqual({ ok: false, code: 'AI_BUDGET_REACHED' });
    expect(provider.reached).toBe(1);
    expect(await usageRow(w)).toMatchObject({ spentMicroUsd: 200n, reservedMicroUsd: 0n, calls: 1 });
    expect((await calls(w)).map((c) => [c.status, c.costMicroUsd, c.fileId === fileId])).toEqual([['OK', 200n, false], ['BUDGET', 0n, true]]);
    expect(await prisma().phAiReservation.count()).toBe(0);
  });

  it('allows one call in flight per file', async () => {
    const w = await world();
    const provider = new GatedFake();
    const fileId = await seedFile(w, 'EXTRACTING');
    let refused = 0;
    const both = [call(w, { fileId }, { provider }), call(w, { fileId }, { provider })].map((p) =>
      p.then((r) => {
        if (!r.ok) refused += 1;
        return r;
      }),
    );
    await vi.waitFor(() => expect(provider.reached + refused).toBe(2), { timeout: 60_000, interval: 5 });
    provider.release();
    const [x, y] = await Promise.all(both);
    expect([x!.ok, y!.ok].sort()).toEqual([false, true]);
    expect([x, y].find((r) => !r!.ok)).toEqual({ ok: false, code: 'EXTRACTION_IN_PROGRESS' });
    expect(provider.reached).toBe(1);
    expect(await usageRow(w)).toMatchObject({ reservedMicroUsd: 0n });
    expect(await prisma().phAiReservation.count()).toBe(0);
  });
});

describe('the lease on the file', () => {
  it("refuses a call whose lease is not the file's current one, or whose file is not extracting, with nothing reserved", async () => {
    const w = await world();
    const provider = new SlowFake();
    const mine = await seedFile(w, 'EXTRACTING', NOW);
    expect(await call(w, { fileId: mine, lease: new Date(NOW.getTime() - 1000) }, { provider })).toEqual({ ok: false, code: 'LEASE_LOST' });
    const idle = await seedFile(w, 'UPLOADED');
    expect(await call(w, { fileId: idle }, { provider })).toEqual({ ok: false, code: 'LEASE_LOST' });
    expect(await call(w, { fileId: 'no-such-file' }, { provider })).toEqual({ ok: false, code: 'LEASE_LOST' });
    expect(provider.reached).toBe(0);
    expect(await prisma().phAiReservation.count()).toBe(0);
    expect((await usageRow(w))?.reservedMicroUsd ?? 0n).toBe(0n);
  });

  it('a lease lost DURING the call still books the money, then reports LEASE_LOST so the answer is dropped', async () => {
    const w = await world();
    const provider = new GatedFake();
    const fileId = await seedFile(w, 'EXTRACTING', NOW);
    const running = call(w, { fileId }, { provider });
    await vi.waitFor(() => expect(provider.reached).toBe(1), { timeout: 30_000, interval: 5 });
    await prisma().phIntakeFile.update({ where: { id: fileId }, data: { extractingSince: new Date(NOW.getTime() + 11 * MIN) } });
    provider.release();
    expect(await running).toEqual({ ok: false, code: 'LEASE_LOST' });
    const row = await usageRow(w);
    expect(row!.reservedMicroUsd).toBe(0n);
    expect(row!.spentMicroUsd).toBeGreaterThan(0n);
    expect(await prisma().phAiReservation.count()).toBe(0);
  });

  it('releaseFile by a stale holder is a no-op that says LEASE_LOST and leaves the new claim intact', async () => {
    const w = await world();
    const id = await seedFile(w, 'FAILED');
    const a = await claimFileForExtraction(prisma(), w.a.id, id, NOW);
    const later = new Date(NOW.getTime() + 11 * MIN);
    const b = await claimFileForExtraction(prisma(), w.a.id, id, later);
    expect(b).toEqual({ ok: true, lease: later });
    if (!a.ok) throw new Error('first claim failed');
    expect(await releaseFile(prisma(), w.a.id, id, a.lease, { status: 'EXTRACTED', now: later })).toBe('LEASE_LOST');
    const file = await prisma().phIntakeFile.findUniqueOrThrow({ where: { id } });
    expect(file).toMatchObject({ status: 'EXTRACTING', attempts: 2 });
    expect(file.extractingSince?.getTime()).toBe(later.getTime());
    expect(await releaseFile(prisma(), w.a.id, id, later, { status: 'EXTRACTED', now: later })).toBe('RELEASED');
  });
});

describe('reservations of dead workers', () => {
  it('a reservation of the same file older than the lease length is booked as spend before the new one is made', async () => {
    const w = await world({ budgetCents: 3 });
    const fileId = await seedFile(w, 'EXTRACTING', NOW);
    await seedReservation(w, fileId, CENT, new Date(NOW.getTime() - 11 * MIN));
    const provider = new SlowFake();
    provider.enqueue({ response: { content: [{ type: 'text', text: '{}' }], inputTokens: 100, outputTokens: 100 } });
    expect((await call(w, { fileId }, { provider })).ok).toBe(true);
    expect(await usageRow(w)).toMatchObject({ reservedMicroUsd: 0n, spentMicroUsd: CENT + 200n });
    expect(await prisma().phAiReservation.count()).toBe(0);
    expect((await calls(w)).map((c) => [c.status, c.costMicroUsd])).toEqual([['ERROR', CENT], ['OK', 200n]]);
  });

  it("a reservation that predates the lease the caller holds is the previous holder's, even when it is young", async () => {
    const w = await world({ budgetCents: 3 });
    const fileId = await seedFile(w, 'EXTRACTING', NOW);
    await seedReservation(w, fileId, 2000n, new Date(NOW.getTime() - 60_000));
    expect((await call(w, { fileId }, { provider: new SlowFake() })).ok).toBe(true);
    expect((await usageRow(w))!.reservedMicroUsd).toBe(0n);
    expect(await prisma().phAiReservation.count()).toBe(0);
    expect((await calls(w))[0]).toMatchObject({ status: 'ERROR', costMicroUsd: 2000n });
  });

  it('a reservation of the SAME lease is a live one: EXTRACTION_IN_PROGRESS, untouched', async () => {
    const w = await world({ budgetCents: 3 });
    const fileId = await seedFile(w, 'EXTRACTING', NOW);
    await seedReservation(w, fileId, 2000n, new Date(NOW.getTime() + 1000));
    expect(await call(w, { fileId }, { provider: new SlowFake() })).toEqual({ ok: false, code: 'EXTRACTION_IN_PROGRESS' });
    expect(await usageRow(w)).toMatchObject({ reservedMicroUsd: 2000n, spentMicroUsd: 0n });
  });

  it('an old reservation of an earlier month is booked in ITS month, with no lock inversion', async () => {
    const w = await world({ budgetCents: 3 });
    const fileId = await seedFile(w, 'EXTRACTING', NOW);
    await seedReservation(w, fileId, 2000n, new Date(NOW.getTime() - 40 * 24 * 60 * MIN), '2026-09');
    expect((await call(w, { fileId }, { provider: new SlowFake() })).ok).toBe(true);
    expect(await usageRow(w, '2026-09')).toMatchObject({ reservedMicroUsd: 0n, spentMicroUsd: 2000n });
  });
});

describe('sweeping reservations', () => {
  it('books stale reservations as SPEND at the reserved amount, never as unspent, and leaves live and young ones', async () => {
    const w = await world();
    const live = await seedFile(w, 'EXTRACTING', new Date(NOW.getTime() - 2 * MIN));
    const stale = await seedFile(w, 'EXTRACTING', new Date(NOW.getTime() - 11 * MIN));
    const done = await seedFile(w, 'UPLOADED');
    const young = await seedFile(w, 'UPLOADED');
    const old = new Date(NOW.getTime() - 11 * MIN);
    for (const id of [live, stale, done]) await seedReservation(w, id, 2000n, old);
    await seedReservation(w, young, 2000n, new Date(NOW.getTime() - MIN));
    const out = await sweepAiReservations(prisma(), NOW, 10 * MIN);
    expect(out).toEqual({ swept: 2, microUsd: 4000n, errors: [] });
    expect(await usageRow(w)).toMatchObject({ reservedMicroUsd: 4000n, spentMicroUsd: 4000n, calls: 2 });
    expect((await prisma().phAiReservation.findMany({ select: { fileId: true } })).map((r) => r.fileId).sort()).toEqual([live, young].sort());
    expect((await calls(w)).map((c) => [c.status, c.costMicroUsd])).toEqual([['ERROR', 2000n], ['ERROR', 2000n]]);
    expect(await sweepAiReservations(prisma(), NOW, 10 * MIN)).toEqual({ swept: 0, microUsd: 0n, errors: [] });
  });

  it('never frees anything younger than a call can run, whatever olderThanMs says', async () => {
    const w = await world();
    const file = await seedFile(w, 'UPLOADED');
    await seedReservation(w, file, 2000n, new Date(NOW.getTime() - 60_000));
    expect((await sweepAiReservations(prisma(), NOW, 0)).swept).toBe(0);
    expect((await sweepAiReservations(prisma(), NOW, 1)).swept).toBe(0);
    expect(await prisma().phAiReservation.count()).toBe(1);
  });

  it('does not touch a live call in flight, and the call then settles normally', async () => {
    const w = await world();
    const provider = new GatedFake();
    const fileId = await seedFile(w, 'EXTRACTING', NOW);
    provider.enqueue({ response: { content: [{ type: 'text', text: '{}' }], inputTokens: 100, outputTokens: 100 } });
    const running = call(w, { fileId }, { provider });
    await vi.waitFor(() => expect(provider.reached).toBe(1), { timeout: 30_000, interval: 5 });
    expect(await sweepAiReservations(prisma(), new Date(NOW.getTime() + 5_000), 1)).toEqual({ swept: 0, microUsd: 0n, errors: [] });
    expect((await usageRow(w))!.reservedMicroUsd).toBe(CENT);
    provider.release();
    expect((await running).ok).toBe(true);
    expect(await usageRow(w)).toMatchObject({ reservedMicroUsd: 0n, spentMicroUsd: 200n });
  });

  it('when the sweeper already booked the reservation, the settle adds no second charge and does not go negative', async () => {
    const w = await world();
    const provider = new GatedFake();
    const fileId = await seedFile(w, 'EXTRACTING', NOW);
    provider.enqueue({ response: { content: [{ type: 'text', text: '{}' }], inputTokens: 100, outputTokens: 100 } });
    const running = call(w, { fileId }, { provider });
    await vi.waitFor(() => expect(provider.reached).toBe(1), { timeout: 30_000, interval: 5 });
    expect((await sweepAiReservations(prisma(), new Date(NOW.getTime() + 30 * MIN))).swept).toBe(1);
    expect(await usageRow(w)).toMatchObject({ reservedMicroUsd: 0n, spentMicroUsd: CENT });
    provider.release();
    expect((await running).ok).toBe(true);
    expect(await usageRow(w)).toMatchObject({ reservedMicroUsd: 0n, spentMicroUsd: CENT });
    expect(await prisma().phAiReservation.count()).toBe(0);
  });

  it('a settle that fails twice leaves the reservation, answers anyway, and the sweeper books it as spend', async () => {
    const w = await world();
    const spy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const provider = new SlowFake();
    const original = provider.complete.bind(provider);
    provider.complete = async (req) => {
      // From now on no OK call row can be written: the settle transaction fails (and rolls back) every time.
      // eslint-disable-next-line no-restricted-properties -- test-only DDL on a table of this database
      await prisma().$executeRawUnsafe(`ALTER TABLE "PhAiCall" ADD CONSTRAINT "tmp_no_ok" CHECK ("status" <> 'OK') NOT VALID`);
      return original(req);
    };
    try {
      const result = await call(w, {}, { provider });
      expect(result.ok).toBe(true);
    } finally {
      // eslint-disable-next-line no-restricted-properties -- test-only DDL on a table of this database
      await prisma().$executeRawUnsafe(`ALTER TABLE "PhAiCall" DROP CONSTRAINT IF EXISTS "tmp_no_ok"`);
    }
    expect(spy).toHaveBeenCalledWith(expect.stringContaining('could not settle'), expect.anything());
    spy.mockRestore();
    expect(await usageRow(w)).toMatchObject({ spentMicroUsd: 0n, reservedMicroUsd: CENT });
    expect(await prisma().phAiReservation.count()).toBe(1);
    const out = await sweepAiReservations(prisma(), new Date(NOW.getTime() + 30 * MIN));
    expect(out.swept).toBe(1);
    expect(await usageRow(w)).toMatchObject({ spentMicroUsd: CENT, reservedMicroUsd: 0n });
  });

  it('one bad reservation does not stop the sweep: it is reported and the next is swept', async () => {
    const w = await world();
    const spy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const bad = await seedFile(w, 'UPLOADED');
    const good = await seedFile(w, 'UPLOADED');
    await seedReservation(w, bad, 2000n, new Date(NOW.getTime() - 20 * MIN), '2026-09');
    await seedReservation(w, good, 3000n, new Date(NOW.getTime() - 15 * MIN));
    await prisma().phAiUsageMonth.update({ where: { restaurantId_month: { restaurantId: w.a.id, month: '2026-09' } }, data: { reservedMicroUsd: 0n } });
    const out = await sweepAiReservations(prisma(), NOW);
    expect(out.swept).toBe(1);
    expect(out.microUsd).toBe(3000n);
    expect(out.errors).toHaveLength(1);
    expect(spy).toHaveBeenCalled();
    spy.mockRestore();
    expect(await usageRow(w)).toMatchObject({ spentMicroUsd: 3000n, reservedMicroUsd: 0n });
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

  it('a call in flight across midnight settles into the month it reserved in', async () => {
    const w = await world();
    const provider = new GatedFake();
    const before = new Date('2026-10-31T20:59:30.000Z');
    const fileId = await seedFile(w, 'EXTRACTING', before);
    const running = call(w, { fileId, now: before, lease: before }, { provider });
    await vi.waitFor(() => expect(provider.reached).toBe(1), { timeout: 30_000, interval: 5 });
    vi.setSystemTime(new Date('2026-10-31T21:01:00.000Z'));
    provider.release();
    expect((await running).ok).toBe(true);
    expect((await usageRow(w, '2026-10'))!.calls).toBe(1);
    expect(await usageRow(w, '2026-11')).toBeNull();
  });
});

describe('claiming a file for extraction', () => {
  it('lets exactly one of two racing claims win, and gives it the lease', async () => {
    const w = await world();
    const id = await seedFile(w, 'UPLOADED');
    const both = await Promise.all([claimFileForExtraction(prisma(), w.a.id, id, NOW), claimFileForExtraction(prisma(), w.a.id, id, NOW)]);
    expect(both.filter((c) => c.ok)).toEqual([{ ok: true, lease: NOW }]);
    expect(both.filter((c) => !c.ok)).toEqual([{ ok: false, reason: 'NOT_CLAIMABLE' }]);
    const file = await prisma().phIntakeFile.findUniqueOrThrow({ where: { id } });
    expect(file).toMatchObject({ status: 'EXTRACTING', attempts: 1 });
    expect(file.extractingSince?.getTime()).toBe(NOW.getTime());
  });

  it('claims UPLOADED and FAILED, not EXTRACTED, not a fresh lease, not another business', async () => {
    const w = await world();
    const failed = await seedFile(w, 'FAILED');
    expect((await claimFileForExtraction(prisma(), w.a.id, failed, NOW)).ok).toBe(true);
    expect((await prisma().phIntakeFile.findUniqueOrThrow({ where: { id: failed } })).failureCode).toBeNull();
    const extracted = await seedFile(w, 'EXTRACTED');
    expect((await claimFileForExtraction(prisma(), w.a.id, extracted, NOW)).ok).toBe(false);
    const fresh = await seedFile(w, 'EXTRACTING', new Date(NOW.getTime() - MIN));
    expect((await claimFileForExtraction(prisma(), w.a.id, fresh, NOW)).ok).toBe(false);
    const stale = await seedFile(w, 'EXTRACTING', new Date(NOW.getTime() - 11 * MIN));
    expect((await claimFileForExtraction(prisma(), w.a.id, stale, NOW)).ok).toBe(true);
    const own = await seedFile(w, 'UPLOADED');
    expect((await claimFileForExtraction(prisma(), 'someone-else', own, NOW)).ok).toBe(false);
    expect((await claimFileForExtraction(prisma(), w.a.id, 'no-such-file', NOW)).ok).toBe(false);
  });

  it('stops after five attempts with EXTRACTION_ATTEMPTS_EXHAUSTED', async () => {
    const w = await world();
    const id = await seedFile(w, 'FAILED');
    for (let n = 1; n <= 5; n += 1) {
      const claim = await claimFileForExtraction(prisma(), w.a.id, id, NOW);
      expect(claim.ok).toBe(true);
      if (claim.ok) expect(await releaseFile(prisma(), w.a.id, id, claim.lease, { status: 'FAILED', failureCode: 'AI_TIMEOUT', now: NOW })).toBe('RELEASED');
    }
    expect(await claimFileForExtraction(prisma(), w.a.id, id, NOW)).toEqual({ ok: false, reason: 'EXTRACTION_ATTEMPTS_EXHAUSTED' });
    expect((await prisma().phIntakeFile.findUniqueOrThrow({ where: { id } })).attempts).toBe(5);
  });

  it('releases a claimed file to EXTRACTED, FAILED (with a code) or back to UPLOADED, clearing the lease', async () => {
    const w = await world();
    const lease = async (id: string) => {
      const claim = await claimFileForExtraction(prisma(), w.a.id, id, NOW);
      if (!claim.ok) throw new Error('not claimed');
      return claim.lease;
    };
    const a = await seedFile(w, 'UPLOADED');
    const la = await lease(a);
    expect(await releaseFile(prisma(), w.a.id, a, la, { status: 'EXTRACTED', now: NOW })).toBe('RELEASED');
    expect(await prisma().phIntakeFile.findUniqueOrThrow({ where: { id: a } })).toMatchObject({ status: 'EXTRACTED', extractingSince: null, failureCode: null, extractedAt: NOW });
    const b = await seedFile(w, 'UPLOADED');
    const lb = await lease(b);
    expect(await releaseFile(prisma(), w.a.id, b, lb, { status: 'FAILED', failureCode: 'AI_TIMEOUT', now: NOW })).toBe('RELEASED');
    expect(await prisma().phIntakeFile.findUniqueOrThrow({ where: { id: b } })).toMatchObject({ status: 'FAILED', extractingSince: null, failureCode: 'AI_TIMEOUT' });
    const c = await seedFile(w, 'UPLOADED');
    const lc = await lease(c);
    expect(await releaseFile(prisma(), w.a.id, c, lc, { status: 'UPLOADED', now: NOW })).toBe('RELEASED');
    expect(await prisma().phIntakeFile.findUniqueOrThrow({ where: { id: c } })).toMatchObject({ status: 'UPLOADED', extractingSince: null });
    expect(await releaseFile(prisma(), w.a.id, c, lc, { status: 'EXTRACTED', now: NOW })).toBe('LEASE_LOST');
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

  it('leaves the money keys out for an actor without cost.view, keeping counts (role spoofed: no real role has purchase.manage and report.view without cost.view)', async () => {
    const w = await world({ budgetCents: 5 });
    const ph = (await asPh(w.pic.userId, w.a.id, w.b1))!;
    const scoped = (await import('@/server/data/tenant-db')).scopedClient(prisma(), { restaurantId: w.a.id, allBranches: true });
    const view = await usageView(scoped, { ...ph, role: 'PHARMACIST' } as typeof ph, NOW);
    expect(view).toEqual({ month: '2026-10', calls: 0, inputTokens: '0', outputTokens: '0' });
  });
});
