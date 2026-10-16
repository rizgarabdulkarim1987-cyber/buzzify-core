import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import * as OTPAuth from 'otpauth';
import type { Locale } from '@/lib/locale';
import { createPrisma } from '@/server/data/prisma';
import { readDevMail } from '@/server/email/send';
import { DEV_DB, databaseUrl } from '../../../scripts/db-config';

/**
 * Studio people for the end-to-end tests, written straight to the development database the app under test reads.
 * Addresses are unique per run (`…@e2e.buzzify.test`), so runs never share an account, and `removeStudioUsers` deletes
 * them with their sessions, memberships, invitations and audit rows afterwards.
 */

const prisma = () => createPrisma(databaseUrl(DEV_DB));

/** Runs a command of studio-cli.ts with tsx, for the work that needs the Studio's sign-in code (see that file). */
function studioCli<T>(command: string, input: Record<string, unknown>): T {
  const root = process.cwd();
  const output = execFileSync(
    process.execPath,
    [path.join(root, 'node_modules', 'tsx', 'dist', 'cli.mjs'), path.join(root, 'tests', 'e2e', 'helpers', 'studio-cli.ts'), command, JSON.stringify(input)],
    { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'inherit'] },
  );
  const answer = output.split(/\r?\n/).find((line) => line.startsWith('STUDIO_CLI '));
  if (!answer) throw new Error(`studio-cli ${command} gave no answer:\n${output}`);
  return JSON.parse(answer.slice('STUDIO_CLI '.length)) as T;
}

/**
 * Where the setup project leaves the signed-in Super Admin: a Playwright storage state (`storageState` in a test's
 * `use`), with the account's address, password and two-factor key beside it under `superAdmin`.
 */
export const SUPER_ADMIN_FILE = 'test-results/.auth/super-admin.json';

/** The Super Admin the setup project made, and the key of their authenticator. */
export function superAdmin(): StudioUser & { secret: string } {
  return (JSON.parse(readFileSync(SUPER_ADMIN_FILE, 'utf8')) as { superAdmin: StudioUser & { secret: string } }).superAdmin;
}

/** The code an authenticator app shows for `secret` (base32, 6 digits, 30 seconds). */
export function totp(secret: string, timestamp = Date.now()): string {
  return new OTPAuth.TOTP({ secret: OTPAuth.Secret.fromBase32(secret), digits: 6, period: 30, algorithm: 'SHA1' }).generate({ timestamp });
}

/** An address no other run uses. */
export const uniqueEmail = (label: string) => `${label}-${randomUUID().slice(0, 8)}@e2e.buzzify.test`;

/** A password that meets the policy and is new for every call. */
export const uniquePassword = () => `e2e ${randomUUID()}`;

/**
 * An address in a private range, unique per call, for a test's `x-forwarded-for` header: the Studio counts sign-in and
 * reset attempts per address, and a run should not use up the next run's allowance (or share it with a person).
 */
export const uniqueClientAddress = () => {
  const bytes = randomUUID().replace(/-/g, '').slice(0, 6);
  return `10.${parseInt(bytes.slice(0, 2), 16)}.${parseInt(bytes.slice(2, 4), 16)}.${parseInt(bytes.slice(4, 6), 16) || 1}`;
};

export interface StudioUser {
  userId: string;
  email: string;
  password: string;
  name: string;
}

export async function createStudioUser(
  options: { label?: string; name?: string; superAdmin?: boolean; locale?: Locale } = {},
): Promise<StudioUser> {
  const email = uniqueEmail(options.label ?? 'person');
  const password = uniquePassword();
  const name = options.name ?? 'E2E Person';
  const { userId } = studioCli<{ userId: string }>('create-user', {
    email,
    name,
    password,
    superAdmin: options.superAdmin ?? false,
    locale: options.locale ?? 'en',
  });
  return { userId, email, password, name };
}

/** Deletes these people (by address) and everything that hangs off them, including what they did in the audit log. */
export async function removeStudioUsers(emails: readonly string[]): Promise<void> {
  const db = prisma();
  try {
    const users = await db.user.findMany({ where: { email: { in: [...emails] } }, select: { id: true } });
    const ids = users.map((user) => user.id);
    await db.invitation.deleteMany({ where: { OR: [{ email: { in: [...emails] } }, { invitedById: { in: ids } }] } });
    await db.auditLog.deleteMany({ where: { OR: [{ actorId: { in: ids } }, { entityId: { in: ids } }] } });
    // Sessions, credentials, two-factor rows and memberships go with the user.
    await db.user.deleteMany({ where: { id: { in: ids } } });
  } finally {
    await db.$disconnect();
  }
}

/** The seeded ATELIER restaurant: its id and name. */
export async function atelierRestaurant(): Promise<{ id: string; name: string }> {
  const db = prisma();
  try {
    const menu = await db.menu.findUniqueOrThrow({
      where: { slug: 'atelier' },
      select: { restaurant: { select: { id: true, name: true } } },
    });
    return menu.restaurant;
  } finally {
    await db.$disconnect();
  }
}

/** The menu a slug names now (its id and name), as the Studio lists it. */
export async function menuBySlug(slug: string): Promise<{ id: string; name: string }> {
  const db = prisma();
  try {
    return await db.menu.findUniqueOrThrow({ where: { slug }, select: { id: true, name: true } });
  } finally {
    await db.$disconnect();
  }
}

/**
 * Deletes what a menu test made, and nothing else: the menus that have or had one of these addresses, every `MenuSlug`
 * row of those addresses and menus (tombstones included, which nothing else ever removes), and the audit rows about
 * them. A menu the test deleted through the Studio is known only by the id the test saw, so it passes those too; an id
 * of a menu that still exists under another address (one the test only looked at) is left alone.
 */
export async function removeMenus({ slugs, menuIds }: { slugs: readonly string[]; menuIds: readonly string[] }): Promise<void> {
  const db = prisma();
  try {
    const named = await db.menuSlug.findMany({ where: { slug: { in: [...slugs] } }, select: { menuId: true } });
    const current = await db.menu.findMany({ where: { slug: { in: [...slugs] } }, select: { id: true } });
    const ours = [...new Set([...named.map((row) => row.menuId), ...current.map((menu) => menu.id)].filter((id): id is string => id !== null))];
    // A menu that no longer exists can only be one the test deleted; one that exists belongs to the test only if found above.
    const existing = new Set((await db.menu.findMany({ where: { id: { in: [...menuIds] } }, select: { id: true } })).map((menu) => menu.id));
    const deleted = menuIds.filter((id) => !existing.has(id));
    await db.menuSlug.deleteMany({ where: { OR: [{ slug: { in: [...slugs] } }, { menuId: { in: ours } }] } });
    await db.menu.deleteMany({ where: { id: { in: ours } } });
    const ids = [...ours, ...deleted];
    await db.auditLog.deleteMany({ where: { OR: [{ menuId: { in: ids } }, { entityId: { in: ids } }] } });
  } finally {
    await db.$disconnect();
  }
}

/** An owner invitation to `restaurantId` from `inviterId`, for a new address. Returns the address and the link. */
export async function inviteOwner(inviterId: string, restaurantId: string): Promise<{ email: string; url: string }> {
  const email = uniqueEmail('owner');
  const { url } = studioCli<{ url: string }>('invite-owner', { email, restaurantId, inviterId });
  return { email, url };
}

/** The first link in the newest message to `to`, waiting up to `timeoutMs` for it to arrive in `.data/mail`. */
export async function linkInMail(to: string, timeoutMs = 10_000): Promise<string> {
  const until = Date.now() + timeoutMs;
  for (;;) {
    const [newest] = await readDevMail(to);
    const link = newest && /https?:\/\/\S+/.exec(newest.text)?.[0];
    if (link) return link;
    if (Date.now() > until) throw new Error(`No mail with a link reached ${to}`);
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
}

/** A restaurant in the development database, made without going through the Studio, and what is needed to find it again. */
export interface TestRestaurant {
  id: string;
  name: string;
  clientNumber: number;
}

/** A restaurant with a name no other run uses and no menus. Remove it with `removeRestaurants`. */
export async function createTestRestaurant(label = 'Place', extra: { city?: string } = {}): Promise<TestRestaurant> {
  const db = prisma();
  try {
    const name = `E2E ${label} ${randomUUID().slice(0, 6)}`;
    const row = await db.restaurant.create({ data: { name, city: extra.city ?? '' }, select: { id: true, name: true, clientNumber: true } });
    return { id: row.id, name: row.name, clientNumber: row.clientNumber };
  } finally {
    await db.$disconnect();
  }
}

/** Gives a person a role at a restaurant. */
export async function assignMember(userId: string, restaurantId: string, role: 'DESIGNER' | 'OWNER'): Promise<void> {
  const db = prisma();
  try {
    await db.membership.create({ data: { userId, restaurantId, role } });
  } finally {
    await db.$disconnect();
  }
}

/**
 * Deletes restaurants a test made, with their branches, members, invitations and what the audit log says about them. They
 * must have no menus (`createTemporaryMenu().remove()` deletes its own restaurant).
 */
export async function removeRestaurants(ids: readonly string[]): Promise<void> {
  const db = prisma();
  try {
    await db.auditLog.deleteMany({ where: { OR: [{ restaurantId: { in: [...ids] } }, { entityId: { in: [...ids] } }] } });
    await db.restaurant.deleteMany({ where: { id: { in: [...ids] } } });
  } finally {
    await db.$disconnect();
  }
}

/** `removeRestaurants` for restaurants a test made through the Studio and knows only by name. */
export async function removeRestaurantsNamed(names: readonly string[]): Promise<void> {
  const db = prisma();
  try {
    const found = await db.restaurant.findMany({ where: { name: { in: [...names] } }, select: { id: true } });
    await removeRestaurants(found.map((restaurant) => restaurant.id));
  } finally {
    await db.$disconnect();
  }
}

/** One row of the platform settings, as stored. */
export interface SettingRow {
  key: string;
  value: unknown;
  updatedById: string | null;
}

/** The platform settings as they are now, so a test that changes them can put them back (`restorePlatformSettings`). */
export async function platformSettingRows(): Promise<SettingRow[]> {
  const db = prisma();
  try {
    return (await db.platformSetting.findMany({ select: { key: true, value: true, updatedById: true } })) as SettingRow[];
  } finally {
    await db.$disconnect();
  }
}

/** Puts the platform settings back as `rows` had them (none: the built-in defaults). */
export async function restorePlatformSettings(rows: readonly SettingRow[]): Promise<void> {
  const db = prisma();
  try {
    await db.platformSetting.deleteMany();
    if (rows.length > 0) await db.platformSetting.createMany({ data: rows.map((row) => ({ ...row, value: row.value as never })) });
  } finally {
    await db.$disconnect();
  }
}

/** Moves a restaurant's version on, as another person's save would, so the next save from an open page is stale. */
export async function bumpRestaurantVersion(id: string): Promise<void> {
  const db = prisma();
  try {
    await db.restaurant.update({ where: { id }, data: { version: { increment: 1 } } });
  } finally {
    await db.$disconnect();
  }
}
