import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { GET } from '@/app/api/pharmacy/rx-attachments/[id]/route';
import { POST } from '@/app/api/pharmacy/rx-attachments/route';
import { scopedClient } from '@/server/data/tenant-db';
import * as rxActions from '@/server/pharmacy/actions/prescriptions';
import { withIntakeStorage } from '@/server/pharmacy/intake/storage';
import { readAttachment } from '@/server/pharmacy/prescriptions';
import * as rxQueries from '@/server/pharmacy/queries/prescriptions';
import { asPh, grant, NOW, person, pharmacy, prisma, resetWorld, useTestDatabase, type Person } from './fixture';
import { memoryIntakeStorage } from './intake-helpers';
import { act, ask, codeOf, dataOf } from './stock-helpers';

/**
 * The gate on prescription files (phase 7, task 2; R7-3): the bytes leave the store only through `readAttachment`, for a person
 * holding `rx.attachment.view`, checked on EVERY read at the function, at the query and at the route; a support actor never reads;
 * another business's file is not found; every read is audited by count; the route answers with `Cache-Control: private, no-store`.
 * The session is replaced by an `x-test-user` header (the real session library needs a browser's cookies).
 */

vi.mock('@/server/studio/auth/actor', async (importOriginal) => {
  const original = await importOriginal<typeof import('@/server/studio/auth/actor')>();
  const { getPrisma } = await import('@/server/data/prisma');
  return {
    ...original,
    actorFromHeaders: async (_prisma: unknown, headers: Headers) => {
      const id = headers.get('x-test-user');
      return id ? original.loadActor(getPrisma(), id) : null;
    },
  };
});

interface World {
  a: { id: string; branchId: string; branchIds: string[] };
  b: { id: string; branchId: string };
  b1: string;
  owner: Person;
  pharmacist: Person;
  cashier: Person;
  accountant: Person;
  stock: Person;
  ownerB: Person;
  support: Person;
  rxId: string;
  fileId: string;
}

const PNG = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.from('the exact bytes that were uploaded', 'utf8')]);
let seq = 0;
let restore: () => void;
let storage: ReturnType<typeof memoryIntakeStorage>;

async function world(): Promise<World> {
  const a = await pharmacy('A', { branches: 2 });
  const b = await pharmacy('B');
  const [b1] = a.branchIds as [string, string];
  const owner = await person('owner', { membership: [a.id, 'OWNER'] });
  const pharmacist = await person('pharmacist', { staff: [a.id, 'PHARMACIST', [b1]] });
  const cashier = await person('cashier', { staff: [a.id, 'CASHIER', [b1]] });
  const accountant = await person('accountant', { staff: [a.id, 'ACCOUNTANT', [b1]] });
  const stock = await person('stock', { staff: [a.id, 'STOCK', [b1]] });
  const ownerB = await person('ownerB', { membership: [b.id, 'OWNER'] });
  const support = await person('support', { superAdmin: true });
  await grant(support, a.id, { scopes: ['catalog.read', 'sales.read', 'stock.read'] });
  const made = dataOf(
    await act(pharmacist, rxActions.create, {
      restaurantId: a.id, branchId: b1, clientKey: `rx-gate-${(seq += 1)}-xxxxxxxx`, number: 'GATE 1', prescriberName: 'Dr Strange', patientName: 'Layla Hassan', issuedOn: '2026-10-20',
    }),
  );
  const file = dataOf(await act(pharmacist, rxActions.attach, { restaurantId: a.id, branchId: b1, prescriptionId: made.id, base64: PNG.toString('base64') }));
  return { a, b, b1, owner, pharmacist, cashier, accountant, stock, ownerB, support, rxId: made.id, fileId: file.id };
}

const url = (w: World, id: string, over: { restaurantId?: string | null; branchId?: string | null } = {}) => {
  const q = new URLSearchParams();
  const restaurantId = over.restaurantId === undefined ? w.a.id : over.restaurantId;
  const branchId = over.branchId === undefined ? w.b1 : over.branchId;
  if (restaurantId) q.set('restaurantId', restaurantId);
  if (branchId) q.set('branchId', branchId);
  return `http://localhost/api/pharmacy/rx-attachments/${id}?${q.toString()}`;
};
const get = (id: string, address: string, who?: Person, headers: Record<string, string> = {}) =>
  GET(new Request(address, { headers: { ...(who ? { 'x-test-user': who.userId } : {}), ...headers } }), { params: Promise.resolve({ id }) });
const reads = () => prisma().auditLog.findMany({ where: { action: 'ph.rx.attachment.read' }, orderBy: { occurredAt: 'asc' } });

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
  restore = withIntakeStorage(storage);
});
afterEach(() => {
  restore();
  vi.setSystemTime(NOW);
});

describe('reading a prescription file', () => {
  it('refuses at the function a person without rx.attachment.view and a support actor, and gives the bytes to a pharmacist', async () => {
    const w = await world();
    const scoped = (who: NonNullable<Awaited<ReturnType<typeof asPh>>>) => scopedClient(prisma(), { restaurantId: w.a.id, branchIds: who.branchIds });
    for (const who of [w.cashier, w.accountant, w.stock, w.support]) {
      const actor = (await asPh(who.userId, w.a.id))!;
      await expect(readAttachment(scoped(actor), actor, storage, w.fileId), who.email).rejects.toMatchObject({ code: 'FORBIDDEN' });
    }
    const pharmacist = (await asPh(w.pharmacist.userId, w.a.id))!;
    const read = await readAttachment(scoped(pharmacist), pharmacist, storage, w.fileId);
    expect(Buffer.from(read.bytes).equals(PNG)).toBe(true);
    expect(read).toMatchObject({ id: w.fileId, prescriptionId: w.rxId, mime: 'image/png', sizeBytes: PNG.length });
  });

  it('refuses at the query a role without the permission and support, and returns the exact uploaded bytes to a pharmacist', async () => {
    const w = await world();
    const input = { restaurantId: w.a.id, branchId: w.b1, id: w.fileId };
    for (const who of [w.cashier, w.accountant, w.stock, w.support]) expect(codeOf(await ask(who, rxQueries.attachmentRead, input)), who.email).toBe('FORBIDDEN');
    expect(await reads()).toEqual([]);
    for (const who of [w.pharmacist, w.owner]) {
      const got = dataOf(await ask(who, rxQueries.attachmentRead, { ...input, branchId: undefined }));
      expect(got).toMatchObject({ id: w.fileId, mime: 'image/png', sizeBytes: PNG.length });
      expect(Buffer.from(got.base64, 'base64').equals(PNG)).toBe(true);
    }
  });

  it('treats another business’s file, a missing file and a file in a branch the person cannot reach alike', async () => {
    const w = await world();
    const [, b2] = w.a.branchIds;
    const other = await person('b2only', { staff: [w.a.id, 'PHARMACIST', [b2!]] });
    const outside = await ask(other, rxQueries.attachmentRead, { restaurantId: w.a.id, id: w.fileId });
    const missing = await ask(other, rxQueries.attachmentRead, { restaurantId: w.a.id, id: 'nope' });
    const foreign = await ask(w.ownerB, rxQueries.attachmentRead, { restaurantId: w.b.id, id: w.fileId });
    expect([codeOf(outside), codeOf(missing), codeOf(foreign)]).toEqual(['NOT_FOUND', 'NOT_FOUND', 'NOT_FOUND']);
    expect(outside).toEqual(missing);
    expect(foreign).toEqual(missing);
    expect(await reads()).toEqual([]);
  });

  it('files an audit row of the file id and its size for each successful read, and nothing the paper says', async () => {
    const w = await world();
    const input = { restaurantId: w.a.id, branchId: w.b1, id: w.fileId };
    dataOf(await ask(w.pharmacist, rxQueries.attachmentRead, input));
    dataOf(await ask(w.owner, rxQueries.attachmentRead, input));
    await ask(w.cashier, rxQueries.attachmentRead, input);
    const rows = await reads();
    expect(rows).toHaveLength(2);
    expect(rows.map((r) => r.actorId).sort()).toEqual([w.pharmacist.userId, w.owner.userId].sort());
    for (const row of rows) {
      expect(row).toMatchObject({ entityType: 'PhRxAttachment', entityId: w.fileId, restaurantId: w.a.id });
      expect(row.changes).toEqual({ fileId: { before: null, after: w.fileId }, bytes: { before: null, after: PNG.length } });
      for (const secret of ['Layla', 'Strange', 'GATE 1']) expect(JSON.stringify(row), secret).not.toContain(secret);
    }
  });
});

describe('the route', () => {
  it('streams the exact bytes with Cache-Control private, no-store to a person who may see them', async () => {
    const w = await world();
    const reply = await get(w.fileId, url(w, w.fileId), w.pharmacist);
    expect(reply.status).toBe(200);
    expect(reply.headers.get('cache-control')).toBe('private, no-store');
    expect(reply.headers.get('content-type')).toBe('image/png');
    expect(reply.headers.get('x-content-type-options')).toBe('nosniff');
    expect(reply.headers.get('content-length')).toBe(String(PNG.length));
    expect(Buffer.from(await reply.arrayBuffer()).equals(PNG)).toBe(true);
    expect(await reads()).toHaveLength(1);
  });

  it('checks the permission on every read: without a session, without the permission, and as support, nothing is sent', async () => {
    const w = await world();
    const cases: Array<[string, Person | undefined, number]> = [
      ['no session', undefined, 401],
      ['cashier', w.cashier, 403],
      ['accountant', w.accountant, 403],
      ['stock', w.stock, 403],
      ['support', w.support, 403],
    ];
    for (const [label, who, status] of cases) {
      const reply = await get(w.fileId, url(w, w.fileId), who);
      expect(reply.status, label).toBe(status);
      expect(reply.headers.get('cache-control'), label).toBe('private, no-store');
      const body = Buffer.from(await reply.arrayBuffer());
      expect(body.includes(Buffer.from('the exact bytes')), label).toBe(false);
    }
    // The permission is read afresh on each request: the same person loses access the moment the role changes.
    expect((await get(w.fileId, url(w, w.fileId), w.pharmacist)).status).toBe(200);
    await prisma().phStaff.updateMany({ where: { userId: w.pharmacist.userId }, data: { role: 'CASHIER' } });
    expect((await get(w.fileId, url(w, w.fileId), w.pharmacist)).status).toBe(403);
    expect(await reads()).toHaveLength(1);
  });

  it('answers not found for another business’s file and for a missing one, with no detail', async () => {
    const w = await world();
    const foreign = await get(w.fileId, url(w, w.fileId, { restaurantId: w.b.id, branchId: null }), w.ownerB);
    const missing = await get('nope', url(w, 'nope', { restaurantId: w.b.id, branchId: null }), w.ownerB);
    expect([foreign.status, missing.status]).toEqual([404, 404]);
    expect(await foreign.json()).toEqual(await missing.json());
    // Asking for business A as business B’s owner is a refusal, not a file.
    expect((await get(w.fileId, url(w, w.fileId), w.ownerB)).status).toBe(403);
    expect((await get(w.fileId, url(w, w.fileId, { restaurantId: null }), w.pharmacist)).status).toBe(400);
  });

  it('refuses a request that comes from another site, whoever signed in', async () => {
    const w = await world();
    for (const headers of [{ 'sec-fetch-site': 'cross-site' }, { 'sec-fetch-site': 'same-site' }, { origin: 'https://evil.example', host: 'localhost' }] as Record<string, string>[]) {
      const reply = await get(w.fileId, url(w, w.fileId), w.pharmacist, headers);
      expect(reply.status, JSON.stringify(headers)).toBe(403);
      expect(Buffer.from(await reply.arrayBuffer()).includes(Buffer.from('the exact bytes'))).toBe(false);
    }
    expect((await get(w.fileId, url(w, w.fileId), w.pharmacist, { 'sec-fetch-site': 'same-origin', origin: 'http://localhost' })).status).toBe(200);
    expect(await reads()).toHaveLength(1);
  });
});

describe('the upload route', () => {
  const form = (w: World, bytes: Uint8Array, over: Record<string, string> = {}) => {
    const body = new FormData();
    body.set('restaurantId', w.a.id);
    body.set('branchId', w.b1);
    body.set('prescriptionId', w.rxId);
    body.set('file', new File([new Uint8Array(bytes)], 'whatever.png', { type: 'image/png' }));
    for (const [k, v] of Object.entries(over)) body.set(k, v);
    return body;
  };
  const post = (who: Person | undefined, body: FormData) =>
    POST(new Request('http://localhost/api/pharmacy/rx-attachments', { method: 'POST', body, headers: { origin: 'http://localhost', ...(who ? { 'x-test-user': who.userId } : {}) } }), { params: Promise.resolve({}) });

  it('takes a multipart upload from a pharmacist and keeps the bytes it was sent', async () => {
    const w = await world();
    const pdf = Buffer.from('%PDF-1.4\nsecond file\n%%EOF');
    const reply = await post(w.pharmacist, form(w, pdf));
    expect(reply.status).toBe(200);
    const { data } = (await reply.json()) as { data: { id: string; mime: string; sizeBytes: number } };
    expect(data).toMatchObject({ mime: 'application/pdf', sizeBytes: pdf.length });
    const row = await prisma().phRxAttachment.findUniqueOrThrow({ where: { id: data.id } });
    expect(Buffer.from(storage.objects.get(row.storageKey)!.bytes).equals(pdf)).toBe(true);
  });

  it('refuses a person who may not upload, an oversized body and a body that is not a form', async () => {
    const w = await world();
    const before = storage.objects.size;
    expect((await post(w.cashier, form(w, PNG))).status).toBe(403);
    expect((await post(undefined, form(w, PNG))).status).toBe(401);
    const big = await post(w.pharmacist, form(w, Buffer.concat([PNG, Buffer.alloc(5 * 1024 * 1024)])));
    expect(big.status).toBe(400);
    const notForm = await POST(
      new Request('http://localhost/api/pharmacy/rx-attachments', { method: 'POST', body: '{}', headers: { origin: 'http://localhost', 'content-type': 'application/json', 'x-test-user': w.pharmacist.userId } }),
      { params: Promise.resolve({}) },
    );
    expect(notForm.status).toBe(400);
    expect(storage.objects.size).toBe(before);
  });
});
