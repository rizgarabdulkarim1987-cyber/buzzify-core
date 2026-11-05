import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { setAiProviderForTests } from '@/server/ai/provider';
import { scriptedProvider, textScriptKey } from '@/server/ai/provider/scripted';
import { searchTextOf } from '@/server/domain/pharmacy/product-identity';
import * as doctorActions from '@/server/pharmacy/actions/doctor';
import * as staffActions from '@/server/pharmacy/actions/staff';
import { doctorUserText } from '@/server/pharmacy/doctor/prompt';
import * as rxReviewQueries from '@/server/pharmacy/queries/rx-review';
import * as staffQueries from '@/server/pharmacy/queries/staff';
import { SERVER_TEXT } from '@/studio/errors';
import { quiet } from './assistant-mock';
import { NOW, person, pharmacy, prisma, resetWorld, useTestDatabase, type Person } from './fixture';
import { act, ask, codeOf, dataOf } from './stock-helpers';

/**
 * The owner's control of the AI Doctor (plan Task 9): the per-person switch (`ph.staff.setDoctor`, the OWNER only, audited, in force
 * at the next request), the staff list it is drawn from (`ph.staff.list`) and the prescription-only review (`ph.doctor.rxReview`).
 * Run through the real framework (`runAction`, `runQuery`).
 */

const QUESTION = 'Customer has a mild headache since this morning';
const ANSWER = JSON.stringify({ redFlags: [], likelyCauses: ['Tension headache'], askNext: [], options: [], tellCustomer: [], referIf: [], cautions: [], unsure: false });

interface World {
  id: string;
  a: string;
  b: string;
  other: { id: string; branch: string; owner: Person; pharmacistStaffId: string };
  owner: Person;
  manager: Person;
  pharmacist: Person;
  pharmacistStaffId: string;
  pharmacistB: Person;
  pharmacistBStaffId: string;
  cashierStaffId: string;
  stock: Person;
  accountant: Person;
}
let w: World;

const staffIdOf = async (who: Person, restaurantId: string) => (await prisma().phStaff.findFirstOrThrow({ where: { userId: who.userId, restaurantId }, select: { id: true } })).id;
const switchOf = async (staffId: string) => (await prisma().phStaff.findUniqueOrThrow({ where: { id: staffId }, select: { aiDoctor: true } })).aiDoctor;
const setDoctor = (who: Person, staffId: string, on: boolean, place: { restaurantId?: string; branchId?: string } = {}) =>
  act(who, staffActions.setDoctor, { restaurantId: w.id, ...place, staffId, on });
const audits = () => prisma().auditLog.findMany({ where: { action: 'ph.staff.setDoctor' }, orderBy: { id: 'asc' } });

async function product(restaurantId: string, fields: { tradeName: string; genericName?: string; activeIngredient?: string; rxLevel?: 'OTC' | 'RX' | 'RESTRICTED'; active?: boolean }) {
  const { tradeName, genericName = '', activeIngredient = '', rxLevel = 'OTC', active = true } = fields;
  return (
    await prisma().phProduct.create({
      data: { restaurantId, tradeName, genericName, activeIngredient, rxLevel, active, identityKey: `${tradeName}|${restaurantId}`, searchText: searchTextOf({ tradeName, genericName, activeIngredient, strength: '', form: '', manufacturer: '' }) },
      select: { id: true },
    })
  ).id;
}

beforeAll(async () => {
  useTestDatabase();
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(NOW);
  await resetWorld();
  await prisma().appPlan.create({ data: { applicationId: 'pharmacy', code: 'standard', name: { en: 'Standard' }, limits: { branches: 5, users: 20, storageMb: 50, aiMonthlyBudgetMinor: 100 } } });
  const biz = await pharmacy('StaffDoctor', { branches: 2 });
  const [a, b] = biz.branchIds as [string, string];
  await prisma().phSettings.create({ data: { restaurantId: biz.id, enabledCurrencies: ['IQD'], defaultCurrency: 'IQD' } });
  const owner = await person('sdOwner', { membership: [biz.id, 'OWNER'] });
  const manager = await person('sdManager', { staff: [biz.id, 'BRANCH_MANAGER', [a]] });
  const pharmacist = await person('sdPharmacist', { staff: [biz.id, 'PHARMACIST', [a]] });
  const pharmacistB = await person('sdPharmacistB', { staff: [biz.id, 'PHARMACIST', [b]] });
  const cashier = await person('sdCashier', { staff: [biz.id, 'CASHIER', [a]] });
  const stock = await person('sdStock', { staff: [biz.id, 'STOCK', [a]] });
  const accountant = await person('sdAccountant', { staff: [biz.id, 'ACCOUNTANT', [a]] });

  const otherBiz = await pharmacy('StaffDoctorOther');
  await prisma().phSettings.create({ data: { restaurantId: otherBiz.id, enabledCurrencies: ['IQD'], defaultCurrency: 'IQD' } });
  const otherOwner = await person('sdOtherOwner', { membership: [otherBiz.id, 'OWNER'] });
  const otherPharmacist = await person('sdOtherPharmacist', { staff: [otherBiz.id, 'PHARMACIST', [otherBiz.branchId]] });

  w = {
    id: biz.id,
    a,
    b,
    other: { id: otherBiz.id, branch: otherBiz.branchId, owner: otherOwner, pharmacistStaffId: await staffIdOf(otherPharmacist, otherBiz.id) },
    owner,
    manager,
    pharmacist,
    pharmacistStaffId: await staffIdOf(pharmacist, biz.id),
    pharmacistB,
    pharmacistBStaffId: await staffIdOf(pharmacistB, biz.id),
    cashierStaffId: await staffIdOf(cashier, biz.id),
    stock,
    accountant,
  };
}, 180_000);
beforeEach(() => {
  quiet();
  setAiProviderForTests(scriptedProvider({ [textScriptKey(doctorUserText({ mode: 'COMPLAINT', text: QUESTION }))]: ANSWER }));
  vi.stubEnv('AI_PRICE_INPUT_USD_MICRO_PER_MTOK', '1000000');
  vi.stubEnv('AI_PRICE_OUTPUT_USD_MICRO_PER_MTOK', '1000000');
  vi.stubEnv('AI_PRICE_MODEL', 'scripted-test');
});
afterEach(async () => {
  setAiProviderForTests(undefined);
  vi.unstubAllEnvs();
  useTestDatabase();
  vi.restoreAllMocks();
  vi.setSystemTime(NOW);
  await prisma().phStaff.updateMany({ where: { restaurantId: { in: [w.id, w.other.id] } }, data: { aiDoctor: false } });
});
afterAll(() => {
  vi.useRealTimers();
});

describe('ph.staff.setDoctor: who may flip the switch', () => {
  it('lets the owner switch a pharmacist on, and writes one audit entry with aiDoctor before and after', async () => {
    const before = await audits();
    const out = dataOf(await setDoctor(w.owner, w.pharmacistStaffId, true));
    expect(out).toEqual({ staffId: w.pharmacistStaffId, aiDoctor: true });
    expect(await switchOf(w.pharmacistStaffId)).toBe(true);
    const fresh = (await audits()).filter((x) => !before.some((y) => y.id === x.id));
    expect(fresh).toHaveLength(1);
    expect(fresh[0]).toMatchObject({ restaurantId: w.id, actorId: w.owner.userId, entityType: 'PhStaff', entityId: w.pharmacistStaffId, changes: { aiDoctor: { before: false, after: true } } });
  });

  it('refuses a branch manager, who holds staff.manage: only the owner decides who uses the Doctor', async () => {
    const before = (await audits()).length;
    const result = await setDoctor(w.manager, w.pharmacistStaffId, true, { branchId: w.a });
    expect(result).toMatchObject({ ok: false, error: { code: 'FORBIDDEN', message: 'Only the owner can turn the AI Doctor on or off' } });
    expect(await switchOf(w.pharmacistStaffId)).toBe(false);
    expect((await audits()).length).toBe(before);
  });

  it('refuses a pharmacist, a stock person and an accountant (no staff.manage)', async () => {
    for (const who of [w.pharmacist, w.stock, w.accountant]) expect(codeOf(await setDoctor(who, w.pharmacistStaffId, true, { branchId: w.a })), who.email).toBe('FORBIDDEN');
    expect(await switchOf(w.pharmacistStaffId)).toBe(false);
  });

  it('refuses a person whose role has no ai.use (a cashier), with the reason', async () => {
    const result = await setDoctor(w.owner, w.cashierStaffId, true);
    expect(result).toMatchObject({ ok: false, error: { code: 'INVALID', message: 'This role cannot use the AI Doctor' } });
    expect(await switchOf(w.cashierStaffId)).toBe(false);
  });

  it('does not find another business’s staff, and leaves them as they were; their owner cannot reach this business', async () => {
    expect(codeOf(await setDoctor(w.owner, w.other.pharmacistStaffId, true))).toBe('NOT_FOUND');
    expect(await switchOf(w.other.pharmacistStaffId)).toBe(false);
    expect(codeOf(await setDoctor(w.other.owner, w.pharmacistStaffId, true))).toBe('FORBIDDEN');
    expect(await switchOf(w.pharmacistStaffId)).toBe(false);
  });

  it('has every refusal in SERVER_TEXT', () => {
    for (const text of ['Only the owner can turn the AI Doctor on or off', 'This role cannot use the AI Doctor', 'Staff member not found']) expect(SERVER_TEXT[text], text).toBeTruthy();
  });
});

describe('the switch is in force at the next request', () => {
  it('on: the pharmacist is answered; off: ph.doctor.ask refuses at once', async () => {
    const askDoctor = () => act(w.pharmacist, doctorActions.askAction, { restaurantId: w.id, branchId: w.a, mode: 'COMPLAINT', text: QUESTION });
    expect(codeOf(await askDoctor())).toBe('FORBIDDEN');
    dataOf(await setDoctor(w.owner, w.pharmacistStaffId, true));
    expect(codeOf(await askDoctor())).toBe('OK');
    dataOf(await setDoctor(w.owner, w.pharmacistStaffId, false));
    expect(await askDoctor()).toMatchObject({ ok: false, error: { code: 'FORBIDDEN', message: 'The owner has not turned on the AI Doctor for you' } });
    const last = (await audits()).at(-1)!;
    expect(last.changes).toEqual({ aiDoctor: { before: true, after: false } });
  });
});

describe('ph.staff.list', () => {
  type Row = { kind: 'OWNER' | 'STAFF'; staffId: string | null; name: string; role: string; allBranches: boolean; branches: { id: string; name: string }[]; aiDoctor: boolean; eligible: boolean };
  type List = { canEdit: boolean; inPlan: boolean; rows: Row[] };
  const list = async (who: Person, place: { branchId?: string } = {}) => dataOf(await ask(who, staffQueries.list, { restaurantId: w.id, ...place })) as List;

  it('shows the owner every person, the owner row always on and not a staff row, and who may use the Doctor', async () => {
    await setDoctor(w.owner, w.pharmacistStaffId, true);
    const out = await list(w.owner);
    expect(out.canEdit).toBe(true);
    expect(out.inPlan).toBe(true);
    const owner = out.rows.find((r) => r.kind === 'OWNER')!;
    expect(owner).toMatchObject({ staffId: null, name: 'sdOwner person', role: 'OWNER', allBranches: true, aiDoctor: true, eligible: true });
    expect(out.rows[0]!.kind, 'the owner first').toBe('OWNER');
    expect(out.rows.find((r) => r.staffId === w.pharmacistStaffId)).toMatchObject({ name: 'sdPharmacist person', role: 'PHARMACIST', aiDoctor: true, eligible: true, branches: [{ id: w.a, name: 'StaffDoctor branch 1' }] });
    expect(out.rows.find((r) => r.staffId === w.cashierStaffId)).toMatchObject({ role: 'CASHIER', aiDoctor: false, eligible: false });
    expect(out.rows.find((r) => r.staffId === w.pharmacistBStaffId)).toMatchObject({ branches: [{ id: w.b, name: 'StaffDoctor branch 2' }] });
    expect(JSON.stringify(out), 'nothing of the other business').not.toMatch(/sdOther|StaffDoctorOther/);
    expect(JSON.stringify(out), 'no email').not.toContain('@');
  });

  it('shows a branch manager their branches’ people only, with the switches read-only', async () => {
    const out = await list(w.manager, { branchId: w.a });
    expect(out.canEdit).toBe(false);
    const ids = out.rows.map((r) => r.staffId);
    expect(ids).toContain(w.pharmacistStaffId);
    expect(ids, 'not branch 2’s pharmacist').not.toContain(w.pharmacistBStaffId);
    expect(JSON.stringify(out)).not.toContain(w.b);
  });

  it('refuses whoever has no staff.manage', async () => {
    for (const who of [w.pharmacist, w.stock, w.accountant]) expect(codeOf(await ask(who, staffQueries.list, { restaurantId: w.id, branchId: w.a })), who.email).toBe('FORBIDDEN');
  });
});

describe('ph.doctor.rxReview', () => {
  type Review = { items: { productId: string; tradeName: string; matched: string }[]; truncated: boolean };
  const review = async (who: Person, place: { restaurantId?: string; branchId?: string } = {}) => dataOf(await ask(who, rxReviewQueries.rxReview, { restaurantId: w.id, ...place })) as Review;
  let ids: Record<string, string>;

  beforeAll(async () => {
    ids = {
      amoxOtc: await product(w.id, { tradeName: 'Amoxil 500', genericName: 'Amoxicillin', activeIngredient: 'amoxicillin trihydrate' }),
      paracetamol: await product(w.id, { tradeName: 'Panadol', genericName: 'paracetamol', activeIngredient: 'paracetamol' }),
      amoxRx: await product(w.id, { tradeName: 'Amoxicillin RX', genericName: 'amoxicillin', rxLevel: 'RX' }),
      amoxArchived: await product(w.id, { tradeName: 'Old Amox', genericName: 'amoxicillin', active: false }),
      arabic: await product(w.id, { tradeName: 'كبسولات', activeIngredient: 'اموكسيسيلين' }),
      kurdish: await product(w.id, { tradeName: 'حەب', genericName: 'ئەمۆکسیسیلین' }),
      byTrade: await product(w.id, { tradeName: 'Augmentin 1g' }),
      otherBiz: await product(w.other.id, { tradeName: 'Amoxil other', genericName: 'amoxicillin' }),
    };
  });

  it('lists OTC products that name a prescription-only ingredient, and not paracetamol', async () => {
    const out = await review(w.owner);
    const listed = out.items.map((i) => i.productId);
    expect(listed).toEqual(expect.arrayContaining([ids.amoxOtc, ids.arabic, ids.kurdish, ids.byTrade]));
    expect(listed).not.toContain(ids.paracetamol);
    expect(listed, 'already prescription-only').not.toContain(ids.amoxRx);
    expect(listed, 'archived').not.toContain(ids.amoxArchived);
    expect(listed, 'another business').not.toContain(ids.otherBiz);
    expect(out.items.find((i) => i.productId === ids.amoxOtc)!.matched).toBe('amoxicillin');
    expect(out.truncated).toBe(false);
  });

  it('is the owner’s and a branch manager’s (staff.manage with catalog.manage) only', async () => {
    expect((await review(w.manager, { branchId: w.a })).items.map((i) => i.productId)).toContain(ids.amoxOtc);
    for (const who of [w.pharmacist, w.stock, w.accountant]) expect(codeOf(await ask(who, rxReviewQueries.rxReview, { restaurantId: w.id, branchId: w.a })), who.email).toBe('FORBIDDEN');
  });

  it('never shows another business’s products to its owner, nor this one’s to the other owner', async () => {
    const theirs = dataOf(await ask(w.other.owner, rxReviewQueries.rxReview, { restaurantId: w.other.id })) as Review;
    expect(theirs.items.map((i) => i.productId)).toEqual([ids.otherBiz]);
    expect(codeOf(await ask(w.other.owner, rxReviewQueries.rxReview, { restaurantId: w.id }))).toBe('FORBIDDEN');
  });
});
