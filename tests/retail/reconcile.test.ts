import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { bumpRetailState } from '@/server/retail/outbox';
import { reconcileOne, runReconcile } from '@/server/retail/reconcile';
import { claimDue, deliverOne, MAX_ATTEMPTS } from '@/server/retail/sender';
import { prisma, resetWorld, useTestDatabase } from '../pharmacy/fixture';
import { coreProvisionInput, coreStateSchema } from './contract-oracle';
import { fakeClient, type FakeClient } from './fake-client';
import { linkOf, outboxOf, retailPlan, retailShop } from './world';

vi.mock('next/headers', () => ({ headers: vi.fn(), cookies: vi.fn() }));

const globalForPrisma = globalThis as unknown as { __prisma?: unknown };
const HOUR = 3_600_000;

const soon = () => new Date(Date.now() + 1000);
const bump = (restaurantId: string) => prisma().$transaction((tx) => bumpRetailState(tx, restaurantId));
const report = (version: number, over: Record<string, unknown> = {}) => ({
  kind: 'ok' as const,
  body: { version, status: 'ACTIVE', aiUsageMonth: { month: '2026-11', units: 7 }, ...over },
});

/** A shop provisioned and in step: version 1 accepted, the outbox empty. */
async function syncedShop(name: string, client: FakeClient) {
  const shop = await retailShop(name);
  await bump(shop.id);
  const now = soon();
  expect(await claimDue(prisma(), now, 10)).toEqual([shop.id]);
  expect(await deliverOne(prisma(), client, shop.id, now)).toBe('sent');
  expect(await outboxOf(shop.id)).toBeNull();
  client.calls.length = 0;
  return shop;
}

beforeAll(() => useTestDatabase());
afterAll(async () => {
  await resetWorld();
  await prisma().$disconnect();
  delete globalForPrisma.__prisma;
});
beforeEach(async () => {
  await resetWorld();
  await retailPlan();
});
afterEach(() => {
  vi.restoreAllMocks();
});

describe('the reconcile', () => {
  it('same version and hash does nothing', async () => {
    const client = fakeClient({ readState: () => report(1) });
    const shop = await syncedShop('Same', client);
    const now = soon();
    expect(await reconcileOne(prisma(), client, shop.id, now)).toBe('same');
    expect(client.calls).toEqual([{ op: 'readState', body: shop.id }]);
    expect(await linkOf(shop.id)).toMatchObject({ stateVersion: 1, acceptedVersion: 1, retailBusinessId: `rt-${shop.id}` });
    expect((await linkOf(shop.id)).reconciledAt?.getTime()).toBe(now.getTime());
    expect(await outboxOf(shop.id)).toBeNull();
  });

  it('hash drift bumps', async () => {
    const client = fakeClient({ readState: () => report(1) });
    const shop = await syncedShop('Drift', client);
    // A change with no hook: the owner renamed themselves through the sign-in pages.
    await prisma().user.update({ where: { id: shop.owner!.userId }, data: { name: 'A new name' } });
    expect(await reconcileOne(prisma(), client, shop.id, soon())).toBe('drift');
    expect((await linkOf(shop.id)).stateVersion).toBe(2);
    expect(await outboxOf(shop.id)).toMatchObject({ dueVersion: 2, attempts: 0 });

    // The queued delivery carries the change; afterwards the hashes agree again.
    const now = soon();
    expect(await claimDue(prisma(), now, 10)).toEqual([shop.id]);
    expect(await deliverOne(prisma(), client, shop.id, now)).toBe('sent');
    expect(coreStateSchema.parse(client.of('pushState')[0]).owner.name).toBe('A new name');
    client.answer('readState', () => report(2));
    expect(await reconcileOne(prisma(), client, shop.id, soon())).toBe('same');
  });

  it('remote behind bumps', async () => {
    const client = fakeClient({ readState: () => report(0) });
    const shop = await syncedShop('Behind', client);
    // Retails was restored from a backup older than the version it accepted.
    expect(await reconcileOne(prisma(), client, shop.id, soon())).toBe('drift');
    expect(await linkOf(shop.id)).toMatchObject({ stateVersion: 2, remoteVersion: 0, retailBusinessId: `rt-${shop.id}` });
    expect(await outboxOf(shop.id)).toMatchObject({ dueVersion: 2 });
  });

  it('404 re-provisions', async () => {
    const client = fakeClient({ readState: () => ({ kind: 'notFound' }) });
    const shop = await syncedShop('Lost', client);
    expect(await reconcileOne(prisma(), client, shop.id, soon())).toBe('reprovision');
    expect(await linkOf(shop.id)).toMatchObject({ retailBusinessId: null, stateVersion: 2 });
    expect(await outboxOf(shop.id)).toMatchObject({ dueVersion: 2 });

    const now = soon();
    expect(await claimDue(prisma(), now, 10)).toEqual([shop.id]);
    expect(await deliverOne(prisma(), client, shop.id, now)).toBe('sent');
    expect(client.calls.map((call) => call.op)).toEqual(['readState', 'provision']);
    expect(coreProvisionInput.safeParse(client.of('provision')[0]).success).toBe(true);
  });

  it('stores usage for display', async () => {
    const client = fakeClient({ readState: () => report(1, { status: 'SETUP', aiUsageMonth: { month: '2026-10', units: 13 } }) });
    const shop = await syncedShop('Usage', client);
    const now = soon();
    await reconcileOne(prisma(), client, shop.id, now);
    const link = await linkOf(shop.id);
    expect(link).toMatchObject({ remoteVersion: 1, remoteStatus: 'SETUP', aiUsageMonth: '2026-10', aiUsageHalfUnits: 13 });
    expect(link.reconciledAt?.getTime()).toBe(now.getTime());
  });

  it('a failed or malformed read is an error, keeps the stored reading and moves the shop to the back of the queue', async () => {
    const client = fakeClient({ readState: () => report(1) });
    const shop = await syncedShop('Flaky', client);
    const first = soon();
    await reconcileOne(prisma(), client, shop.id, first);
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    for (const answer of [
      { kind: 'retry', code: 'HTTP_503' },
      { kind: 'permanent', code: 'HTTP_400' },
      { kind: 'ok', body: { version: 'one' } },
      { kind: 'ok', body: null },
    ] as const) {
      client.answer('readState', () => answer);
      const later = new Date(first.getTime() + 25 * HOUR);
      expect(await reconcileOne(prisma(), client, shop.id, later)).toBe('error');
      const link = await linkOf(shop.id);
      expect(link).toMatchObject({ remoteVersion: 1, aiUsageHalfUnits: 7, stateVersion: 1 });
      expect(link.reconciledAt?.getTime()).toBe(later.getTime());
    }
  });

  it('shops that keep failing do not keep a healthy one waiting', async () => {
    const now = soon();
    for (let i = 0; i < 50; i += 1) {
      const shop = await prisma().restaurant.create({ data: { name: `Failing ${i}`, sector: 'RETAIL' }, select: { id: true } });
      await prisma().retailLink.create({ data: { restaurantId: shop.id, retailBusinessId: `rt-${i}`, provisionedAt: new Date(now.getTime() - 48 * HOUR) } });
    }
    const healthy = await prisma().restaurant.create({ data: { name: 'Healthy', sector: 'RETAIL' }, select: { id: true } });
    await prisma().retailLink.create({
      data: { restaurantId: healthy.id, retailBusinessId: 'rt-healthy', provisionedAt: new Date(now.getTime() - 48 * HOUR), reconciledAt: new Date(now.getTime() - 25 * HOUR) },
    });
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const client = fakeClient({ readState: (id) => (id === healthy.id ? report(0) : { kind: 'retry', code: 'HTTP_503' }) });
    expect(await runReconcile(prisma(), client, now)).toEqual({ checked: 50, drifted: 0, errors: 50 });
    expect(client.of('readState')).not.toContain(healthy.id);
    const next = new Date(now.getTime() + HOUR);
    expect(await runReconcile(prisma(), client, next)).toEqual({ checked: 1, drifted: 0, errors: 0 });
    expect((await linkOf(healthy.id)).reconciledAt?.getTime()).toBe(next.getTime());
  });

  it('a link on a business that is no longer retail is gone: skipped, its queue cleared', async () => {
    const client = fakeClient({ readState: () => report(1) });
    const shop = await syncedShop('Moved', client);
    await bump(shop.id);
    await prisma().restaurant.update({ where: { id: shop.id }, data: { sector: 'PHARMACY' } });
    const now = soon();
    expect(await reconcileOne(prisma(), client, shop.id, now)).toBe('gone');
    expect(client.calls).toEqual([]);
    expect(await outboxOf(shop.id)).toBeNull();
    expect((await linkOf(shop.id)).reconciledAt?.getTime()).toBe(now.getTime());
  });

  it('a permanent refusal is not re-sent daily; exhausted retries are', async () => {
    const client = fakeClient({ readState: () => report(1) });
    const shop = await syncedShop('Refused', client);
    await prisma().user.update({ where: { id: shop.owner!.userId }, data: { name: 'Renamed' } });
    await bump(shop.id);
    await prisma().retailOutbox.update({ where: { restaurantId: shop.id }, data: { failedAt: new Date(), lastError: 'PLAN_LIMIT', attempts: 0 } });
    expect(await reconcileOne(prisma(), client, shop.id, soon())).toBe('drift');
    // Still failed, at the same version: only the admin's Resync tries it again.
    expect(await outboxOf(shop.id)).toMatchObject({ dueVersion: 2, lastError: 'PLAN_LIMIT', attempts: 0 });
    expect((await outboxOf(shop.id))!.failedAt).not.toBeNull();
    expect((await linkOf(shop.id)).stateVersion).toBe(2);

    // Twenty failed attempts (Retails was down) are tried again by the reconcile.
    await prisma().retailOutbox.update({ where: { restaurantId: shop.id }, data: { lastError: 'HTTP_503', attempts: MAX_ATTEMPTS } });
    expect(await reconcileOne(prisma(), client, shop.id, soon())).toBe('drift');
    expect(await outboxOf(shop.id)).toMatchObject({ dueVersion: 3, attempts: 0, failedAt: null });
  });

  it('a ready shop still at version 0 is queued at version 1', async () => {
    const client = fakeClient();
    const shop = await retailShop('Zero');
    expect(await reconcileOne(prisma(), client, shop.id, soon())).toBe('drift');
    expect(client.calls).toEqual([]);
    expect((await linkOf(shop.id)).stateVersion).toBe(1);
    expect(await outboxOf(shop.id)).toMatchObject({ dueVersion: 1 });
  });

  it('processes at most 50 and the oldest first', async () => {
    const now = soon();
    const ids: string[] = [];
    // Two never reconciled, then fifty more reconciled a day and more ago (oldest last), then one reconciled an hour ago.
    for (let i = 0; i < 53; i += 1) {
      const shop = await prisma().restaurant.create({ data: { name: `Shop ${i}`, sector: 'RETAIL' }, select: { id: true } });
      const reconciledAt = i < 2 ? null : i < 52 ? new Date(now.getTime() - 25 * HOUR - i * 60_000) : new Date(now.getTime() - HOUR);
      await prisma().retailLink.create({ data: { restaurantId: shop.id, reconciledAt } });
      ids.push(shop.id);
    }
    const client = fakeClient();
    expect(await runReconcile(prisma(), client, now)).toEqual({ checked: 50, drifted: 0, errors: 0 });
    const links = await prisma().retailLink.findMany({ select: { restaurantId: true, reconciledAt: true } });
    const touched = new Set(links.filter((l) => l.reconciledAt?.getTime() === now.getTime()).map((l) => l.restaurantId));
    expect(touched.size).toBe(50);
    // Left for the next run: the two least overdue (reconciled 25 h 2 min and 25 h 3 min ago), and the one done an hour ago.
    expect(ids.filter((id) => !touched.has(id))).toEqual([ids[2], ids[3], ids[52]]);
    // Never provisioned and not ready: nothing to ask Retails.
    expect(client.calls).toEqual([]);
  });
});
