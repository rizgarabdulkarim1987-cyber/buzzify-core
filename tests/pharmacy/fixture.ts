import { vi } from 'vitest';
import type { PhRole } from '@/server/domain/pharmacy/permissions';
import { resolvePhActor } from '@/server/pharmacy/actor';
import { getPrisma } from '@/server/data/prisma';
import { createPasswordUser } from '@/server/studio/auth/users';
import { databaseUrl, TEST_DB } from '../../scripts/db-config';
import { requireTestDb, resetTestData } from '../helpers/db';

export const GOOD = 'correct horse battery staple';
export const prisma = () => getPrisma();

export const DAY = 86_400_000;
/** The clock every pharmacy test uses: nothing reads the real one. */
export const NOW = new Date('2026-10-27T09:00:00.000Z');

export interface Person {
  userId: string;
  email: string;
}

/** The application's client reads DATABASE_URL: point it at the test database. */
export function useTestDatabase(): void {
  requireTestDb();
  vi.stubEnv('DATABASE_URL', databaseUrl(TEST_DB));
  vi.stubEnv('RESEND_API_KEY', '');
}

/** Wipes the data and makes the applications a restaurant can subscribe to. */
export async function resetWorld(): Promise<void> {
  await resetTestData(prisma());
  await prisma().application.createMany({
    data: [
      { id: 'menu', name: { en: 'Menu' } },
      { id: 'cashier', name: { en: 'Cashier' } },
      { id: 'pharmacy', name: { en: 'Pharmacy' } },
      { id: 'retail', name: { en: 'Retail' } },
    ],
  });
}

export interface PharmacyOpts {
  sector?: 'PHARMACY' | 'FOOD';
  /** The `pharmacy` subscription; `none` for no row. The period ends `periodEndsInDays` from NOW. */
  subscription?: 'TRIAL' | 'ACTIVE' | 'GRACE' | 'EXPIRED' | 'CANCELLED' | 'none';
  periodEndsInDays?: number;
  graceDays?: number;
  cancelledAt?: Date | null;
  status?: 'ACTIVE' | 'SUSPENDED';
  branches?: number;
}

/** A business with one branch (or `branches`) and a `pharmacy` subscription, live unless told otherwise. */
export async function pharmacy(
  name: string,
  opts: PharmacyOpts = {},
): Promise<{ id: string; branchId: string; branchIds: string[] }> {
  const row = await prisma().restaurant.create({
    data: { name, sector: opts.sector ?? 'PHARMACY', status: opts.status ?? 'ACTIVE' },
    select: { id: true },
  });
  const branchIds: string[] = [];
  for (let i = 0; i < (opts.branches ?? 1); i += 1) {
    const branch = await prisma().branch.create({
      data: { restaurantId: row.id, name: `${name} branch ${i + 1}`, sortOrder: i },
      select: { id: true },
    });
    branchIds.push(branch.id);
  }
  const state = opts.subscription ?? 'ACTIVE';
  if (state !== 'none') {
    const end = new Date(NOW.getTime() + (opts.periodEndsInDays ?? 25) * DAY);
    await prisma().subscription.create({
      data: {
        restaurantId: row.id,
        applicationId: 'pharmacy',
        planCode: 'standard',
        status: state,
        period: 'MONTHLY',
        currency: 'IQD',
        priceMinor: 0,
        trialEndsAt: state === 'TRIAL' ? end : null,
        currentPeriodStart: new Date(end.getTime() - 30 * DAY),
        currentPeriodEnd: end,
        graceDays: opts.graceDays ?? 7,
        cancelledAt: opts.cancelledAt ?? null,
        version: 1,
      },
    });
  }
  return { id: row.id, branchId: branchIds[0]!, branchIds };
}

export async function person(
  label: string,
  flags: {
    membership?: [string, 'DESIGNER' | 'OWNER'];
    staff?: [string, PhRole, string[]];
    posStaff?: [string, 'OWNER' | 'MANAGER' | 'CASHIER' | 'KITCHEN'];
    superAdmin?: boolean;
    deactivated?: boolean;
  } = {},
): Promise<Person> {
  const email = `${label}@ph-test.example`;
  const { userId } = await createPasswordUser(prisma(), {
    email,
    name: `${label} person`,
    password: GOOD,
    isSuperAdmin: flags.superAdmin,
  });
  if (flags.superAdmin) await prisma().user.update({ where: { id: userId }, data: { twoFactorEnabled: true } });
  if (flags.membership) {
    await prisma().membership.create({ data: { userId, restaurantId: flags.membership[0], role: flags.membership[1] } });
  }
  if (flags.posStaff) await prisma().posStaff.create({ data: { userId, restaurantId: flags.posStaff[0], role: flags.posStaff[1] } });
  if (flags.staff) {
    const [restaurantId, role, branchIds] = flags.staff;
    const staff = await prisma().phStaff.create({ data: { userId, restaurantId, role }, select: { id: true } });
    for (const branchId of branchIds) await prisma().phStaffBranch.create({ data: { restaurantId, staffId: staff.id, branchId } });
  }
  if (flags.deactivated) await prisma().user.update({ where: { id: userId }, data: { deactivatedAt: NOW } });
  return { userId, email };
}

/** A support grant to `who` for a restaurant; by default it started an hour before NOW and ends in a day. */
export async function grant(
  who: Person,
  restaurantId: string,
  over: { scopes?: string[]; startsAt?: Date; expiresAt?: Date; revokedAt?: Date | null } = {},
) {
  return prisma().supportAccessGrant.create({
    data: {
      restaurantId,
      granteeUserId: who.userId,
      scopes: over.scopes ?? ['catalog.read', 'stock.read'],
      reason: 'ticket 1',
      startsAt: over.startsAt ?? new Date(NOW.getTime() - 3_600_000),
      expiresAt: over.expiresAt ?? new Date(NOW.getTime() + DAY),
      revokedAt: over.revokedAt ?? null,
    },
  });
}

export const asPh = (userId: string, restaurantId: string, branchId?: string) =>
  resolvePhActor(prisma(), userId, { restaurantId, branchId, now: NOW });

/** Waits (bounded) until some backend of this database is waiting on a lock: a writer queued behind a row the test holds. Replaces a sleep: the race is then really in progress. */
export async function untilBlockedOnALock(timeoutMs = 5000, atLeast = 1) {
  const until = Date.now() + timeoutMs;
  for (;;) {
    // eslint-disable-next-line no-restricted-properties -- the test inspects the database's own lock waits, no tenant rows
    const rows = await prisma().$queryRaw<{ n: bigint }[]>`SELECT count(*)::bigint AS n FROM pg_stat_activity WHERE datname = current_database() AND wait_event_type = 'Lock'`;
    if ((rows[0]?.n ?? 0n) >= BigInt(atLeast)) return;
    if (Date.now() > until) throw new Error(`fewer than ${atLeast} backends ever waited on a lock`);
    await new Promise((r) => setTimeout(r, 20));
  }
}

/**
 * Holds `FOR UPDATE` on one row (by table and id) until `release()`; resolves once the lock is held. Writers started while
 * it is held queue behind it in the order they asked (wait for each with `untilBlockedOnALock(…, n)`), so a race between two
 * of them has a known winner and no sleeps.
 */
export async function holdRowLock(table: string, id: string): Promise<{ release: () => Promise<void> }> {
  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  let held!: () => void;
  const locked = new Promise<void>((resolve) => {
    held = resolve;
  });
  const done = prisma().$transaction(
    async (tx) => {
      // eslint-disable-next-line no-restricted-properties -- the test holds a row lock by table name; no tenant data is read
      await tx.$queryRawUnsafe(`SELECT "id" FROM "${table}" WHERE "id" = $1 FOR UPDATE`, id);
      held();
      await gate;
    },
    { timeout: 30_000 },
  );
  await Promise.race([locked, done]);
  return { release: async () => { release(); await done; } };
}
