import { z } from 'zod';
import { Prisma } from '@/generated/prisma/client';
import { DEFAULT_PALETTES } from '@/lib/brand';
import { LOCALES } from '@/lib/locale';
import { delegates, type AnyDb, type ScopedDb } from '@/server/data/tenant-db';
import { MENU_STATUSES, STATUS_ACTIONS } from '@/server/domain/menu-status';
import { effectivePermissions, parsePolicy, type Permission } from '@/server/domain/permissions';
import type { PublishIssue } from '@/server/domain/publish-rules';
import { SLUG_MAX, SLUG_MIN, validateSlug, type SlugProblem } from '@/server/domain/slug';
import type { Actor } from '@/server/studio/auth/actor';
import { StudioError, type ErrorCode } from '@/server/studio/framework/result';

/**
 * Menus as the Studio makes and changes them: what it accepts for a new menu, how a slug is checked and claimed, and
 * what a new menu starts with. The actions run these on the transaction of a menu or restaurant target (or the scope of
 * `transactionIn`) and write the audit rows from what they return.
 */

// What the Studio accepts ---------------------------------------------------------------------------------------------

/** The currencies and time zones the New menu form offers first. Any ISO 4217 code and IANA zone is accepted. */
export const OFFERED_CURRENCIES = ['IQD', 'USD', 'EUR', 'GBP', 'TRY', 'AED', 'SAR', 'KWD', 'JOD', 'QAR'] as const;
export const OFFERED_TIME_ZONES = [
  'Asia/Baghdad',
  'Asia/Dubai',
  'Asia/Riyadh',
  'Asia/Kuwait',
  'Asia/Qatar',
  'Asia/Amman',
  'Asia/Beirut',
  'Asia/Tehran',
  'Europe/Istanbul',
  'Europe/London',
  'Europe/Berlin',
  'America/New_York',
  'UTC',
] as const;

/** What a new menu starts with when the person changes nothing (the platform's defaults until Settings has them). */
export const NEW_MENU_DEFAULTS = {
  locales: [...LOCALES],
  defaultLocale: 'en',
  currency: 'IQD',
  timezone: 'Asia/Baghdad',
  numeralSystem: 'LATN',
} as const;

const CURRENCIES = new Set(Intl.supportedValuesOf('currency'));

function isTimeZone(value: string): boolean {
  try {
    new Intl.DateTimeFormat('en', { timeZone: value });
    return true;
  } catch {
    return false;
  }
}

/** A menu's name: what the Studio lists it by. Guests see the restaurant's name. */
export const menuName = z.string().trim().min(1, 'Enter the menu name').max(120, 'Use at most 120 characters');

/** A slug as typed: its rules (`validateSlug`) are checked with its availability, so both say which is wrong. */
export const slugField = z.string().trim().max(200, 'This is too long');

const idField = z.string().min(1).max(100);

/** A new menu: its restaurant, its name and address, and the settings guests see it in. */
export const newMenuInput = z
  .object({
    restaurantId: idField,
    name: menuName,
    slug: slugField,
    locales: z
      .array(z.enum(LOCALES, 'Choose one of the languages offered'))
      .min(1, 'Choose at least one language')
      .refine((list) => new Set(list).size === list.length, 'Choose each language once'),
    defaultLocale: z.enum(LOCALES, 'Choose one of the languages offered'),
    currency: z
      .string()
      .regex(/^[A-Z]{3}$/, 'Choose one of the currencies offered')
      .refine((code) => CURRENCIES.has(code), 'Choose one of the currencies offered'),
    timezone: z.string().min(1).max(64).refine(isTimeZone, 'Choose one of the time zones offered'),
    numeralSystem: z.enum(['LATN', 'ARAB'], 'Choose one of the numeral systems offered'),
  })
  // With no language chosen, that is the one problem to fix; the default is checked against a list there is.
  .refine((menu) => menu.locales.length === 0 || menu.locales.includes(menu.defaultLocale), {
    path: ['defaultLocale'],
    message: 'Choose the default language among the menu languages',
  });

export type NewMenuInput = z.infer<typeof newMenuInput>;

export const statusAction = z.enum(STATUS_ACTIONS, 'Choose one of the changes offered');

export const menuStatus = z.enum(MENU_STATUSES, 'Choose one of the statuses offered');

/** What All Menus sorts by. */
export const MENU_SORTS = ['name', 'restaurant', 'status', 'createdAt', 'updatedAt'] as const;

export type MenuSort = (typeof MENU_SORTS)[number];

/** What the All Menus list does to the menus selected in it. */
export const BULK_ACTIONS = ['publish', ...STATUS_ACTIONS] as const;

export type BulkAction = (typeof BULK_ACTIONS)[number];

/** How one menu of a bulk action went: done, or refused with the code (and a blocked publish's issues). */
export interface BulkResult {
  menuId: string;
  ok: boolean;
  code?: ErrorCode;
  issues?: PublishIssue[];
}

/** What the person may do in a restaurant: their role's defaults there, then the client's policy. */
export function permissionsIn(actor: Actor, restaurant: { id: string; permissionPolicy: unknown }): ReadonlySet<Permission> {
  const membership = actor.memberships.find((m) => m.restaurantId === restaurant.id);
  return effectivePermissions({
    isSuperAdmin: actor.isSuperAdmin,
    role: membership?.role ?? null,
    policy: parsePolicy(restaurant.permissionPolicy),
  });
}

// Slugs ---------------------------------------------------------------------------------------------------------------

export type SlugAvailability = 'ok' | 'taken' | SlugProblem;

/**
 * Whether `slug` can be the address of the menu `forMenuId` (null for a menu not made yet). It must follow the slug
 * rules and have no `MenuSlug` row, or have one that is that menu's own (an address it had before, which it may take
 * back). A tombstone (a deleted menu's address) and any other menu's address, current or former, are `taken`.
 *
 * `MenuSlug` is not scoped, so this works on any client, inside the transaction that claims the slug.
 */
export function checkSlugAvailable(db: AnyDb, slug: string, forMenuId: string | null): Promise<SlugAvailability>;
export function checkSlugAvailable(db: ScopedDb, slug: string, forMenuId: string | null): Promise<SlugAvailability>;
export async function checkSlugAvailable(client: AnyDb | ScopedDb, slug: string, forMenuId: string | null): Promise<SlugAvailability> {
  const rules = validateSlug(slug, []);
  if (!rules.ok) return rules.reason;
  const row = await delegates(client).menuSlug.findUnique({ where: { slug }, select: { menuId: true } });
  if (!row) return 'ok';
  return forMenuId !== null && row.menuId === forMenuId ? 'ok' : 'taken';
}

/** The message for a slug that cannot be used, beside the slug field. */
export function slugMessage(problem: Exclude<SlugAvailability, 'ok'>): string {
  switch (problem) {
    case 'taken':
      return 'This address is taken';
    case 'RESERVED':
      return 'This address is reserved';
    case 'TOO_SHORT':
      return `Use at least ${SLUG_MIN} characters`;
    case 'TOO_LONG':
      return `Use at most ${SLUG_MAX} characters`;
    case 'BAD_CHARACTERS':
      return 'Use lowercase letters, digits and single hyphens';
  }
}

/** A refusal of `slug` for the slug field. */
export function slugRefusal(problem: Exclude<SlugAvailability, 'ok'>): StudioError {
  const message = slugMessage(problem);
  return new StudioError('INVALID', message, { slug: message });
}

/** Refuses `slug` unless the menu `forMenuId` (null for a new one) may have it. */
export function requireSlugAvailable(db: AnyDb, slug: string, forMenuId: string | null): Promise<void>;
export function requireSlugAvailable(db: ScopedDb, slug: string, forMenuId: string | null): Promise<void>;
export async function requireSlugAvailable(client: AnyDb | ScopedDb, slug: string, forMenuId: string | null): Promise<void> {
  const availability = await checkSlugAvailable(delegates(client), slug, forMenuId);
  if (availability !== 'ok') throw slugRefusal(availability);
}

/**
 * Gives the menu `menuId` the address `slug`, which `requireSlugAvailable` has cleared: a new `MenuSlug` row, or none
 * when the row is already the menu's own (an address it is taking back). Another menu's row is never touched. Two
 * people claiming one address at the same moment meet at the row's key, and the second is told it is taken.
 */
export function claimSlug(db: AnyDb, slug: string, menuId: string): Promise<void>;
export function claimSlug(db: ScopedDb, slug: string, menuId: string): Promise<void>;
export async function claimSlug(client: AnyDb | ScopedDb, slug: string, menuId: string): Promise<void> {
  const db = delegates(client);
  const row = await db.menuSlug.findUnique({ where: { slug }, select: { menuId: true } });
  if (row) {
    if (row.menuId !== menuId) throw slugRefusal('taken');
    return;
  }
  try {
    await db.menuSlug.create({ data: { slug, menuId } });
  } catch (error) {
    if (isUniqueViolation(error)) throw slugRefusal('taken');
    throw error;
  }
}

/** Every address the menu has had, current and former: each is cached on its own, so a change expires them all. */
export function menuSlugs(db: AnyDb, menuId: string): Promise<string[]>;
export function menuSlugs(db: ScopedDb, menuId: string): Promise<string[]>;
export async function menuSlugs(client: AnyDb | ScopedDb, menuId: string): Promise<string[]> {
  const rows = await delegates(client).menuSlug.findMany({ where: { menuId }, select: { slug: true }, orderBy: { createdAt: 'asc' } });
  return rows.map((row) => row.slug);
}

/** Whether a write failed on a unique index: someone else got there first. */
export function isUniqueViolation(error: unknown): boolean {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002';
}

// What a new menu starts with -----------------------------------------------------------------------------------------

/** Breakfast 07:00–11:00, lunch 11:00–16:00, dinner 16:00–22:00 and late night 22:00–03:00, every day of the week. */
export const DEFAULT_SCHEDULE = [
  { daypart: 'BREAKFAST', startMinute: 7 * 60, endMinute: 11 * 60, daysOfWeek: 127 },
  { daypart: 'LUNCH', startMinute: 11 * 60, endMinute: 16 * 60, daysOfWeek: 127 },
  { daypart: 'DINNER', startMinute: 16 * 60, endMinute: 22 * 60, daysOfWeek: 127 },
  { daypart: 'LATE_NIGHT', startMinute: 22 * 60, endMinute: 3 * 60, daysOfWeek: 127 },
] as const;

/** A new menu's brand kit: the platform's default palettes, with the restaurant's name as the logo. */
export function defaultBrand(logoText: string) {
  return {
    tokens: DEFAULT_PALETTES as unknown as Prisma.InputJsonObject,
    typography: {},
    logoText,
  };
}
