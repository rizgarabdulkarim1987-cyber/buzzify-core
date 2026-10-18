import { cookies, headers } from 'next/headers';
import { cache } from 'react';
import type { PrismaClient } from '@/generated/prisma/client';
import { isLocale, type Locale } from '@/lib/locale';
import { getPrisma } from '@/server/data/prisma';
import type { MemberRole } from '@/server/domain/permissions';
import { authFor } from './auth';

/** Who is acting: the signed-in person and everything the permission checks need to know about them. */
export interface Actor {
  userId: string;
  email: string;
  name: string;
  isSuperAdmin: boolean;
  /** The one account that sells and alone changes plans; true only while the person is also a Super Admin. */
  isPlatformOwner: boolean;
  twoFactorEnabled: boolean;
  locale: Locale;
  memberships: Array<{ restaurantId: string; role: MemberRole }>;
}

/** The actor for a user id, or `null` when there is no such user or the user is deactivated. */
export async function loadActor(prisma: PrismaClient, userId: string): Promise<Actor | null> {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    include: { memberships: { select: { restaurantId: true, role: true }, orderBy: { createdAt: 'asc' } } },
  });
  if (!user || user.deactivatedAt) return null;
  return {
    userId: user.id,
    email: user.email,
    name: user.name,
    isSuperAdmin: user.isSuperAdmin,
    isPlatformOwner: user.isSuperAdmin && user.isPlatformOwner,
    twoFactorEnabled: user.twoFactorEnabled ?? false,
    locale: isLocale(user.locale) ? user.locale : 'en',
    memberships: user.memberships,
  };
}

/** The actor whose session cookie `requestHeaders` carry, or `null` when there is none (or the person is deactivated). */
export async function actorFromHeaders(prisma: PrismaClient, requestHeaders: Headers): Promise<Actor | null> {
  const session = await authFor(prisma).api.getSession({ headers: requestHeaders });
  if (!session) return null;
  return loadActor(prisma, session.user.id);
}

/**
 * The current request's headers with its `cookie` header taken from `cookies()`. The two differ in the page Next renders
 * along with a Server Action's answer when the action has set cookies: `cookies()` then holds the new ones and
 * `headers()` still the ones the browser sent. Turning on two-factor, changing the password and accepting an invitation
 * all replace the session cookie, and the page rendered with their answer must see the new session, not the one that
 * was just ended (it would send the person to the sign-in page).
 */
async function sessionHeaders(): Promise<Headers> {
  const [requestHeaders, jar] = await Promise.all([headers(), cookies()]);
  const current = new Headers(requestHeaders);
  // Name and value only: inside an action `cookies()` holds response cookies, whose own `toString()` adds attributes.
  const cookie = jar
    .getAll()
    .filter(({ value }) => value !== '')
    .map(({ name, value }) => `${name}=${encodeURIComponent(value)}`)
    .join('; ');
  if (cookie) current.set('cookie', cookie);
  else current.delete('cookie');
  return current;
}

/**
 * The actor behind the current request, or `null` when nobody is signed in. Cached for the length of one request, so a
 * page, its layout and the components under them share one session lookup and one database read.
 */
export const getActor = cache(async (): Promise<Actor | null> => actorFromHeaders(getPrisma(), await sessionHeaders()));
