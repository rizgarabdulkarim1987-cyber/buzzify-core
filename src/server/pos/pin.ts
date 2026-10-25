import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { hashPassword, verifyPassword } from 'better-auth/crypto';
import type { PrismaClient } from '@/generated/prisma/client';
import type { AnyDb } from '@/server/data/tenant-db';
import { isPinShape, isWeakPin, PIN_LIMITS } from '@/server/domain/pos/pin';
import type { PosRole } from '@/server/domain/pos/permissions';
import { StudioError } from '@/server/studio/framework/result';
import { clampMeta, type RequestMeta } from '@/server/studio/framework/action';
import { refuse } from './errors';

/**
 * Quick sign-in by PIN on a shared till. A PIN is only ever checked on a device a manager registered, and only for accounts
 * that could do nothing in the Studio anyway (a PIN session is an ordinary Studio session): see `pinEligible`.
 */

export const MAX_DEVICES = 20;

export class PinRefusedError extends Error {}
export class PinLockedError extends Error {
  constructor(readonly until: Date) {
    super('The staff member is locked');
  }
}
export class DeviceLimitError extends Error {}

/** The account facts that decide whether a PIN may open a session for it. */
interface EligibilityFacts {
  deactivatedAt: Date | null;
  isSuperAdmin: boolean;
  twoFactorEnabled: boolean | null;
  _count: { memberships: number };
}

export const ELIGIBILITY_SELECT = { deactivatedAt: true, isSuperAdmin: true, twoFactorEnabled: true, _count: { select: { memberships: true } } } as const;

/** No Studio role anywhere, not a Super Admin, two-factor off, not deactivated: a till-only account. */
export function pinEligible(user: EligibilityFacts): boolean {
  return user.deactivatedAt === null && !user.isSuperAdmin && user.twoFactorEnabled !== true && user._count.memberships === 0;
}

// Setting and clearing ----------------------------------------------------------------------------------------------------

/** The shape and strength of a new PIN, checked before any hashing. Throws the field refusal. */
export function assertAcceptablePin(pin: string): void {
  if (!isPinShape(pin)) throw new StudioError('INVALID', undefined, { pin: 'Use 4 to 8 digits' });
  if (isWeakPin(pin)) throw new StudioError('INVALID', undefined, { pin: 'Choose a PIN that is harder to guess' });
}

/** Whether `password` is the person's own sign-in password. */
export async function passwordMatches(prisma: Pick<PrismaClient, 'account'>, userId: string, password: string): Promise<boolean> {
  const account = await prisma.account.findFirst({ where: { userId, providerId: 'credential' }, select: { password: true } });
  if (!account?.password) return false;
  return verifyPassword({ hash: account.password, password });
}

export const hashPin = (pin: string): Promise<string> => hashPassword(pin);

export function assertPinAllowed(eligible: boolean): void {
  if (!eligible) throw refuse('CONFLICT', 'This account cannot use a quick sign-in PIN');
}

// Shared devices ----------------------------------------------------------------------------------------------------------

const sha256 = (text: string): string => createHash('sha256').update(text).digest('hex');

/** Registers a device and returns its token, which exists nowhere else: only the hash is stored. */
export async function registerDeviceIn(db: AnyDb, restaurantId: string, input: { name: string; userId: string }) {
  const live = await db.posSharedDevice.count({ where: { restaurantId, revokedAt: null } });
  if (live >= MAX_DEVICES) throw refuse('CONFLICT', 'Register at most 20 devices');
  const token = randomBytes(32).toString('base64url');
  const device = await db.posSharedDevice.create({
    data: { restaurantId, name: input.name, tokenHash: sha256(token), createdByUserId: input.userId },
    select: { id: true },
  });
  if ((await db.posSharedDevice.count({ where: { restaurantId, revokedAt: null } })) > MAX_DEVICES) {
    await db.posSharedDevice.updateMany({ where: { id: device.id, restaurantId }, data: { revokedAt: new Date() } });
    throw refuse('CONFLICT', 'Register at most 20 devices');
  }
  return { deviceId: device.id, token };
}

export async function revokeDeviceIn(db: AnyDb, restaurantId: string, deviceId: string): Promise<void> {
  const { count } = await db.posSharedDevice.updateMany({ where: { id: deviceId, restaurantId, revokedAt: null }, data: { revokedAt: new Date() } });
  if (count === 0) throw new StudioError('NOT_FOUND');
}

export async function listDevices(prisma: Pick<PrismaClient, 'posSharedDevice'>, restaurantId: string) {
  return prisma.posSharedDevice.findMany({
    where: { restaurantId, revokedAt: null },
    orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
    select: { id: true, name: true, createdAt: true, lastUsedAt: true },
  });
}

const TOKEN_SHAPE = /^[A-Za-z0-9_-]{43}$/;

/** The live device a cookie token names, or null for a missing, malformed, unknown or revoked token. */
export async function resolveDevice(prisma: Pick<PrismaClient, 'posSharedDevice'>, token: string | undefined) {
  if (!token || !TOKEN_SHAPE.test(token)) return null;
  return prisma.posSharedDevice.findFirst({ where: { tokenHash: sha256(token), revokedAt: null }, select: { id: true, restaurantId: true, name: true } });
}

/** Who can pick themselves on the switch screen: active, eligible staff of the device's restaurant who set a PIN. */
export async function listPinStaff(prisma: PrismaClient, device: { restaurantId: string }) {
  const rows = await prisma.posStaff.findMany({
    where: { restaurantId: device.restaurantId, deactivatedAt: null, pinHash: { not: null } },
    orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
    select: { id: true, role: true, user: { select: { name: true, ...ELIGIBILITY_SELECT } } },
  });
  return rows.filter((row) => pinEligible(row.user)).map((row) => ({ staffId: row.id, name: row.user.name, role: row.role as PosRole }));
}

// Verifying ---------------------------------------------------------------------------------------------------------------

let dummyHash: Promise<string> | undefined;
/** What a missing or ineligible row is checked against, so every refusal costs the same hashing work. */
const dummy = (): Promise<string> => (dummyHash ??= hashPassword(randomUUID()));

export interface VerifyInput {
  device: { id: string; restaurantId: string };
  staffId: string;
  pin: string;
  meta: RequestMeta;
  now?: Date;
}

/**
 * Checks a PIN for a staff member on a device and returns the account to sign in. The order matters: the device limit
 * first (nothing written), then the lock, then one hash check that costs the same whatever the row, then the books.
 * An unknown id, a person without a PIN, another restaurant's staff, a deactivated or ineligible account and a wrong PIN
 * all answer `PinRefusedError`; the PIN is never stored or logged.
 */
export async function verifyPin(prisma: PrismaClient, input: VerifyInput): Promise<{ userId: string; staffId: string }> {
  const now = input.now ?? new Date();
  const { device } = input;
  const restaurantId = device.restaurantId;
  const meta = clampMeta(input.meta);

  // The try is charged BEFORE the (slow) hash check, so a burst of parallel requests cannot all pass the limits: each one
  // first writes its attempt row, then counts, and the staff counter is raised with a conditional update.
  const reserved = await prisma.posPinAttempt.create({ data: { restaurantId, deviceId: device.id, staffId: input.staffId, ok: false, at: now }, select: { id: true } });
  const recentFailures = await prisma.posPinAttempt.count({
    where: { restaurantId, deviceId: device.id, ok: false, at: { gte: new Date(now.getTime() - PIN_LIMITS.deviceWindowMs) } },
  });
  if (recentFailures > PIN_LIMITS.deviceFailures) {
    await prisma.posPinAttempt.deleteMany({ where: { id: reserved.id, restaurantId } });
    throw new DeviceLimitError();
  }

  let staff = await prisma.posStaff.findFirst({
    where: { id: input.staffId, restaurantId, deactivatedAt: null },
    select: { id: true, userId: true, pinHash: true, pinFailedCount: true, pinLockedUntil: true, user: { select: ELIGIBILITY_SELECT } },
  });

  if (staff?.pinLockedUntil && staff.pinLockedUntil <= now) {
    // The lock has run out: the count starts again.
    await prisma.posStaff.updateMany({ where: { id: staff.id, restaurantId, pinLockedUntil: { lte: now } }, data: { pinFailedCount: 0, pinLockedUntil: null } });
    staff = { ...staff, pinFailedCount: 0, pinLockedUntil: null };
  }
  if (staff?.pinLockedUntil) throw new PinLockedError(staff.pinLockedUntil);
  if (staff) {
    const taken = await prisma.posStaff.updateMany({
      where: { id: staff.id, restaurantId, pinLockedUntil: null, pinFailedCount: { lt: PIN_LIMITS.staffFailures } },
      data: { pinFailedCount: { increment: 1 } },
    });
    if (taken.count === 0) {
      // Five tries are already in flight or used: lock now if nobody has, and say until when.
      await prisma.posStaff.updateMany({
        where: { id: staff.id, restaurantId, pinLockedUntil: null, pinFailedCount: { gte: PIN_LIMITS.staffFailures } },
        data: { pinLockedUntil: new Date(now.getTime() + PIN_LIMITS.staffLockMs) },
      });
      const now2 = await prisma.posStaff.findFirst({ where: { id: staff.id, restaurantId }, select: { pinLockedUntil: true } });
      throw new PinLockedError(now2?.pinLockedUntil ?? new Date(now.getTime() + PIN_LIMITS.staffLockMs));
    }
  }

  const fail = async (known: { id: string; userId: string } | null): Promise<never> => {
    await prisma.$transaction(async (tx) => {
      if (known) {
        await tx.posStaff.updateMany({
          where: { id: known.id, restaurantId, pinFailedCount: { gte: PIN_LIMITS.staffFailures }, pinLockedUntil: null },
          data: { pinLockedUntil: new Date(now.getTime() + PIN_LIMITS.staffLockMs) },
        });
      }
      // Whoever typed is unknown: the row names the person tried, not an actor.
      await tx.auditLog.create({
        data: {
          actorId: null,
          restaurantId,
          action: 'pos.pin.fail',
          entityType: 'PosStaff',
          entityId: known?.id ?? 'unknown',
          changes: { deviceId: { before: null, after: device.id } },
          ip: meta.ip,
          userAgent: meta.userAgent,
        },
      });
    });
    throw new PinRefusedError();
  };

  const hash = staff?.pinHash ?? (await dummy());
  const matches = await verifyPassword({ hash, password: input.pin });
  if (!staff || !staff.pinHash || !matches || !pinEligible(staff.user)) return fail(staff ? { id: staff.id, userId: staff.userId } : null);

  const person = staff;
  await prisma.$transaction(async (tx) => {
    await tx.posPinAttempt.updateMany({ where: { id: reserved.id, restaurantId }, data: { ok: true } });
    await tx.posStaff.updateMany({ where: { id: person.id, restaurantId }, data: { pinFailedCount: 0, pinLockedUntil: null } });
    await tx.posSharedDevice.updateMany({ where: { id: device.id, restaurantId }, data: { lastUsedAt: now } });
    await tx.auditLog.create({
      data: {
        actorId: person.userId,
        restaurantId,
        action: 'pos.pin.ok',
        entityType: 'PosStaff',
        entityId: person.id,
        changes: { deviceId: { before: null, after: device.id } },
        ip: meta.ip,
        userAgent: meta.userAgent,
      },
    });
  });
  return { userId: person.userId, staffId: person.id };
}
