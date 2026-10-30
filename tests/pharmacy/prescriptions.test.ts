import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import * as controlledSettingsActions from '@/server/pharmacy/actions/controlled-settings';
import * as rxActions from '@/server/pharmacy/actions/prescriptions';
import * as controlledSettingsQueries from '@/server/pharmacy/queries/controlled-settings';
import * as rxQueries from '@/server/pharmacy/queries/prescriptions';
import { listPrescriptions } from '@/server/pharmacy/prescription-reads';
import { withIntakeStorage } from '@/server/pharmacy/intake/storage';
import { scopedClient } from '@/server/data/tenant-db';
import { grant, NOW, asPh, person, pharmacy, prisma, resetWorld, useTestDatabase, type Person } from './fixture';
import { memoryIntakeStorage } from './intake-helpers';
import { act, ask, codeOf, dataOf, phCodeOf } from './stock-helpers';

/**
 * Prescriptions (phase 7, task 2): recording a draft, its idempotency, the dates and the identity note, who may do what, the
 * business and branch walls, the files (type from the bytes, size, private storage) and the controlled-drug settings. The
 * controlled sale and the register are in controlled.test.ts; the file gate in rx-attachment-gate.test.ts.
 */

interface World {
  a: { id: string; branchId: string; branchIds: string[] };
  b: { id: string; branchId: string };
  b1: string;
  b2: string;
  owner: Person;
  manager: Person;
  pharmacist: Person;
  cashier: Person;
  accountant: Person;
  stock: Person;
  ownerB: Person;
  support: Person;
}

let seq = 0;
const key = (label: string) => `${label}-${(seq += 1)}-${'x'.repeat(8)}`;

async function world(): Promise<World> {
  const a = await pharmacy('A', { branches: 2 });
  const b = await pharmacy('B');
  const [b1, b2] = a.branchIds as [string, string];
  const owner = await person('owner', { membership: [a.id, 'OWNER'] });
  const manager = await person('manager', { staff: [a.id, 'BRANCH_MANAGER', [b1]] });
  const pharmacist = await person('pharmacist', { staff: [a.id, 'PHARMACIST', [b1]] });
  const cashier = await person('cashier', { staff: [a.id, 'CASHIER', [b1]] });
  const accountant = await person('accountant', { staff: [a.id, 'ACCOUNTANT', [b1]] });
  const stock = await person('stock', { staff: [a.id, 'STOCK', [b1]] });
  const ownerB = await person('ownerB', { membership: [b.id, 'OWNER'] });
  const support = await person('support', { superAdmin: true });
  await grant(support, a.id, { scopes: ['catalog.read', 'sales.read', 'stock.read'] });
  await prisma().phSettings.create({ data: { restaurantId: a.id } });
  await prisma().phSettings.create({ data: { restaurantId: b.id } });
  return { a, b, b1, b2, owner, manager, pharmacist, cashier, accountant, stock, ownerB, support };
}

const rx = (w: World, over: Record<string, unknown> = {}) => ({
  restaurantId: w.a.id,
  branchId: w.b1,
  clientKey: key('rx'),
  number: 'AB 1234',
  prescriberName: 'Dr Strange',
  prescriberLicense: 'LIC-77',
  patientName: 'Layla Hassan',
  patientIdNote: 'National ID: 4821',
  issuedOn: '2026-10-20',
  ...over,
});

const PNG = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.from('not really a picture but it starts like one')]);
const PDF = Buffer.from('%PDF-1.4\n1 0 obj\n<<>>\nendobj\n%%EOF');
const attachInput = (w: World, prescriptionId: string, bytes: Uint8Array, over: Record<string, unknown> = {}) => ({
  restaurantId: w.a.id,
  branchId: w.b1,
  prescriptionId,
  base64: Buffer.from(bytes).toString('base64'),
  ...over,
});

let restoreStorage: () => void;
let storage: ReturnType<typeof memoryIntakeStorage>;

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
  storage = memoryIntakeStorage();
  restoreStorage = withIntakeStorage(storage);
});
afterEach(() => {
  restoreStorage();
  vi.setSystemTime(NOW);
});

describe('recording a prescription', () => {
  it('stores a draft with no sale, the number tidied, and answers with ids only', async () => {
    const w = await world();
    const made = dataOf(await act(w.pharmacist, rxActions.create, rx(w, { number: '  ab   1234 ' })));
    expect(made).toMatchObject({ branchId: w.b1, issuedOn: '2026-10-20', saleId: null, replayed: false });
    const row = await prisma().phPrescription.findUniqueOrThrow({ where: { id: made.id } });
    expect(row).toMatchObject({
      restaurantId: w.a.id,
      branchId: w.b1,
      number: 'ab 1234',
      prescriberName: 'Dr Strange',
      prescriberLicense: 'LIC-77',
      patientName: 'Layla Hassan',
      patientIdNote: 'National ID: 4821',
      saleId: null,
      createdById: w.pharmacist.userId,
    });
    expect(row.issuedOn.toISOString().slice(0, 10)).toBe('2026-10-20');
  });

  it('stores empty optional fields as null', async () => {
    const w = await world();
    const made = dataOf(await act(w.pharmacist, rxActions.create, rx(w, { prescriberLicense: '', patientName: '', patientIdNote: undefined })));
    const row = await prisma().phPrescription.findUniqueOrThrow({ where: { id: made.id } });
    expect([row.prescriberLicense, row.patientName, row.patientIdNote]).toEqual([null, null, null]);
  });

  it('replays the same key and content as one row, and refuses the key for other content or another person', async () => {
    const w = await world();
    const input = rx(w);
    const first = dataOf(await act(w.pharmacist, rxActions.create, input));
    const again = dataOf(await act(w.pharmacist, rxActions.create, input));
    expect(again).toMatchObject({ id: first.id, replayed: true });
    expect(await prisma().phPrescription.count()).toBe(1);

    expect(phCodeOf(await act(w.pharmacist, rxActions.create, { ...input, patientName: 'Someone Else' }))).toBe('CLIENT_KEY_MISMATCH');
    expect(phCodeOf(await act(w.owner, rxActions.create, input))).toBe('CLIENT_KEY_MISMATCH');
    expect(await prisma().phPrescription.count()).toBe(1);
    // A replay writes no second audit row.
    expect(await prisma().auditLog.count({ where: { action: 'ph.rx.create' } })).toBe(1);
  });

  it('makes one row of two parallel creates with one key', async () => {
    const w = await world();
    const input = rx(w);
    const [one, two] = await Promise.all([act(w.pharmacist, rxActions.create, input), act(w.pharmacist, rxActions.create, input)]);
    expect([codeOf(one), codeOf(two)]).toEqual(['OK', 'OK']);
    expect(dataOf(one).id).toBe(dataOf(two).id);
    expect(await prisma().phPrescription.count()).toBe(1);
  });

  it('refuses a date in the future and one older than 180 days, and a bad identity note', async () => {
    const w = await world();
    // NOW is 2026-10-27: tomorrow is the future; 2026-04-30 is day 180 and still fine, 2026-04-29 is day 181.
    expect(phCodeOf(await act(w.pharmacist, rxActions.create, rx(w, { issuedOn: '2026-10-28' })))).toBe('RX_DATE_FUTURE');
    expect(phCodeOf(await act(w.pharmacist, rxActions.create, rx(w, { issuedOn: '2026-04-29' })))).toBe('RX_EXPIRED');
    expect(codeOf(await act(w.pharmacist, rxActions.create, rx(w, { issuedOn: '2026-04-30' })))).toBe('OK');
    expect(phCodeOf(await act(w.pharmacist, rxActions.create, rx(w, { patientIdNote: 'National ID: 123456789012' })))).toBe('ID_NOTE_TOO_LONG');
    expect(phCodeOf(await act(w.pharmacist, rxActions.create, rx(w, { patientIdNote: ': 12' })))).toBe('ID_NOTE_SHAPE');
    expect(codeOf(await act(w.pharmacist, rxActions.create, rx(w, { prescriberName: '  ' })))).toBe('INVALID');
    expect(codeOf(await act(w.pharmacist, rxActions.create, rx(w, { issuedOn: '2026-02-30' })))).toBe('INVALID');
  });

  it('puts ids, a status and a branch in the audit row and nothing the paper says', async () => {
    const w = await world();
    const made = dataOf(await act(w.pharmacist, rxActions.create, rx(w)));
    const audit = await prisma().auditLog.findFirstOrThrow({ where: { action: 'ph.rx.create' } });
    expect(audit).toMatchObject({ entityType: 'PhPrescription', entityId: made.id, actorId: w.pharmacist.userId, restaurantId: w.a.id });
    expect(audit.changes).toEqual({ status: { before: null, after: 'DRAFT' }, branchId: { before: null, after: w.b1 } });
    const text = JSON.stringify(audit);
    for (const secret of ['Dr Strange', 'LIC-77', 'Layla', '4821', 'AB 1234']) expect(text, secret).not.toContain(secret);
  });
});

describe('who may record and see prescriptions', () => {
  it('lets a pharmacist, a manager and the owner record one, and refuses the other roles and support', async () => {
    const w = await world();
    for (const who of [w.pharmacist, w.manager, w.owner]) expect(codeOf(await act(who, rxActions.create, rx(w))), who.email).toBe('OK');
    for (const who of [w.cashier, w.accountant, w.stock, w.support]) expect(codeOf(await act(who, rxActions.create, rx(w))), who.email).toBe('FORBIDDEN');
    expect(await prisma().phPrescription.count()).toBe(3);
  });

  it('refuses the branch a person does not work in', async () => {
    const w = await world();
    expect(codeOf(await act(w.pharmacist, rxActions.create, rx(w, { branchId: w.b2 })))).toBe('FORBIDDEN');
    expect(codeOf(await act(w.owner, rxActions.create, rx(w, { branchId: w.b2 })))).toBe('OK');
  });

  it('shows the patient to a pharmacist and to nobody who lacks rx.dispense, support included', async () => {
    const w = await world();
    const made = dataOf(await act(w.pharmacist, rxActions.create, rx(w)));
    const got = dataOf(await ask(w.pharmacist, rxQueries.get, { restaurantId: w.a.id, branchId: w.b1, prescriptionId: made.id }));
    expect(got).toMatchObject({ id: made.id, number: 'AB 1234', patientName: 'Layla Hassan', prescriberName: 'Dr Strange', files: [] });
    for (const who of [w.cashier, w.accountant, w.stock, w.support]) {
      expect(codeOf(await ask(who, rxQueries.get, { restaurantId: w.a.id, prescriptionId: made.id })), who.email).toBe('FORBIDDEN');
      expect(codeOf(await ask(who, rxQueries.list, { restaurantId: w.a.id })), who.email).toBe('FORBIDDEN');
    }
    // The read service itself leaves the patient out for a role without rx.dispense (a second wall behind the framework's).
    const cashierActor = (await asPh(w.cashier.userId, w.a.id))!;
    const scoped = scopedClient(prisma(), { restaurantId: w.a.id, branchIds: cashierActor.branchIds });
    const [row] = await listPrescriptions(scoped, cashierActor, { limit: 5 });
    expect(row).toBeDefined();
    expect(Object.keys(row!).sort()).toEqual(['branchId', 'createdAt', 'fileCount', 'id', 'issuedOn', 'number', 'saleId']);
  });

  it('lists newest first, and unusedOnly keeps the ones no sale has used', async () => {
    const w = await world();
    const one = dataOf(await act(w.pharmacist, rxActions.create, rx(w, { number: 'N1' })));
    vi.setSystemTime(new Date(NOW.getTime() + 1000));
    const two = dataOf(await act(w.pharmacist, rxActions.create, rx(w, { number: 'N2' })));
    const list = dataOf(await ask(w.pharmacist, rxQueries.list, { restaurantId: w.a.id, branchId: w.b1 }));
    expect(list.map((r) => r.id)).toEqual([two.id, one.id]);
    expect(dataOf(await ask(w.pharmacist, rxQueries.list, { restaurantId: w.a.id, branchId: w.b1, unusedOnly: true })).length).toBe(2);
  });
});

describe('the business and branch walls', () => {
  it('treats another business’s prescription id as not found, for a read and for a file', async () => {
    const w = await world();
    const made = dataOf(await act(w.pharmacist, rxActions.create, rx(w)));
    const read = await ask(w.ownerB, rxQueries.get, { restaurantId: w.b.id, prescriptionId: made.id });
    expect([codeOf(read), phCodeOf(read)]).toEqual(['NOT_FOUND', 'PRESCRIPTION_NOT_FOUND']);
    const missing = await ask(w.ownerB, rxQueries.get, { restaurantId: w.b.id, prescriptionId: 'does-not-exist' });
    expect(missing).toEqual(read);
    const attach = await act(w.ownerB, rxActions.attach, { restaurantId: w.b.id, branchId: w.b.branchId, prescriptionId: made.id, base64: PNG.toString('base64') });
    expect(codeOf(attach)).toBe('NOT_FOUND');
    expect(storage.objects.size).toBe(0);
    // Naming business A while being B's owner is refused outright.
    expect(codeOf(await ask(w.ownerB, rxQueries.get, { restaurantId: w.a.id, prescriptionId: made.id }))).toBe('FORBIDDEN');
  });

  it('keeps a branch-limited person out of the other branch’s prescriptions', async () => {
    const w = await world();
    const other = dataOf(await act(w.owner, rxActions.create, rx(w, { branchId: w.b2 })));
    const read = await ask(w.pharmacist, rxQueries.get, { restaurantId: w.a.id, branchId: w.b1, prescriptionId: other.id });
    expect(codeOf(read)).toBe('NOT_FOUND');
    expect(dataOf(await ask(w.pharmacist, rxQueries.list, { restaurantId: w.a.id })).length).toBe(0);
    expect(dataOf(await ask(w.owner, rxQueries.list, { restaurantId: w.a.id })).length).toBe(1);
  });
});

describe('the files of a prescription', () => {
  it('keeps a picture and a PDF in the private store with their real type, size and hash', async () => {
    const w = await world();
    const made = dataOf(await act(w.pharmacist, rxActions.create, rx(w)));
    const png = dataOf(await act(w.pharmacist, rxActions.attach, attachInput(w, made.id, PNG, { mediaType: 'application/octet-stream' })));
    const pdf = dataOf(await act(w.pharmacist, rxActions.attach, attachInput(w, made.id, PDF)));
    expect([png.mime, png.sizeBytes, pdf.mime, pdf.sizeBytes]).toEqual(['image/png', PNG.length, 'application/pdf', PDF.length]);
    const rows = await prisma().phRxAttachment.findMany({ orderBy: { createdAt: 'asc' } });
    expect(rows.map((r) => [r.prescriptionId, r.branchId, r.mime, r.sizeBytes, r.uploadedById])).toEqual([
      [made.id, w.b1, 'image/png', PNG.length, w.pharmacist.userId],
      [made.id, w.b1, 'application/pdf', PDF.length, w.pharmacist.userId],
    ]);
    // sha256 of the exact bytes, and the stored object is the upload under a key made from ids alone.
    const { createHash } = await import('node:crypto');
    expect(rows[0]!.sha256).toBe(createHash('sha256').update(PNG).digest('hex'));
    expect(rows[0]!.storageKey).toBe(`intake/${w.a.id}/rx-${rows[0]!.id}`);
    expect(Buffer.from(storage.objects.get(rows[0]!.storageKey)!.bytes).equals(PNG)).toBe(true);
    expect(storage.urls).toEqual([]);
  });

  it('judges the type by the bytes, not by the name or the type the browser claimed', async () => {
    const w = await world();
    const made = dataOf(await act(w.pharmacist, rxActions.create, rx(w)));
    const text = Buffer.from('MZ this is a program, not a picture');
    const lie = await act(w.pharmacist, rxActions.attach, attachInput(w, made.id, text, { mediaType: 'image/png' }));
    expect([codeOf(lie), phCodeOf(lie)]).toEqual(['INVALID', 'UNSUPPORTED_TYPE']);
    expect(storage.objects.size).toBe(0);
    expect(await prisma().phRxAttachment.count()).toBe(0);
  });

  it('refuses a file over 5 MB and accepts one of exactly 5 MB', async () => {
    const w = await world();
    const made = dataOf(await act(w.pharmacist, rxActions.create, rx(w)));
    const exactly = Buffer.concat([PNG, Buffer.alloc(5 * 1024 * 1024 - PNG.length)]);
    expect(exactly.length).toBe(5_242_880);
    expect(codeOf(await act(w.pharmacist, rxActions.attach, attachInput(w, made.id, exactly)))).toBe('OK');
    const over = Buffer.concat([exactly, Buffer.alloc(1)]);
    const big = await act(w.pharmacist, rxActions.attach, attachInput(w, made.id, over));
    expect([codeOf(big), phCodeOf(big)]).toEqual(['INVALID', 'TOO_LARGE']);
    expect(await prisma().phRxAttachment.count()).toBe(1);
  });

  it('removes the stored object when the row cannot be recorded', async () => {
    const w = await world();
    const made = dataOf(await act(w.pharmacist, rxActions.create, rx(w)));
    // The prescription disappears between the look and the insert: simulated by deleting it from under the upload.
    storage.hooks.onPut = async () => {
      await prisma().phPrescription.delete({ where: { id: made.id } });
    };
    expect(codeOf(await act(w.pharmacist, rxActions.attach, attachInput(w, made.id, PNG)))).toBe('NOT_FOUND');
    expect(storage.objects.size).toBe(0);
  });

  it('lets only rx.dispense upload, and writes an audit row with the type and size and no name', async () => {
    const w = await world();
    const made = dataOf(await act(w.pharmacist, rxActions.create, rx(w)));
    for (const who of [w.cashier, w.accountant, w.stock, w.support]) {
      expect(codeOf(await act(who, rxActions.attach, attachInput(w, made.id, PNG))), who.email).toBe('FORBIDDEN');
    }
    const added = dataOf(await act(w.pharmacist, rxActions.attach, attachInput(w, made.id, PNG)));
    const audit = await prisma().auditLog.findFirstOrThrow({ where: { action: 'ph.rx.file.add' } });
    expect(audit).toMatchObject({ entityType: 'PhRxAttachment', entityId: added.id });
    expect(audit.changes).toEqual({ rxId: { before: null, after: made.id }, mime: { before: null, after: 'image/png' }, bytes: { before: null, after: PNG.length } });
    expect(JSON.stringify(audit)).not.toContain('Layla');
    // The prescription now lists one file, by id and type only.
    const got = dataOf(await ask(w.pharmacist, rxQueries.get, { restaurantId: w.a.id, branchId: w.b1, prescriptionId: made.id }));
    expect(got.fileCount).toBe(1);
    expect(got.files.map((f) => [f.id, f.mime, f.sizeBytes])).toEqual([[added.id, 'image/png', PNG.length]]);
  });
});

describe('the controlled-drug settings', () => {
  it('reads the defaults, saves with the version, audits the values, and refuses a stale save', async () => {
    const w = await world();
    const before = dataOf(await ask(w.pharmacist, controlledSettingsQueries.get, { restaurantId: w.a.id }));
    expect(before).toEqual({ controlledEnabled: false, controlledMaxQty: 30, rxRetentionDays: 3650, version: 1 });

    const save = { restaurantId: w.a.id, controlledEnabled: true, controlledMaxQty: 20, rxRetentionDays: 1825, version: 1 };
    expect(dataOf(await act(w.owner, controlledSettingsActions.set, save))).toEqual({ controlledEnabled: true, controlledMaxQty: 20, rxRetentionDays: 1825, version: 2 });
    expect(dataOf(await ask(w.pharmacist, controlledSettingsQueries.get, { restaurantId: w.a.id }))).toMatchObject({ controlledEnabled: true, controlledMaxQty: 20, version: 2 });

    const audit = await prisma().auditLog.findFirstOrThrow({ where: { action: 'ph.settings.controlled.set' } });
    expect(audit.changes).toEqual({
      controlledEnabled: { before: false, after: true },
      controlledMaxQty: { before: 30, after: 20 },
      rxRetentionDays: { before: 3650, after: 1825 },
    });
    // A second save from the old version is a conflict, and changes nothing.
    expect(codeOf(await act(w.owner, controlledSettingsActions.set, { ...save, controlledMaxQty: 5 }))).toBe('CONFLICT');
    expect((await prisma().phSettings.findFirstOrThrow({ where: { restaurantId: w.a.id } })).controlledMaxQty).toBe(20);
  });

  it('reads a row made before phase 7 (no retention) as 10 years', async () => {
    const w = await world();
    await prisma().phSettings.update({ where: { restaurantId: w.a.id }, data: { rxRetentionDays: null } });
    expect(dataOf(await ask(w.owner, controlledSettingsQueries.get, { restaurantId: w.a.id })).rxRetentionDays).toBe(3650);
  });

  it('is the owner’s to change: a manager, a pharmacist and support are refused', async () => {
    const w = await world();
    const save = { restaurantId: w.a.id, controlledEnabled: true, controlledMaxQty: 20, rxRetentionDays: 1825, version: 1 };
    for (const who of [w.manager, w.pharmacist, w.cashier, w.support]) expect(codeOf(await act(who, controlledSettingsActions.set, save)), who.email).toBe('FORBIDDEN');
    expect((await prisma().phSettings.findFirstOrThrow({ where: { restaurantId: w.a.id } })).controlledEnabled).toBe(false);
  });

  it('validates the values', async () => {
    const w = await world();
    const save = { restaurantId: w.a.id, controlledEnabled: true, controlledMaxQty: 20, rxRetentionDays: 1825, version: 1 };
    for (const bad of [{ controlledMaxQty: -1 }, { controlledMaxQty: 1.5 }, { rxRetentionDays: 0 }, { rxRetentionDays: 40_000 }, { version: 0 }]) {
      expect(codeOf(await act(w.owner, controlledSettingsActions.set, { ...save, ...bad })), JSON.stringify(bad)).toBe('INVALID');
    }
    expect(codeOf(await act(w.owner, controlledSettingsActions.set, { ...save, controlledMaxQty: 0 }))).toBe('OK');
  });
});
