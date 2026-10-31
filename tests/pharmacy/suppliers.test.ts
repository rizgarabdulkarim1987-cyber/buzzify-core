import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import * as supplierActions from '@/server/pharmacy/actions/suppliers';
import * as supplierQueries from '@/server/pharmacy/queries/suppliers';
import { loadActor, type Actor } from '@/server/studio/auth/actor';
import { runAction, type ActionDef } from '@/server/studio/framework/action';
import { runQuery, type QueryDef } from '@/server/studio/framework/query';
import type { ActionResult } from '@/server/studio/framework/result';
import { grant, NOW, person, pharmacy, prisma, resetWorld, useTestDatabase, type Person } from './fixture';

const META = { ip: '203.0.113.19', userAgent: 'vitest' };
const codeOf = (result: ActionResult<unknown>) => (result.ok ? 'OK' : result.error.code);
const phCodeOf = (result: ActionResult<unknown>) => (result.ok ? null : (result.error.fields?.phCode ?? null));
const actorOf = async (who: Person): Promise<Actor> => (await loadActor(prisma(), who.userId)) as Actor;
const act = async <I, O>(who: Person, def: ActionDef<I, O>, input: unknown) => runAction(prisma(), await actorOf(who), def, input, META);
const ask = async <I, O>(who: Person, def: QueryDef<I, O>, input: unknown) => runQuery(prisma(), await actorOf(who), def, input);
const dataOf = <T>(result: ActionResult<T>): T => {
  if (!result.ok) throw new Error(`expected OK, got ${result.error.code}: ${result.error.message} ${JSON.stringify(result.error)}`);
  return result.data;
};

let keySeq = 0;
const create = (restaurantId: string, over: Record<string, unknown> = {}) => ({
  restaurantId,
  clientKey: `supplier-key-${(keySeq += 1)}`,
  name: 'Al-Noor Pharma',
  phone: '+964 770 000 0000',
  contactName: 'Sara',
  addressNote: 'Baghdad, Karrada',
  defaultCurrency: 'USD',
  termsDays: 30,
  note: 'Delivers on Sundays',
  ...over,
});

async function world() {
  const a = await pharmacy('A', { branches: 2 });
  const owner = await person('owner', { membership: [a.id, 'OWNER'] });
  return { a, owner };
}

beforeAll(() => {
  useTestDatabase();
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(NOW);
});
afterAll(() => {
  vi.useRealTimers();
});
beforeEach(resetWorld);
afterEach(() => {
  vi.setSystemTime(NOW);
});

describe('creating a supplier', () => {
  it('stores the fields, a normalised name key, and audits ids and settings only', async () => {
    const { a, owner } = await world();
    const made = dataOf(await act(owner, supplierActions.create, create(a.id, { name: '  Al-Noor   Pharma ' })));
    expect(made).toMatchObject({ version: 1, active: true, replayed: false });
    const row = await prisma().phSupplier.findUniqueOrThrow({ where: { id: made.id } });
    expect(row).toMatchObject({
      restaurantId: a.id,
      name: 'Al-Noor Pharma',
      nameKey: 'al-noor pharma',
      phone: '+964 770 000 0000',
      contactName: 'Sara',
      addressNote: 'Baghdad, Karrada',
      defaultCurrency: 'USD',
      termsDays: 30,
      active: true,
      note: 'Delivers on Sundays',
      createdById: owner.userId,
    });
    const audit = await prisma().auditLog.findMany({ where: { action: 'ph.supplier.create', entityId: made.id } });
    expect(audit).toHaveLength(1);
    const text = JSON.stringify(audit[0]!.changes);
    for (const secret of ['Al-Noor', 'Sara', 'Karrada', '770', 'Sundays']) expect(text).not.toContain(secret);
    expect(audit[0]!.changes).toMatchObject({ defaultCurrency: { after: 'USD' }, termsDays: { after: 30 }, active: { after: true }, version: { after: 1 } });
  });

  it('validates the fields', async () => {
    const { a, owner } = await world();
    const bad: Record<string, unknown>[] = [
      { name: '   ' },
      { name: '\u200B\u200E' },
      { name: 'x'.repeat(121) },
      { phone: 'x'.repeat(41) },
      { contactName: 'x'.repeat(121) },
      { addressNote: 'x'.repeat(301) },
      { note: 'x'.repeat(501) },
      { defaultCurrency: 'EUR' },
      { termsDays: -1 },
      { termsDays: 366 },
      { termsDays: 1.5 },
      { clientKey: 'short' },
    ];
    for (const over of bad) expect(codeOf(await act(owner, supplierActions.create, create(a.id, over))), JSON.stringify(over)).toBe('INVALID');
    expect(await prisma().phSupplier.count()).toBe(0);
  });

  it('refuses a name that differs only in case, spacing or zero-width characters', async () => {
    const { a, owner } = await world();
    dataOf(await act(owner, supplierActions.create, create(a.id, { name: 'Al Noor' })));
    for (const name of ['AL NOOR', 'al   noor', ' Al\u200B Noor ', 'Al\u200B\u200E Noor']) {
      const refused = await act(owner, supplierActions.create, create(a.id, { name }));
      expect(codeOf(refused), name).toBe('CONFLICT');
      expect(phCodeOf(refused)).toBe('SUPPLIER_EXISTS');
    }
    expect(await prisma().phSupplier.count()).toBe(1);
  });

  it('treats an Arabic letter mark, a right-to-left override, ZWNJ and compatibility forms as no difference in a name', async () => {
    const { a, owner } = await world();
    dataOf(await act(owner, supplierActions.create, create(a.id, { name: 'AlNoor' })));
    for (const name of ['Al\u061CNoor', 'Al\u202ENoor', 'Al\u200CNoor', 'Al\u2066Noor\u2069', 'ＡlNoor']) {
      const refused = await act(owner, supplierActions.create, create(a.id, { name }));
      expect(codeOf(refused), JSON.stringify(name)).toBe('CONFLICT');
      expect(phCodeOf(refused)).toBe('SUPPLIER_EXISTS');
    }
    expect(await prisma().phSupplier.count()).toBe(1);
  });

  it('keeps ZWNJ and line breaks where they mean something, and strips bidi controls, in the stored text', async () => {
    const { a, owner } = await world();
    const made = dataOf(
      await act(owner, supplierActions.create, create(a.id, { name: 'My\u200Cname', contactName: 'Sa\u202Era', phone: '077\u200E0', addressNote: 'Line one\nLine two', note: 'a\n\nb' })),
    );
    const row = await prisma().phSupplier.findUniqueOrThrow({ where: { id: made.id } });
    expect(row.name).toBe('My\u200Cname');
    expect(row.contactName).toBe('Sara');
    expect(row.phone).toBe('0770');
    expect(row.addressNote).toBe('Line one\nLine two');
    expect(row.note).toBe('a\n\nb');
  });

  it('stores a payload hash, and replays the original create after the supplier was edited', async () => {
    const { a, owner } = await world();
    const body = create(a.id);
    const first = dataOf(await act(owner, supplierActions.create, body));
    expect((await prisma().phSupplier.findUniqueOrThrow({ where: { id: first.id } })).payloadHash).toMatch(/^[0-9a-f]{64}$/);
    const { clientKey, ...fields } = body;
    void clientKey;
    dataOf(await act(owner, supplierActions.update, { ...fields, supplierId: first.id, expectedVersion: 1, name: 'Renamed', termsDays: 7 }));
    const again = dataOf(await act(owner, supplierActions.create, body));
    expect(again).toMatchObject({ id: first.id, replayed: true });
    // The edited fields are NOT the original request: a create with them under the same key is a different payload.
    const edited = await act(owner, supplierActions.create, { ...body, name: 'Renamed', termsDays: 7 });
    expect(phCodeOf(edited)).toBe('CLIENT_KEY_MISMATCH');
    expect(await prisma().phSupplier.count()).toBe(1);
  });

  it('falls back to the stored fields for a row with no hash', async () => {
    const { a, owner } = await world();
    const body = create(a.id);
    const first = dataOf(await act(owner, supplierActions.create, body));
    await prisma().phSupplier.update({ where: { id: first.id }, data: { payloadHash: null } });
    expect(dataOf(await act(owner, supplierActions.create, body))).toMatchObject({ id: first.id, replayed: true });
    expect(phCodeOf(await act(owner, supplierActions.create, { ...body, termsDays: 9 }))).toBe('CLIENT_KEY_MISMATCH');
  });

  it('lets two businesses use the same name', async () => {
    const { a, owner } = await world();
    const b = await pharmacy('B');
    const ownerB = await person('ownerb', { membership: [b.id, 'OWNER'] });
    dataOf(await act(owner, supplierActions.create, create(a.id)));
    dataOf(await act(ownerB, supplierActions.create, create(b.id)));
    expect(await prisma().phSupplier.count()).toBe(2);
  });

  it('replays the same key and payload as one row, replayed: true', async () => {
    const { a, owner } = await world();
    const body = create(a.id);
    const first = dataOf(await act(owner, supplierActions.create, body));
    const again = dataOf(await act(owner, supplierActions.create, body));
    expect(again).toMatchObject({ id: first.id, replayed: true });
    expect(await prisma().phSupplier.count()).toBe(1);
    expect(await prisma().auditLog.count({ where: { action: 'ph.supplier.create' } })).toBe(1);
  });

  it('refuses the same key with a different payload or a different user', async () => {
    const { a, owner } = await world();
    const manager = await person('mgr', { staff: [a.id, 'PHARMACIST_IN_CHARGE', [a.branchId]] });
    const body = create(a.id);
    dataOf(await act(owner, supplierActions.create, body));
    const other = await act(owner, supplierActions.create, { ...body, termsDays: 45 });
    expect(codeOf(other)).toBe('CONFLICT');
    expect(phCodeOf(other)).toBe('CLIENT_KEY_MISMATCH');
    const otherUser = await act(manager, supplierActions.create, body);
    expect(phCodeOf(otherUser)).toBe('CLIENT_KEY_MISMATCH');
    expect(await prisma().phSupplier.count()).toBe(1);
  });

  it('keeps one row when two creates with one key run at once', async () => {
    const { a, owner } = await world();
    const body = create(a.id);
    const results = await Promise.all([act(owner, supplierActions.create, body), act(owner, supplierActions.create, body)]);
    expect(results.map(codeOf)).toEqual(['OK', 'OK']);
    expect(await prisma().phSupplier.count()).toBe(1);
    expect(results.filter((r) => r.ok && r.data.replayed)).toHaveLength(1);
  });

  it('keeps one row when two different keys race for one name', async () => {
    const { a, owner } = await world();
    const results = await Promise.all([act(owner, supplierActions.create, create(a.id)), act(owner, supplierActions.create, create(a.id))]);
    expect(results.map(codeOf).sort()).toEqual(['CONFLICT', 'OK']);
    expect(await prisma().phSupplier.count()).toBe(1);
  });
});

describe('updating a supplier', () => {
  const edit = (a: { id: string }, supplierId: string, expectedVersion: number, over: Record<string, unknown> = {}) => {
    const { clientKey, ...rest } = create(a.id);
    void clientKey;
    return { ...rest, supplierId, expectedVersion, ...over };
  };

  it('saves the fields, bumps the version and audits ids and settings only', async () => {
    const { a, owner } = await world();
    const made = dataOf(await act(owner, supplierActions.create, create(a.id)));
    const saved = dataOf(await act(owner, supplierActions.update, edit(a, made.id, 1, { name: 'Al Noor Medical', termsDays: 14, defaultCurrency: 'IQD', phone: '' })));
    expect(saved).toMatchObject({ id: made.id, version: 2 });
    const row = await prisma().phSupplier.findUniqueOrThrow({ where: { id: made.id } });
    expect(row).toMatchObject({ name: 'Al Noor Medical', nameKey: 'al noor medical', termsDays: 14, defaultCurrency: 'IQD', phone: '', version: 2 });
    const audit = await prisma().auditLog.findMany({ where: { action: 'ph.supplier.update', entityId: made.id } });
    expect(audit).toHaveLength(1);
    const text = JSON.stringify(audit[0]!.changes);
    for (const secret of ['Noor', 'Sara', 'Karrada', 'Sundays']) expect(text).not.toContain(secret);
    expect(audit[0]!.changes).toMatchObject({ version: { before: 1, after: 2 }, termsDays: { before: 30, after: 14 }, defaultCurrency: { before: 'USD', after: 'IQD' } });
  });

  it('refuses a stale expectedVersion with CONFLICT and changes nothing', async () => {
    const { a, owner } = await world();
    const made = dataOf(await act(owner, supplierActions.create, create(a.id)));
    dataOf(await act(owner, supplierActions.update, edit(a, made.id, 1, { note: 'first' })));
    const stale = await act(owner, supplierActions.update, edit(a, made.id, 1, { note: 'second' }));
    expect(codeOf(stale)).toBe('CONFLICT');
    expect((await prisma().phSupplier.findUniqueOrThrow({ where: { id: made.id } })).note).toBe('first');
  });

  it('refuses a rename to another supplier name, but allows keeping or re-casing its own', async () => {
    const { a, owner } = await world();
    const one = dataOf(await act(owner, supplierActions.create, create(a.id, { name: 'One' })));
    dataOf(await act(owner, supplierActions.create, create(a.id, { name: 'Two' })));
    const taken = await act(owner, supplierActions.update, edit(a, one.id, 1, { name: ' two ' }));
    expect(codeOf(taken)).toBe('CONFLICT');
    expect(phCodeOf(taken)).toBe('SUPPLIER_EXISTS');
    expect(dataOf(await act(owner, supplierActions.update, edit(a, one.id, 1, { name: 'ONE' }))).version).toBe(2);
  });
});

describe('archiving a supplier', () => {
  it('archives and unarchives, hides from the default list, and audits', async () => {
    const { a, owner } = await world();
    const made = dataOf(await act(owner, supplierActions.create, create(a.id)));
    const off = dataOf(await act(owner, supplierActions.archive, { restaurantId: a.id, supplierId: made.id, archived: true }));
    expect(off).toMatchObject({ id: made.id, active: false, version: 2 });
    expect((await prisma().phSupplier.findUniqueOrThrow({ where: { id: made.id } })).active).toBe(false);
    expect(dataOf(await ask(owner, supplierQueries.list, { restaurantId: a.id })).items).toHaveLength(0);
    const on = dataOf(await act(owner, supplierActions.archive, { restaurantId: a.id, supplierId: made.id, archived: false }));
    expect(on).toMatchObject({ active: true, version: 3 });
    expect(dataOf(await ask(owner, supplierQueries.list, { restaurantId: a.id })).items).toHaveLength(1);
    expect(await prisma().auditLog.count({ where: { action: 'ph.supplier.archive', entityId: made.id } })).toBe(2);
  });

  it('is a no-op (no version bump, no audit) when already in that state', async () => {
    const { a, owner } = await world();
    const made = dataOf(await act(owner, supplierActions.create, create(a.id)));
    const same = dataOf(await act(owner, supplierActions.archive, { restaurantId: a.id, supplierId: made.id, archived: false }));
    expect(same).toMatchObject({ active: true, version: 1 });
    expect(await prisma().auditLog.count({ where: { action: 'ph.supplier.archive' } })).toBe(0);
  });
});

describe('reading suppliers', () => {
  async function many() {
    const { a, owner } = await world();
    const rows = Array.from({ length: 55 }, (_, i) => ({
      restaurantId: a.id,
      name: `Supplier ${String(i + 1).padStart(2, '0')}`,
      nameKey: `supplier ${String(i + 1).padStart(2, '0')}`,
      phone: i === 6 ? '0770-555' : '',
      defaultCurrency: 'IQD' as const,
      clientKey: `seed-key-${i + 1}`,
      createdById: owner.userId,
    }));
    await prisma().phSupplier.createMany({ data: rows });
    return { a, owner };
  }

  it('pages 50 at a time in name order with a cursor', async () => {
    const { a, owner } = await many();
    const first = dataOf(await ask(owner, supplierQueries.list, { restaurantId: a.id }));
    expect(first.items).toHaveLength(50);
    expect(first.items[0]!.name).toBe('Supplier 01');
    expect(first.nextCursor).not.toBeNull();
    const second = dataOf(await ask(owner, supplierQueries.list, { restaurantId: a.id, cursor: first.nextCursor }));
    expect(second.items.map((s) => s.name)).toEqual(['Supplier 51', 'Supplier 52', 'Supplier 53', 'Supplier 54', 'Supplier 55']);
    expect(second.nextCursor).toBeNull();
  });

  it('searches by name or phone and filters by active', async () => {
    const { a, owner } = await many();
    const byName = dataOf(await ask(owner, supplierQueries.list, { restaurantId: a.id, search: 'SUPPLIER 12' }));
    expect(byName.items.map((s) => s.name)).toEqual(['Supplier 12']);
    const byPhone = dataOf(await ask(owner, supplierQueries.list, { restaurantId: a.id, search: '555' }));
    expect(byPhone.items.map((s) => s.name)).toEqual(['Supplier 07']);
    const seven = byPhone.items[0]!;
    dataOf(await act(owner, supplierActions.archive, { restaurantId: a.id, supplierId: seven.id, archived: true }));
    expect(dataOf(await ask(owner, supplierQueries.list, { restaurantId: a.id, search: '555' })).items).toHaveLength(0);
    expect(dataOf(await ask(owner, supplierQueries.list, { restaurantId: a.id, search: '555', active: false })).items).toHaveLength(1);
    const all = dataOf(await ask(owner, supplierQueries.list, { restaurantId: a.id, active: 'all', search: 'Supplier 07' }));
    expect(all.items).toHaveLength(1);
  });

  it('gets one supplier with every field', async () => {
    const { a, owner } = await world();
    const made = dataOf(await act(owner, supplierActions.create, create(a.id)));
    const got = dataOf(await ask(owner, supplierQueries.get, { restaurantId: a.id, supplierId: made.id }));
    expect(got).toMatchObject({ id: made.id, name: 'Al-Noor Pharma', phone: '+964 770 000 0000', contactName: 'Sara', addressNote: 'Baghdad, Karrada', defaultCurrency: 'USD', termsDays: 30, active: true, note: 'Delivers on Sundays', version: 1 });
    expect(JSON.stringify(got)).not.toContain('nameKey');
  });

  it('is business-wide: a user at branch 2 sees what was made at branch 1', async () => {
    const { a, owner } = await world();
    const made = dataOf(await act(owner, supplierActions.create, { ...create(a.id), branchId: a.branchIds[0] }));
    const clerk = await person('clerk', { staff: [a.id, 'ACCOUNTANT', [a.branchIds[1]!]] });
    const listed = dataOf(await ask(clerk, supplierQueries.list, { restaurantId: a.id, branchId: a.branchIds[1] }));
    expect(listed.items.map((s) => s.id)).toEqual([made.id]);
    expect(dataOf(await ask(clerk, supplierQueries.get, { restaurantId: a.id, branchId: a.branchIds[1], supplierId: made.id })).id).toBe(made.id);
  });
});

describe('who may use suppliers', () => {
  it('allows BRANCH_MANAGER, PHARMACIST_IN_CHARGE, STOCK and ACCOUNTANT (the holders of purchase.manage); refuses PHARMACIST, CASHIER and a support grant', async () => {
    const { a, owner } = await world();
    const made = dataOf(await act(owner, supplierActions.create, create(a.id)));
    for (const role of ['BRANCH_MANAGER', 'PHARMACIST_IN_CHARGE', 'STOCK', 'ACCOUNTANT'] as const) {
      const who = await person(role.toLowerCase(), { staff: [a.id, role, [a.branchId]] });
      expect(codeOf(await act(who, supplierActions.create, create(a.id, { name: `By ${role}` }))), role).toBe('OK');
      expect(codeOf(await ask(who, supplierQueries.list, { restaurantId: a.id })), role).toBe('OK');
    }
    for (const role of ['PHARMACIST', 'CASHIER'] as const) {
      const who = await person(role.toLowerCase(), { staff: [a.id, role, [a.branchId]] });
      expect(codeOf(await act(who, supplierActions.create, create(a.id, { name: `By ${role}` }))), role).toBe('FORBIDDEN');
      expect(codeOf(await act(who, supplierActions.update, { ...create(a.id), supplierId: made.id, expectedVersion: 1 })), role).toBe('FORBIDDEN');
      expect(codeOf(await act(who, supplierActions.archive, { restaurantId: a.id, supplierId: made.id, archived: true })), role).toBe('FORBIDDEN');
      expect(codeOf(await ask(who, supplierQueries.list, { restaurantId: a.id })), role).toBe('FORBIDDEN');
      expect(codeOf(await ask(who, supplierQueries.get, { restaurantId: a.id, supplierId: made.id })), role).toBe('FORBIDDEN');
    }
    const admin = await person('support', { superAdmin: true });
    await grant(admin, a.id, { scopes: ['catalog.read', 'stock.read'] });
    expect(codeOf(await act(admin, supplierActions.create, create(a.id, { name: 'By support' })))).not.toBe('OK');
    expect(codeOf(await ask(admin, supplierQueries.list, { restaurantId: a.id }))).not.toBe('OK');
    expect(await prisma().phSupplier.count({ where: { name: { startsWith: 'By ' } } })).toBe(4);
  });
});

describe('another business', () => {
  it('treats a foreign supplier id as not found on get, update and archive, and leaves it unchanged', async () => {
    const { a, owner } = await world();
    const b = await pharmacy('B');
    const ownerB = await person('ownerb', { membership: [b.id, 'OWNER'] });
    const theirs = dataOf(await act(ownerB, supplierActions.create, create(b.id, { name: 'Theirs' })));
    const before = await prisma().phSupplier.findUniqueOrThrow({ where: { id: theirs.id } });
    expect(codeOf(await ask(owner, supplierQueries.get, { restaurantId: a.id, supplierId: theirs.id }))).toBe('NOT_FOUND');
    expect(codeOf(await act(owner, supplierActions.update, { ...create(a.id), supplierId: theirs.id, expectedVersion: 1 }))).toBe('NOT_FOUND');
    expect(codeOf(await act(owner, supplierActions.archive, { restaurantId: a.id, supplierId: theirs.id, archived: true }))).toBe('NOT_FOUND');
    expect(await prisma().phSupplier.findUniqueOrThrow({ where: { id: theirs.id } })).toEqual(before);
    expect(dataOf(await ask(owner, supplierQueries.list, { restaurantId: a.id })).items).toHaveLength(0);
    // Naming B's pharmacy outright is refused by the framework, for every definition, and B is left as it was.
    for (const refused of [
      await act(owner, supplierActions.create, create(b.id, { name: 'Planted' })),
      await act(owner, supplierActions.update, { ...create(b.id), supplierId: theirs.id, expectedVersion: 1 }),
      await act(owner, supplierActions.archive, { restaurantId: b.id, supplierId: theirs.id, archived: true }),
      await ask(owner, supplierQueries.get, { restaurantId: b.id, supplierId: theirs.id }),
      await ask(owner, supplierQueries.list, { restaurantId: b.id }),
    ]) {
      expect(['FORBIDDEN', 'NOT_FOUND']).toContain(codeOf(refused));
    }
    expect(await prisma().phSupplier.findUniqueOrThrow({ where: { id: theirs.id } })).toEqual(before);
    expect(await prisma().phSupplier.count({ where: { restaurantId: b.id } })).toBe(1);
    expect(await prisma().phSupplier.count({ where: { restaurantId: a.id } })).toBe(0);
  });
});
