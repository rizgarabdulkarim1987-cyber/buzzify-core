import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { LOCALES } from '@/lib/locale';
import { setAiProviderForTests } from '@/server/ai/provider';
import { scriptedProvider, textScriptKey, type ScriptedProvider } from '@/server/ai/provider/scripted';
import { DOCTOR_DISCLAIMER_KEY, DOCTOR_MESSAGE_KEYS, REFER_GENERIC } from '@/server/domain/pharmacy/doctor';
import * as doctorActions from '@/server/pharmacy/actions/doctor';
import { doctorUserText } from '@/server/pharmacy/doctor/prompt';
import { DOCTOR_REFUSALS } from '@/server/pharmacy/doctor/service';
import { SERVER_TEXT } from '@/studio/errors';
import { STUDIO_MESSAGES } from '@/studio/messages';
import { quiet } from './assistant-mock';
import { grant, NOW, person, pharmacy, prisma, resetWorld, useTestDatabase, type Person } from './fixture';
import { act, codeOf, dataOf } from './stock-helpers';

/**
 * `ph.doctor.ask` (Task 6): the server refuses whoever may not use the Doctor, whatever the browser shows; the log row and the
 * audit entry are written together; the disclaimer is the app's own line. Run through the real framework (`runAction`).
 */

const ANSWER = JSON.stringify({ redFlags: [], likelyCauses: ['Tension headache'], askNext: [], options: [{ ingredient: 'paracetamol', tradeNames: [], note: '' }], tellCustomer: [], referIf: [], cautions: [], unsure: false });

interface World {
  id: string;
  a: string;
  b: string;
  owner: Person;
  onA: Person;
  off: Person;
  cashier: Person;
  support: Person;
}
let w: World;
let provider: ScriptedProvider;

const QUESTION = 'Customer has a mild headache since this morning';
const body = (over: Record<string, unknown> = {}) => ({ restaurantId: w.id, branchId: w.a, mode: 'COMPLAINT', text: QUESTION, ...over });
const ask = (who: Person, over: Record<string, unknown> = {}) => act(who, doctorActions.askAction, body(over));
const doctorAudits = () => prisma().auditLog.findMany({ where: { restaurantId: w.id, action: 'ph.doctor.ask' } });
const logs = () => prisma().phDoctorLog.findMany({ where: { restaurantId: w.id } });
/** The rows written since efore (the clock is frozen, so rows cannot be told apart by time). */
const since = async <T extends { id: string }>(before: T[], now: T[]) => now.filter((r) => !before.some((b) => b.id === r.id));

beforeAll(async () => {
  useTestDatabase();
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(NOW);
  await resetWorld();
  await prisma().appPlan.create({ data: { applicationId: 'pharmacy', code: 'standard', name: { en: 'Standard' }, limits: { branches: 5, users: 20, storageMb: 50, aiMonthlyBudgetMinor: 100 } } });
  const biz = await pharmacy('DoctorAction', { branches: 2 });
  const [a, b] = biz.branchIds as [string, string];
  await prisma().phSettings.create({ data: { restaurantId: biz.id, enabledCurrencies: ['IQD'], defaultCurrency: 'IQD' } });
  const owner = await person('daOwner', { membership: [biz.id, 'OWNER'] });
  const onA = await person('daOnA', { staff: [biz.id, 'PHARMACIST', [a]] });
  const off = await person('daOff', { staff: [biz.id, 'PHARMACIST', [a]] });
  const cashier = await person('daCashier', { staff: [biz.id, 'CASHIER', [a]] });
  await prisma().phStaff.updateMany({ where: { userId: { in: [onA.userId, cashier.userId] } }, data: { aiDoctor: true } });
  const support = await person('daSupport', { superAdmin: true });
  await grant(support, biz.id, { scopes: ['catalog.read', 'stock.read'] });
  w = { id: biz.id, a, b, owner, onA, off, cashier, support };
}, 180_000);
beforeEach(() => {
  quiet();
  provider = scriptedProvider({ [textScriptKey(doctorUserText({ mode: 'COMPLAINT', text: QUESTION }))]: ANSWER });
  setAiProviderForTests(provider);
  vi.stubEnv('AI_PRICE_INPUT_USD_MICRO_PER_MTOK', '1000000');
  vi.stubEnv('AI_PRICE_OUTPUT_USD_MICRO_PER_MTOK', '1000000');
  vi.stubEnv('AI_PRICE_MODEL', 'scripted-test');
});
afterEach(() => {
  setAiProviderForTests(undefined);
  vi.unstubAllEnvs();
  useTestDatabase();
  vi.restoreAllMocks();
  vi.setSystemTime(NOW);
});
afterAll(() => {
  vi.useRealTimers();
});

describe('who may call it', () => {
  it('answers a pharmacist with the switch on, with no open shift, and the app’s disclaimer key', async () => {
    const out = dataOf(await ask(w.onA));
    expect(out).toMatchObject({ kind: 'ANSWER', mode: 'COMPLAINT', disclaimerKey: DOCTOR_DISCLAIMER_KEY });
    expect(provider.calls).toHaveLength(1);
  });

  it('answers the owner, who has no staff row', async () => {
    expect(codeOf(await ask(w.owner))).toBe('OK');
  });

  it('refuses a pharmacist whose switch is off, calling the action directly; nothing is called or written', async () => {
    const [audits, rows] = [(await doctorAudits()).length, (await logs()).length];
    const result = await ask(w.off);
    expect(result).toMatchObject({ ok: false, error: { code: 'FORBIDDEN', message: 'The owner has not turned on the AI Doctor for you' } });
    expect(provider.calls).toHaveLength(0);
    expect((await doctorAudits()).length).toBe(audits);
    expect((await logs()).length).toBe(rows);
  });

  it('refuses a cashier (no ai.use) even with the switch on, and a support grant', async () => {
    expect(codeOf(await ask(w.cashier))).toBe('FORBIDDEN');
    expect(codeOf(await ask(w.support))).toBe('FORBIDDEN');
    expect(provider.calls).toHaveLength(0);
  });

  it('refuses branch a staff asking for branch b', async () => {
    expect(codeOf(await ask(w.onA, { branchId: w.b }))).toBe('FORBIDDEN');
    expect(provider.calls).toHaveLength(0);
  });

  it('refuses everyone when the plan has no AI budget', async () => {
    const plan = (cents: number) => prisma().appPlan.updateMany({ where: { applicationId: 'pharmacy', code: 'standard' }, data: { limits: { branches: 5, users: 20, storageMb: 50, aiMonthlyBudgetMinor: cents } } });
    await plan(0);
    try {
      expect(await ask(w.owner)).toMatchObject({ ok: false, error: { code: 'FORBIDDEN', message: 'The AI Doctor is not in your plan' } });
    } finally {
      await plan(100);
    }
    expect(provider.calls).toHaveLength(0);
  });

  it('needs a branch', async () => {
    const { branchId: _drop, ...noBranch } = body();
    void _drop;
    expect(codeOf(await act(w.owner, doctorActions.askAction, noBranch))).toBe('INVALID');
  });
});

describe('what it records', () => {
  it('writes one log row and one audit entry per request, with no question or answer text in the audit', async () => {
    const [audits, rows] = [await doctorAudits(), await logs()];
    dataOf(await ask(w.onA));
    const newAudits = await since(audits, await doctorAudits());
    const newRows = await since(rows, await logs());
    expect(newAudits).toHaveLength(1);
    expect(newRows).toHaveLength(1);
    const row = newRows[0]!;
    const audit = newAudits[0]!;
    expect(audit.entityType).toBe('PhDoctorLog');
    expect(audit.entityId).toBe(row.id);
    expect(audit.actorId).toBe(w.onA.userId);
    expect(row).toMatchObject({ staffId: w.onA.userId, branchId: w.a, mode: 'COMPLAINT', outcome: 'ANSWERED' });
    expect(JSON.stringify(audit.changes)).not.toMatch(/headache|paracetamol/i);
  });

  it('records a red-flag referral without calling the model', async () => {
    const rows = await logs();
    const out = dataOf(await ask(w.onA, { text: 'Customer cannot breathe properly' }));
    expect(out).toMatchObject({ kind: 'REFER', reasons: ['BREATHING'], disclaimerKey: DOCTOR_DISCLAIMER_KEY });
    expect(provider.calls).toHaveLength(0);
    expect(await since(rows, await logs())).toEqual([expect.objectContaining({ outcome: 'REFUSED', model: 'none' })]);
  });

  it('refuses a question over 1000 characters and an age out of range', async () => {
    expect(codeOf(await ask(w.onA, { text: 'x'.repeat(1001) }))).toBe('INVALID');
    expect(codeOf(await ask(w.onA, { ageYears: 200 }))).toBe('INVALID');
    expect(codeOf(await ask(w.onA, { mode: 'MEDICINE_PHOTO', text: undefined, imageBase64: 'AAAA', mime: 'image/gif' }))).toBe('INVALID');
  });
});

describe('the database refuses a log row outside its rules', () => {
  const insert = (mode: string, outcome: string, questionText: string | null) =>
    // eslint-disable-next-line no-restricted-properties -- the test checks the table's own CHECK constraints with a raw insert
    prisma().$executeRawUnsafe(
      `INSERT INTO "PhDoctorLog" ("id", "restaurantId", "branchId", "staffId", "mode", "questionText", "answer", "model", "inputTokens", "outputTokens", "outcome") VALUES ($1, $2, $3, 'u', $4, $5, '{}'::jsonb, 'none', 0, 0, $6)`,
      `chk-${mode}-${outcome}-${questionText?.length ?? 'null'}`,
      w.id,
      w.a,
      mode,
      questionText,
      outcome,
    );

  it('accepts every allowed mode and outcome, and 280 characters', async () => {
    for (const mode of ['COMPLAINT', 'MEDICINE_NAME', 'MEDICINE_PHOTO']) await expect(insert(mode, 'ANSWERED', null)).resolves.toBe(1);
    for (const outcome of ['REFUSED', 'FAILED']) await expect(insert('COMPLAINT', outcome, 'q')).resolves.toBe(1);
    await expect(insert('COMPLAINT', 'ANSWERED', 'x'.repeat(280))).resolves.toBe(1);
  });

  it('rejects another mode, another outcome and a question over 280 characters', async () => {
    await expect(insert('BOGUS', 'ANSWERED', null)).rejects.toThrow(/PhDoctorLog_mode_check/);
    await expect(insert('COMPLAINT', 'MAYBE', null)).rejects.toThrow(/PhDoctorLog_outcome_check/);
    await expect(insert('COMPLAINT', 'ANSWERED', 'x'.repeat(281))).rejects.toThrow(/PhDoctorLog_questionText_length/);
  });
});

describe('the messages the Doctor can show', () => {
  it('has every refusal in SERVER_TEXT, pointing at a message in every language', () => {
    for (const text of Object.values(DOCTOR_REFUSALS)) {
      const key = SERVER_TEXT[text];
      expect(key, text).toBeTruthy();
      for (const locale of LOCALES) expect(STUDIO_MESSAGES[locale][key!], `${locale} ${key}`).toBeTruthy();
    }
  });

  it('has a message in every language for the disclaimer, every referral reason, unsure hint and unavailable reason', () => {
    const keys = [
      DOCTOR_DISCLAIMER_KEY,
      DOCTOR_MESSAGE_KEYS.referGeneric,
      DOCTOR_MESSAGE_KEYS.unsureRefer,
      ...Object.values(DOCTOR_MESSAGE_KEYS.reason),
      ...Object.values(DOCTOR_MESSAGE_KEYS.unsure),
      ...Object.values(DOCTOR_MESSAGE_KEYS.unavailable),
    ];
    expect(Object.keys(DOCTOR_MESSAGE_KEYS.reason).sort()).toEqual(['BLOOD_IN_STOOL', 'BREATHING', 'CHEST_PAIN', 'EMERGENCY', 'HIGH_FEVER_LONG', 'INFANT_FEVER', 'NEEDS_PRESCRIPTION', 'PREGNANCY', 'STROKE', 'TOO_LONG']);
    expect(Object.keys(DOCTOR_MESSAGE_KEYS.unavailable).sort()).toEqual(['FAILED', 'LIMIT', 'NOT_CONFIGURED', 'NOT_IN_PLAN']);
    expect(Object.keys(DOCTOR_MESSAGE_KEYS.unsure).sort()).toEqual(['CLEARER_PHOTO', 'MORE_DETAIL']);
    for (const key of keys) for (const locale of LOCALES) expect(STUDIO_MESSAGES[locale][key], `${locale} ${key}`).toBeTruthy();
    // The generic referral is a code in the answer, mapped by the app to its own line.
    expect(REFER_GENERIC).toBe('__REFER_GENERIC__');
  });
});
