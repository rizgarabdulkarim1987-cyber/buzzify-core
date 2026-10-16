import type { PrismaClient } from '@/generated/prisma/client';
import type { Locale } from '@/lib/locale';
import { authFor, type Auth } from './auth';
import { checkPasswordPolicy, PasswordPolicyError } from './password-policy';

export { PasswordPolicyError };

/** An account with this email already exists. */
export class EmailTakenError extends Error {
  constructor() {
    super('An account with this email already exists');
    this.name = 'EmailTakenError';
  }
}

/** The form an email is stored and compared in: Better Auth lower-cases but does not trim, so both happen here. */
export function normalizeEmail(raw: string): string {
  return raw.trim().toLowerCase();
}

/** Prisma's unique-constraint violation, however many layers wrapped it on the way up. */
function isUniqueViolation(error: unknown): boolean {
  for (let e = error, depth = 0; e && typeof e === 'object' && depth < 5; e = (e as { cause?: unknown }).cause, depth += 1) {
    if ((e as { code?: unknown }).code === 'P2002') return true;
  }
  return false;
}

/**
 * Creates a user who signs in with an email and a password, without going through sign-up (which is disabled). Used for
 * accepting an invitation and for the seed. The email is stored normalized and verified, the password must meet the
 * policy (Better Auth does not check it on this path), and the user and their credential are removed together if
 * either cannot be saved.
 *
 * Throws `PasswordPolicyError` (checked first, so a weak password never reveals whether an address is taken) or
 * `EmailTakenError`, including when two requests for one address race and the database refuses the second.
 */
export async function createPasswordUser(
  prisma: PrismaClient,
  args: { email: string; name: string; password: string; isSuperAdmin?: boolean; locale?: Locale },
  auth: Auth = authFor(prisma),
): Promise<{ userId: string }> {
  const problem = checkPasswordPolicy(args.password);
  if (problem) throw new PasswordPolicyError(problem);

  const email = normalizeEmail(args.email);
  const ctx = await auth.$context;
  if (await ctx.internalAdapter.findUserByEmail(email)) throw new EmailTakenError();

  let user;
  try {
    user = await ctx.internalAdapter.createUser(
      {
        email,
        name: args.name.trim(),
        emailVerified: true,
        isSuperAdmin: args.isSuperAdmin ?? false,
        locale: args.locale ?? 'en',
      },
      { method: 'admin' },
    );
  } catch (error) {
    if (isUniqueViolation(error)) throw new EmailTakenError();
    throw error;
  }

  try {
    await ctx.internalAdapter.linkAccount({
      providerId: 'credential',
      accountId: user.id,
      userId: user.id,
      password: await ctx.password.hash(args.password),
    });
  } catch (error) {
    // The two writes are not one transaction, so a user without a credential is removed rather than left behind.
    await ctx.internalAdapter.deleteUser(user.id);
    throw error;
  }
  return { userId: user.id };
}

/**
 * Switches a person off: they keep their history, but `loadActor` returns nothing for them and every session they hold
 * ends now. Better Auth refuses them a new session (see `databaseHooks` in auth.ts).
 */
export async function deactivateUser(prisma: PrismaClient, userId: string): Promise<void> {
  await prisma.$transaction([
    prisma.user.update({ where: { id: userId }, data: { deactivatedAt: new Date() } }),
    prisma.session.deleteMany({ where: { userId } }),
  ]);
}
