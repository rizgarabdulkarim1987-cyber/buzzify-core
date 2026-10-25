import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { writeAiPackage } from '@/server/ai/package';
import { FakeProvider } from '@/server/ai/provider/fake';
import { setAiProviderForTests } from '@/server/ai/provider';
import { listUnlabeledComplaintTexts } from '@/server/pos/complaint-ai-labels';
import { labelPosComplaints } from '@/server/studio/actions/pos-ai';
import { posAiComplaintLabels } from '@/server/studio/queries/pos-ai';
import { ask, dataOf, prisma, run, useTestDatabase } from '../fixture';
import { complaint, makeAiWorld, type AiWorld } from './world';

vi.mock('next/headers', () => ({ headers: vi.fn(), cookies: vi.fn() }));

const globalForPrisma = globalThis as unknown as { __prisma?: unknown };
let w: AiWorld;
let fake: FakeProvider;

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

describe('what the service hands the model', () => {
  it('is only the id, the body and the guest category of the restaurant\'s own unlabeled complaints', async () => {
    await complaint(w.a.id, 'the soup was cold', { contactName: 'Layla', contactPhone: '07709998888', tableNumber: 4, orderNumber: 12 });
    await complaint(w.b.id, 'bravo text');
    const rows = await listUnlabeledComplaintTexts(prisma(), w.a.id);
    expect(rows).toHaveLength(1);
    expect(Object.keys(rows[0]!).sort()).toEqual(['body', 'category', 'id']);
  });
});

describe('pos.aiLabelComplaints', () => {
  it('labels with category, summary and language, keeps the guest text and category, and audits only a count', async () => {
    const cold = await complaint(w.a.id, 'the soup was cold', { category: 'SERVICE', contactName: 'Layla', contactPhone: '07709998888' });
    const arabic = await complaint(w.a.id, 'الخدمة كانت بطيئة جدا');
    const result = dataOf(await run(w.manager, labelPosComplaints, {}));
    expect(result).toEqual({ ok: true, labeled: 2, pending: 0 });
    const a = await prisma().posComplaint.findUniqueOrThrow({ where: { id: cold.id } });
    expect(a).toMatchObject({ aiCategory: 'FOOD', languageGuess: 'en', body: 'the soup was cold', category: 'SERVICE', contactName: 'Layla', contactPhone: '07709998888' });
    expect(a.aiLabeledAt).not.toBeNull();
    expect(await prisma().posComplaint.findUniqueOrThrow({ where: { id: arabic.id } })).toMatchObject({ aiCategory: 'SERVICE', languageGuess: 'ar' });
    const audit = await prisma().auditLog.findMany({ where: { action: 'pos.ai.complaint.label' } });
    expect(audit).toHaveLength(1);
    expect(JSON.stringify(audit[0])).not.toContain('soup');
    expect(JSON.stringify(audit[0])).not.toContain('Layla');
  });

  it('sends the text without any phone number, the contact or the real id', async () => {
    const row = await complaint(w.a.id, 'call me on 07701234567 about the cold soup', { contactName: 'Layla', contactPhone: '07709998888', tableNumber: 9 });
    await run(w.manager, labelPosComplaints, {});
    const sent = JSON.stringify(fake.calls[0]!.messages);
    expect(sent).toContain('[number]');
    for (const secret of ['07701234567', '07709998888', 'Layla', row.id]) expect(sent).not.toContain(secret);
    expect(sent).toContain('<untrusted_data source=\\"complaint\\">');
  });

  it('asks nothing when nothing is unlabeled, and never labels twice', async () => {
    expect(dataOf(await run(w.manager, labelPosComplaints, {}))).toEqual({ ok: true, labeled: 0, pending: 0 });
    expect(fake.calls).toHaveLength(0);
    await complaint(w.a.id, 'dirty table');
    await run(w.manager, labelPosComplaints, {});
    expect(dataOf(await run(w.manager, labelPosComplaints, {}))).toEqual({ ok: true, labeled: 0, pending: 0 });
    expect(fake.calls).toHaveLength(1);
  });

  it('ignores a handle it was not given, a category outside the five and an accusing summary', async () => {
    const row = await complaint(w.a.id, 'something odd');
    fake.enqueue({
      response: {
        content: [
          {
            type: 'text',
            text: JSON.stringify({
              results: [
                { id: 'c99', category: 'FOOD', summary: 'foreign', language: 'en' },
                { id: 'c1', category: 'NONSENSE', summary: 'x', language: 'en' },
                { id: 'c1', category: 'PRICE', summary: 'The waiter committed fraud', language: 'klingon' },
              ],
            }),
          },
        ],
      },
    });
    expect(dataOf(await run(w.manager, labelPosComplaints, {}))).toMatchObject({ ok: true, labeled: 1 });
    expect(await prisma().posComplaint.findUniqueOrThrow({ where: { id: row.id } })).toMatchObject({ aiCategory: 'PRICE', aiSummary: null, languageGuess: 'other' });
  });

  it('answers unreadable output as a code and labels nothing', async () => {
    const row = await complaint(w.a.id, 'something odd');
    fake.enqueue({ response: { content: [{ type: 'text', text: 'not json' }] } });
    expect(dataOf(await run(w.manager, labelPosComplaints, {}))).toEqual({ ok: false, code: 'unreadable' });
    expect((await prisma().posComplaint.findUniqueOrThrow({ where: { id: row.id } })).aiLabeledAt).toBeNull();
  });

  it('works on one restaurant only, keeps a cashier out, and answers aiDisabled when off', async () => {
    const other = await complaint(w.b.id, 'bravo text');
    await complaint(w.a.id, 'alpha text');
    await run(w.manager, labelPosComplaints, {});
    expect((await prisma().posComplaint.findUniqueOrThrow({ where: { id: other.id } })).aiLabeledAt).toBeNull();
    expect((await run(w.cashier, labelPosComplaints, {})).ok).toBe(false);
    await writeAiPackage(prisma(), w.a.id, { enabled: false });
    expect(dataOf(await run(w.manager, labelPosComplaints, {}))).toEqual({ ok: false, code: 'aiDisabled' });
  });
});

describe('pos.aiComplaintLabels', () => {
  it('lists the suggestions beside the guest category, with no contact, and the count still waiting', async () => {
    await complaint(w.a.id, 'the soup was cold', { contactName: 'Layla', contactPhone: '07709998888' });
    const before = dataOf(await ask(w.manager, posAiComplaintLabels, {}));
    expect(before).toMatchObject({ ok: true, pending: 1 });
    await run(w.manager, labelPosComplaints, {});
    const after = dataOf(await ask(w.manager, posAiComplaintLabels, {}));
    expect(after).toMatchObject({ ok: true, pending: 0, complaints: [{ aiCategory: 'FOOD', language: 'en', labeled: true }] });
    expect(JSON.stringify(after)).not.toContain('Layla');
    expect(JSON.stringify(after)).not.toContain('0770');
    expect((await ask(w.cashier, posAiComplaintLabels, {})).ok).toBe(false);
  });
});
