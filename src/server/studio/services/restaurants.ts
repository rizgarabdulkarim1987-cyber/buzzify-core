import { z } from 'zod';
import type { Prisma, PrismaClient } from '@/generated/prisma/client';
import { expireMenu } from '@/server/data/cache';
import type { ScopedTx } from '@/server/data/tenant-db';
import { refreshDraftHash } from '@/server/publish/draft';
import {
  emptyWorkingHours,
  MAX_RANGES_PER_DAY,
  readSocialLinks,
  readWorkingHours,
  RESTAURANT_STATUSES,
  RESTAURANT_TYPES,
  SOCIAL_NETWORKS,
  TIME_OF_DAY,
  type SocialLinks,
} from '@/server/domain/restaurant-profile';
import type { Actor } from '@/server/studio/auth/actor';
import { describeError, StudioError } from '@/server/studio/framework/result';

export { formatClientId, parseClientId } from '@/server/domain/restaurant-profile';

/**
 * A restaurant's profile and its branches: what the Studio accepts for them, how they are stored, and the changes the
 * actions make to them. The actions run these on the transaction of a restaurant (or platform) target and write the
 * audit rows from what they return.
 */

// What the Studio accepts ---------------------------------------------------------------------------------------------

const PHONE = /^[+0-9 ()-]*$/;

const text = (max: number, message = 'This is too long') => z.string().trim().max(max, message).default('');

const phone = z
  .string()
  .trim()
  .max(32, 'This is too long')
  .regex(PHONE, 'Use digits, spaces, + ( ) and - only')
  .default('');

/** An https:// link, or nothing. */
function isHttpsLink(value: string): boolean {
  if (value === '') return true;
  try {
    const url = new URL(value);
    return url.protocol === 'https:' && url.hostname.includes('.') && !url.username && !url.password;
  } catch {
    return false;
  }
}

const link = z.string().trim().max(300, 'This is too long').refine(isHttpsLink, 'Enter a link that starts with https://').default('');

const time = z.string().regex(TIME_OF_DAY, 'Enter a time such as 09:00');

/** Opening and closing time. A closing time before the opening time is after midnight; the same time twice is no range. */
const timeRange = z.tuple([time, time]).refine(([open, close]) => open !== close, 'Opening and closing times cannot be the same');

const dayRanges = z.array(timeRange).max(MAX_RANGES_PER_DAY, 'Use at most 3 time ranges a day').default([]);

const workingHours = z
  .object({
    mon: dayRanges,
    tue: dayRanges,
    wed: dayRanges,
    thu: dayRanges,
    fri: dayRanges,
    sat: dayRanges,
    sun: dayRanges,
  })
  .default(() => emptyWorkingHours());

/**
 * Everything a restaurant's profile holds. Saving replaces the whole profile: what the form does not send is emptied,
 * so the form always sends every field.
 */
export const restaurantInput = z.object({
  name: z.string().trim().min(1, 'Enter the restaurant name').max(120, 'Use at most 120 characters'),
  type: z.enum(RESTAURANT_TYPES, 'Choose one of the types offered'),
  description: text(2000),
  address: text(200),
  city: text(200),
  country: text(200),
  phone,
  whatsapp: phone,
  /** A link to the restaurant on a map, shown with the address on template menus. */
  mapUrl: link,
  socialLinks: z.object({ instagram: link, facebook: link, tiktok: link, website: link }).default({ instagram: '', facebook: '', tiktok: '', website: '' }),
  workingHours,
  notes: text(5000),
});

export type RestaurantInput = z.infer<typeof restaurantInput>;

/** A branch of a restaurant. */
export const branchInput = z.object({
  name: z.string().trim().min(1, 'Enter the branch name').max(120, 'Use at most 120 characters'),
  address: text(200),
  city: text(200),
  phone,
  workingHours,
});

export type BranchInput = z.infer<typeof branchInput>;

export const restaurantStatus = z.enum(RESTAURANT_STATUSES, 'Choose one of the statuses offered');

// Who sees what -------------------------------------------------------------------------------------------------------

/**
 * Whether the person may read and write the restaurant's notes. They are the agency's own, about the client (how they
 * pay, what they asked for), so the client's owner never sees them: only Super Admins and the designers who work on it.
 */
export function seesAgencyNotes(actor: Actor, restaurantId: string): boolean {
  if (actor.isSuperAdmin) return true;
  return actor.memberships.some((m) => m.restaurantId === restaurantId && m.role === 'DESIGNER');
}

// Storage -------------------------------------------------------------------------------------------------------------

/** A restaurant's profile as the form and the audit log see it: every field, normalized. */
export type Profile = RestaurantInput;

/** The profile fields of an input that carries more (the restaurant and version an update names). */
export function pickProfile(input: Profile): Profile {
  const { name, type, description, address, city, country, phone, whatsapp, mapUrl, socialLinks, workingHours, notes } = input;
  return { name, type, description, address, city, country, phone, whatsapp, mapUrl, socialLinks, workingHours, notes };
}

interface ProfileRow {
  name: string;
  type: Profile['type'];
  description: string;
  address: string;
  city: string;
  country: string;
  phone: string;
  whatsapp: string;
  mapUrl: string;
  socialLinks: unknown;
  workingHours: unknown;
  notes: string;
}

/** The profile a stored row holds. Stored JSON is read defensively: whatever it holds, the result has the full shape. */
export function profileOf(row: ProfileRow): Profile {
  return {
    name: row.name,
    type: row.type,
    description: row.description,
    address: row.address,
    city: row.city,
    country: row.country,
    phone: row.phone,
    whatsapp: row.whatsapp,
    mapUrl: row.mapUrl,
    socialLinks: readSocialLinks(row.socialLinks),
    workingHours: readWorkingHours(row.workingHours),
    notes: row.notes,
  };
}

/** Only the links that were given are stored. */
function storedLinks(links: SocialLinks): Prisma.InputJsonObject {
  return Object.fromEntries(SOCIAL_NETWORKS.filter((network) => links[network] !== '').map((network) => [network, links[network]]));
}

/** A profile as the columns that store it. */
export function profileData(profile: Profile) {
  return {
    name: profile.name,
    type: profile.type,
    description: profile.description,
    address: profile.address,
    city: profile.city,
    country: profile.country,
    phone: profile.phone,
    whatsapp: profile.whatsapp,
    mapUrl: profile.mapUrl,
    socialLinks: storedLinks(profile.socialLinks),
    workingHours: profile.workingHours as Prisma.InputJsonObject,
    notes: profile.notes,
  };
}

/** The fields that differ, each with what it was and what it became, for the audit log. Nested values compare by content. */
export function changedFields<T extends object>(before: T, after: T): Record<string, { before: unknown; after: unknown }> {
  const changes: Record<string, { before: unknown; after: unknown }> = {};
  for (const key of Object.keys(after) as Array<keyof T & string>) {
    if (JSON.stringify(before[key]) !== JSON.stringify(after[key])) changes[key] = { before: before[key], after: after[key] };
  }
  return changes;
}

/** What a new profile adds, for the audit log: every field that has something in it. */
export function addedFields<T extends object>(after: T): Record<string, { before: unknown; after: unknown }> {
  const empty = (value: unknown) =>
    value === '' || (typeof value === 'object' && value !== null && Object.values(value).every((part) => part === '' || (Array.isArray(part) && part.length === 0)));
  return Object.fromEntries(Object.entries(after).filter(([, value]) => !empty(value)).map(([key, value]) => [key, { before: null, after: value }]));
}

/** A branch as the form and the audit log see it. */
export type BranchProfile = BranchInput;

/** The branch fields of an input that carries more (the restaurant, branch and version an update names). */
export function pickBranch(input: BranchProfile): BranchProfile {
  const { name, address, city, phone, workingHours } = input;
  return { name, address, city, phone, workingHours };
}

export function branchProfileOf(row: { name: string; address: string; city: string; phone: string; workingHours: unknown }): BranchProfile {
  return { name: row.name, address: row.address, city: row.city, phone: row.phone, workingHours: readWorkingHours(row.workingHours) };
}

export function branchData(branch: BranchProfile) {
  return {
    name: branch.name,
    address: branch.address,
    city: branch.city,
    phone: branch.phone,
    workingHours: branch.workingHours as Prisma.InputJsonObject,
  };
}

// Status and deletion -------------------------------------------------------------------------------------------------

/**
 * Every menu of the restaurant with every address it has ever had: the public pages cache each address on its own, so
 * a change to the restaurant has to expire them all. Run it on the restaurant's client, which keeps the menus to its own.
 */
export async function menuAddresses(tx: ScopedTx): Promise<Array<{ menuId: string; slugs: string[] }>> {
  const menus = await tx.menu.findMany({ select: { id: true } });
  if (menus.length === 0) return [];
  const slugs = await tx.menuSlug.findMany({ where: { menuId: { in: menus.map((menu) => menu.id) } }, select: { slug: true, menuId: true } });
  return menus.map((menu) => ({ menuId: menu.id, slugs: slugs.filter((entry) => entry.menuId === menu.id).map((entry) => entry.slug) }));
}

/**
 * Expires every address of every menu of the restaurant (`menuAddresses`) once the transaction has committed, for a
 * change guests see (its status, its plan). Run it on the restaurant's client, inside the transaction that makes it.
 */
export async function expireMenusAfterCommit(tx: ScopedTx, afterCommit: (fn: () => void) => void): Promise<void> {
  const menus = await menuAddresses(tx);
  afterCommit(() => {
    for (const { menuId, slugs } of menus) expireMenu(slugs, menuId);
  });
}

/**
 * Recomputes the draft hash of each menu (`refreshDraftHash`) after a change to its restaurant that guests see: the
 * restaurant's name is part of every menu's snapshot, so a rename is an unpublished change of each of them until it is
 * published. Run it with the application's client once the change has committed: a restaurant's client cannot read a
 * menu's rows.
 *
 * Each menu is refreshed in a transaction that takes the menu's row lock before it reads, so refreshes after two renames
 * in quick succession run one after the other, and the later one reads the later name. A menu deleted meanwhile is
 * skipped. A failure is logged and does not stop the others: the change itself has committed.
 */
export async function refreshDraftHashes(prisma: PrismaClient, menuIds: readonly string[]): Promise<void> {
  for (const menuId of menuIds) {
    try {
      await prisma.$transaction(async (tx) => {
        const { count } = await tx.menu.updateMany({ where: { id: menuId }, data: { draftHash: null } });
        if (count > 0) await refreshDraftHash(tx, menuId);
      });
    } catch (error) {
      console.error(`[studio] Refreshing the draft hash of menu ${menuId} failed with ${describeError(error)}`);
    }
  }
}

export const PHARMACY_NOT_DELETED = 'A pharmacy is never deleted: its catalog and history are kept. Suspend it instead.';
export const PHARMACY_BRANCH_NOT_DELETED = 'A pharmacy branch is never deleted: its staff, prices and settings depend on it.';

/**
 * Deletes a restaurant that has no menus, with its branches, members and invitations. Refused while it has any menu
 * (archived ones too: a menu keeps its slugs and its history) and unless `confirmName` is its name. Run it on the
 * restaurant's client; the invitation table is not scoped to a restaurant, so the restaurant is named here.
 */
export async function removeRestaurant(
  tx: ScopedTx,
  args: { restaurantId: string; confirmName: string },
): Promise<{ name: string; memberships: number; invitations: number; branches: number }> {
  const restaurant = await tx.restaurant.findUnique({ where: { id: args.restaurantId }, select: { id: true, name: true, sector: true } });
  if (!restaurant) throw new StudioError('NOT_FOUND');
  // A pharmacy keeps its catalog, prices and history (spec 4.7: archived, never deleted); deleting would cascade into
  // them or stop on a restricted price row.
  if (restaurant.sector === 'PHARMACY') throw new StudioError('CONFLICT', PHARMACY_NOT_DELETED);
  // Payment history is never deleted, and payments name their subscription: such a restaurant is suspended instead.
  // Checked before the menus, so the owner learns this before deleting any of them.
  if ((await tx.subscription.count()) > 0 || (await tx.payment.count()) > 0) {
    throw new StudioError('CONFLICT', 'This restaurant has subscriptions or payments on record, which are never deleted. Suspend it instead.');
  }
  if ((await tx.menu.count()) > 0) throw new StudioError('INVALID', 'Delete all of its menus first');
  if (args.confirmName.trim() !== restaurant.name) {
    const message = 'Type the restaurant name exactly to confirm';
    throw new StudioError('INVALID', message, { confirmName: message });
  }
  const invitations = await tx.invitation.deleteMany({ where: { restaurantId: restaurant.id } });
  const memberships = await tx.membership.deleteMany({});
  const branches = await tx.branch.deleteMany({});
  await tx.restaurant.delete({ where: { id: restaurant.id } });
  return { name: restaurant.name, memberships: memberships.count, invitations: invitations.count, branches: branches.count };
}

// Branches ------------------------------------------------------------------------------------------------------------

/**
 * Puts the restaurant's branches in the order given, then any that were not named in their current order. Says what the
 * order was and what it is now; branches whose place did not change are not written. Run it on the restaurant's client.
 */
export async function arrangeBranches(tx: ScopedTx, order: readonly string[]): Promise<{ before: string[]; after: string[] }> {
  const existing = await tx.branch.findMany({ select: { id: true, sortOrder: true }, orderBy: [{ sortOrder: 'asc' }, { id: 'asc' }] });
  const known = new Set(existing.map((branch) => branch.id));
  if (order.some((id) => !known.has(id))) throw new StudioError('NOT_FOUND');
  const listed = new Set(order);
  const after = [...order, ...existing.filter((branch) => !listed.has(branch.id)).map((branch) => branch.id)];
  const current = new Map(existing.map((branch) => [branch.id, branch.sortOrder]));
  for (const [index, id] of after.entries()) {
    if (current.get(id) !== index) await tx.branch.update({ where: { id }, data: { sortOrder: index } });
  }
  return { before: existing.map((branch) => branch.id), after };
}
