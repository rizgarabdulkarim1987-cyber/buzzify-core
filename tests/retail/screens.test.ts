import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { aiUnitsOf, deriveSyncState } from '@/server/retail/sync-state';
import * as retailActions from '@/server/studio/actions/retail';
import { loadActor, type Actor } from '@/server/studio/auth/actor';
import { createPasswordUser } from '@/server/studio/auth/users';
import { runAction, type ActionDef } from '@/server/studio/framework/action';
import { runQuery, type QueryDef } from '@/server/studio/framework/query';
import type { ActionResult } from '@/server/studio/framework/result';
import { retailDetail, retailList } from '@/server/studio/queries/retail';
import { GOOD, pharmacy, prisma, resetWorld, useTestDatabase } from '../pharmacy/fixture';
import { retailShop } from './world';

vi.mock('next/headers', () => ({ headers: vi.fn(), cookies: vi.fn() }));

const globalForPrisma = globalThis as unknown as { __prisma?: unknown };
const META = { ip: '203.0.113.7', userAgent: 'vitest' };
const NOW = new Date('2026-10-30T12:00:00.000Z');
const LATER = new Date('2026-10-30T12:05:00.000Z');

const actorOf = async (who: { userId: string }) => (await loadActor(prisma(), who.userId)) as Actor;
const ask = async <I, O>(who: { userId: string }, def: QueryDef<I, O>, input: unknown = {}): Promise<ActionResult<O>> =>
  runQuery(prisma(), await actorOf(who), def, input);
const act = async <I, O>(actor: Actor, def: ActionDef<I, O>, input: unknown) => runAction(prisma(), actor, def, input, META);
const dataOf = <T>(result: ActionResult<T>): T => {
  if (!result.ok) throw new Error(`expected success, got ${JSON.stringify(result.error)}`);
  return result.data;
};

const link = { retailBusinessId: 'rb-1', stateVersion: 3, acceptedVersion: 3 };
const outbox = (over: Partial<{ attempts: number; nextAttemptAt: Date; waitingFor: string | null; lastError: string | null; failedAt: Date | null }> = {}) => ({
  attempts: 0,
  nextAttemptAt: NOW,
  waitingFor: null,
  lastError: null,
  failedAt: null,
  ...over,
});

describe('deriveSyncState', () => {
  it('is synced at the version Retails accepted when nothing is queued', () => {
    expect(deriveSyncState(link, null)).toEqual({ kind: 'synced', version: 3 });
  });
  it('is waiting for the owner or the subscription while a row waits for either', () => {
    expect(deriveSyncState({ ...link, retailBusinessId: null }, outbox({ waitingFor: 'OWNER' }))).toEqual({ kind: 'waitingOwner' });
    expect(deriveSyncState({ ...link, retailBusinessId: null }, outbox({ waitingFor: 'SUBSCRIPTION' }))).toEqual({ kind: 'waitingSubscription' });
  });
  it('is retrying with the attempts and the next attempt after a failed try', () => {
    expect(deriveSyncState(link, outbox({ attempts: 2, nextAttemptAt: LATER, lastError: 'HTTP_503' }))).toEqual({
      kind: 'retrying',
      attempts: 2,
      nextAttemptAt: LATER,
      code: 'HTTP_503',
    });
  });
  it('is failed with the error code, and says whether only a change or Resync can send it again', () => {
    expect(deriveSyncState(link, outbox({ attempts: 1, failedAt: NOW, lastError: 'INVALID_INPUT' }))).toEqual({
      kind: 'failed',
      code: 'INVALID_INPUT',
      permanent: true,
    });
    expect(deriveSyncState(link, outbox({ attempts: 20, failedAt: NOW, lastError: 'TIMEOUT' }))).toEqual({ kind: 'failed', code: 'TIMEOUT', permanent: false });
  });
  it('is queued when a row is due and no attempt was made', () => {
    expect(deriveSyncState(link, outbox())).toEqual({ kind: 'queued', nextAttemptAt: NOW });
  });
  it('is not yet provisioned when Retails never answered and nothing is queued', () => {
    expect(deriveSyncState({ retailBusinessId: null, stateVersion: 0, acceptedVersion: 0 }, null)).toEqual({ kind: 'notProvisioned' });
  });
  it('is queued when a newer version exists and no row is left', () => {
    expect(deriveSyncState({ ...link, stateVersion: 4 }, null)).toEqual({ kind: 'queued', nextAttemptAt: null });
  });
});

describe('aiUnitsOf', () => {
  it('shows half units as units', () => {
    expect([aiUnitsOf(0), aiUnitsOf(5), aiUnitsOf(6), aiUnitsOf(null)]).toEqual([0, 2.5, 3, null]);
  });
});

beforeAll(() => useTestDatabase());
beforeEach(resetWorld);
afterAll(async () => {
  await resetWorld();
  await prisma().$disconnect();
  delete globalForPrisma.__prisma;
});

async function admin(email: string, platformOwner: boolean): Promise<{ userId: string }> {
  const { userId } = await createPasswordUser(prisma(), { email, name: email.split('@')[0]!, password: GOOD, isSuperAdmin: true, isPlatformOwner: platformOwner });
  await prisma().user.update({ where: { id: userId }, data: { twoFactorEnabled: true } });
  return { userId };
}

describe('the Studio retail list (retail.list)', () => {
  it('returns a sync state for each case, only for RETAIL shops', async () => {
    const synced = await retailShop('A Synced');
    await prisma().retailLink.update({ where: { restaurantId: synced.id }, data: { retailBusinessId: 'rb-a', stateVersion: 4, acceptedVersion: 4 } });
    const waiting = await retailShop('B Waiting');
    await prisma().retailLink.update({ where: { restaurantId: waiting.id }, data: { stateVersion: 1 } });
    await prisma().retailOutbox.create({ data: { restaurantId: waiting.id, dueVersion: 1, waitingFor: 'OWNER' } });
    const retrying = await retailShop('C Retrying');
    await prisma().retailLink.update({ where: { restaurantId: retrying.id }, data: { retailBusinessId: 'rb-c', stateVersion: 2, acceptedVersion: 1 } });
    await prisma().retailOutbox.create({ data: { restaurantId: retrying.id, dueVersion: 2, attempts: 3, nextAttemptAt: LATER, lastError: 'HTTP_503' } });
    const failed = await retailShop('D Failed');
    await prisma().retailLink.update({ where: { restaurantId: failed.id }, data: { stateVersion: 1 } });
    await prisma().retailOutbox.create({ data: { restaurantId: failed.id, dueVersion: 1, attempts: 1, failedAt: NOW, lastError: 'PLAN_LIMIT' } });
    await retailShop('E Fresh', { subscription: 'none' });
    await pharmacy('F Pharmacy', { subscription: 'none' });
    const boss = await admin('list-admin@rt-test.example', false);

    const { rows } = dataOf(await ask(boss, retailList, {}));

    expect(rows.map((row) => row.name)).toEqual(['A Synced', 'B Waiting', 'C Retrying', 'D Failed', 'E Fresh']);
    expect(rows.map((row) => row.sync.kind)).toEqual(['synced', 'waitingOwner', 'retrying', 'failed', 'notProvisioned']);
    expect(rows[3]!.sync).toMatchObject({ code: 'PLAN_LIMIT' });
    expect(rows[0]).toMatchObject({ branches: 2, status: 'ACTIVE', subscription: { status: 'ACTIVE' } });
    expect(rows[4]!.subscription).toBeNull();
  });

  it('keeps only failed shops with failedOnly', async () => {
    await retailShop('Fine');
    const bad = await retailShop('Broken');
    await prisma().retailLink.update({ where: { restaurantId: bad.id }, data: { stateVersion: 1 } });
    await prisma().retailOutbox.create({ data: { restaurantId: bad.id, dueVersion: 1, attempts: 1, failedAt: NOW, lastError: 'INVALID_INPUT' } });
    const boss = await admin('list-admin2@rt-test.example', false);

    const { rows } = dataOf(await ask(boss, retailList, { failedOnly: true }));

    expect(rows.map((row) => row.name)).toEqual(['Broken']);
  });

  it('is refused to an owner', async () => {
    const shop = await retailShop('Mine');
    expect((await ask(shop.owner!, retailList, {})).ok).toBe(false);
  });
});

describe('the retail tab (retail.detail)', () => {
  it('shows versions, the last reconcile, the last error and the AI usage in units', async () => {
    const shop = await retailShop('Tabbed', { aiIntake: true });
    await prisma().retailLink.update({
      where: { restaurantId: shop.id },
      data: { retailBusinessId: 'rb-t', stateVersion: 5, acceptedVersion: 4, remoteVersion: 4, remoteStatus: 'ACTIVE', aiUsageMonth: '2026-10', aiUsageHalfUnits: 7, reconciledAt: NOW },
    });
    await prisma().retailOutbox.create({ data: { restaurantId: shop.id, dueVersion: 5, attempts: 2, nextAttemptAt: LATER, lastError: 'TIMEOUT' } });
    const owner = await admin('detail-owner@rt-test.example', true);
    const other = await admin('detail-other@rt-test.example', false);

    const detail = dataOf(await ask(owner, retailDetail, { restaurantId: shop.id }));
    expect(detail).toMatchObject({
      name: 'Tabbed',
      stateVersion: 5,
      acceptedVersion: 4,
      remoteVersion: 4,
      remoteStatus: 'ACTIVE',
      aiIntake: true,
      aiUsage: { month: '2026-10', units: 3.5 },
      attempts: 2,
      lastError: 'TIMEOUT',
      sync: { kind: 'retrying' },
      can: { aiIntake: true },
      isOwner: false,
    });
    expect(JSON.stringify(detail)).not.toContain('rb-t');
    expect(dataOf(await ask(other, retailDetail, { restaurantId: shop.id })).can.aiIntake).toBe(false);
  });

  it('says isOwner for a Super Admin who also owns the shop', async () => {
    const shop = await retailShop('Both', { owner: false });
    const both = await admin('both@rt-test.example', true);
    await prisma().membership.create({ data: { userId: both.userId, restaurantId: shop.id, role: 'OWNER' } });
    expect(dataOf(await ask(both, retailDetail, { restaurantId: shop.id })).isOwner).toBe(true);
  });

  it('refuses an owner of another business, and an owner of this one', async () => {
    const mine = await retailShop('Mine');
    const theirs = await retailShop('Theirs');
    expect((await ask(mine.owner!, retailDetail, { restaurantId: theirs.id })).ok).toBe(false);
    expect((await ask(mine.owner!, retailDetail, { restaurantId: mine.id })).ok).toBe(false);
  });

  it('is not found for a business that is no retail shop', async () => {
    const food = await pharmacy('Bistro', { sector: 'FOOD', subscription: 'none' });
    const boss = await admin('detail-nf@rt-test.example', true);
    const result = await ask(boss, retailDetail, { restaurantId: food.id });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe('NOT_FOUND');
  });
});

describe('the AI switch', () => {
  it('needs a reason', async () => {
    const shop = await retailShop('Switch');
    const boss = await actorOf(await admin('switch-owner@rt-test.example', true));
    expect((await act(boss, retailActions.setAiIntake, { restaurantId: shop.id, enabled: true, reason: '  ' })).ok).toBe(false);
    expect((await act(boss, retailActions.setAiIntake, { restaurantId: shop.id, enabled: true, reason: 'Pilot customer' })).ok).toBe(true);
  });
  it('is not allowed to a Super Admin who is not the platform owner', async () => {
    const shop = await retailShop('Switch2');
    const other = await actorOf(await admin('switch-other@rt-test.example', false));
    expect((await act(other, retailActions.setAiIntake, { restaurantId: shop.id, enabled: true, reason: 'Pilot customer' })).ok).toBe(false);
  });
});
