import type { PrismaClient } from '@/generated/prisma/client';
import { createPasswordUser, EmailTakenError, PasswordPolicyError } from '@/server/studio/auth/users';
import { assertLocalDatabase } from './local-database';

/**
 * The people a developer signs in as. All three share the password in `DEV_SEED_PASSWORD`; none has two-factor, so
 * the Super Admin is sent to set it up on the first sign-in, as any new Super Admin is.
 */
const DEV_USERS = [
  { email: 'admin@buzzify.test', name: 'Dev Super Admin', superAdmin: true, role: null },
  { email: 'designer@buzzify.test', name: 'Dev Designer', superAdmin: false, role: 'DESIGNER' },
  { email: 'owner@buzzify.test', name: 'Dev Owner', superAdmin: false, role: 'OWNER' },
] as const;

/**
 * Creates the development sign-in users and gives the Designer and the Owner their role in `restaurantId` (the demo
 * restaurant). Safe to run again: a user who already exists keeps their password and everything else, and only a missing
 * membership is added.
 *
 * Refuses to run (it throws, before anything is written) when `NODE_ENV` is `production`, and when `DATABASE_URL` points
 * at a host that is not this machine unless `ALLOW_REMOTE_DEV_SEED=1` says it may: a laptop with the connection string
 * of a hosted database is not "production" to the code, and these accounts share a password that is written in
 * `.env.example`. It does nothing, with a line saying so, while `DEV_SEED_PASSWORD` is not set: a database seeded without
 * it has no accounts with a password everybody knows.
 */
export async function seedDevUsers(prisma: PrismaClient, restaurantId: string): Promise<void> {
  if (process.env.NODE_ENV === 'production') {
    throw new Error('The development users are never created in production (NODE_ENV is "production")');
  }
  const password = process.env.DEV_SEED_PASSWORD;
  if (!password) {
    console.log('Skipped the development users: DEV_SEED_PASSWORD is not set (see .env.example).');
    return;
  }
  assertLocalDatabase('Creating the development users');

  const created: string[] = [];
  const kept: string[] = [];
  for (const dev of DEV_USERS) {
    let user = await prisma.user.findUnique({ where: { email: dev.email }, select: { id: true } });
    if (user) {
      kept.push(dev.email);
    } else {
      try {
        const { userId } = await createPasswordUser(prisma, {
          email: dev.email,
          name: dev.name,
          password,
          isSuperAdmin: dev.superAdmin,
          // The development Super Admin manages the plans, unless the database already has its platform owner.
          isPlatformOwner: dev.superAdmin && (await prisma.user.count({ where: { isPlatformOwner: true } })) === 0,
        });
        user = { id: userId };
        created.push(dev.email);
      } catch (error) {
        if (error instanceof PasswordPolicyError) {
          throw new Error(`DEV_SEED_PASSWORD does not meet the password policy (${error.reason}); choose a longer, less common one`);
        }
        // Another run made the user between the look-up and the insert: it is theirs now, so it is kept.
        if (!(error instanceof EmailTakenError)) throw error;
        user = await prisma.user.findUniqueOrThrow({ where: { email: dev.email }, select: { id: true } });
        kept.push(dev.email);
      }
    }

    if (dev.role) {
      await prisma.membership.upsert({
        where: { userId_restaurantId: { userId: user.id, restaurantId } },
        create: { userId: user.id, restaurantId, role: dev.role },
        update: {},
      });
    }
  }

  const parts = [created.length > 0 ? `created ${created.join(', ')}` : '', kept.length > 0 ? `kept ${kept.join(', ')}` : ''];
  console.log(`Development users: ${parts.filter(Boolean).join('; ')}`);
}
