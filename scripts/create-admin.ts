import 'dotenv/config';
import { stdin, stdout } from 'node:process';
import { z } from 'zod';
import { createPrisma } from '@/server/data/prisma';
import { authEnv } from '@/server/env';
import { checkPasswordPolicy, passwordProblemMessage } from '@/server/studio/auth/password-policy';
import { createPasswordUser, EmailTakenError, normalizeEmail } from '@/server/studio/auth/users';
import { createPrompter, type Prompter } from './prompt';

/**
 * Creates the first Super Admin: `npm run studio:create-admin`. Accounts are invitation-only, so the first one has to
 * come from the terminal of whoever runs the Studio. It asks for a name, an email and a password (twice, never shown),
 * and refuses when a Super Admin already exists unless `--force` is given.
 *
 * The password is read from the terminal and goes to the database as a hash; it is not an argument, not an environment
 * variable, and never written out. The new person must set up two-factor when they first sign in.
 */

const ATTEMPTS = 5;

const emailSchema = z.email();

/** Asks until `check` accepts the answer (it returns a message when it does not), giving up after a few tries. */
async function askUntil<T>(
  ask: () => Promise<string>,
  check: (answer: string) => { value: T } | { problem: string },
): Promise<T> {
  for (let attempt = 1; ; attempt += 1) {
    const result = check(await ask());
    if ('value' in result) return result.value;
    console.error(result.problem);
    if (attempt >= ATTEMPTS) throw new Error('Too many invalid answers');
  }
}

async function askPassword(prompt: Prompter): Promise<string> {
  for (let attempt = 1; ; attempt += 1) {
    const password = await askUntil<string>(
      () => prompt.askHidden('Password (at least 12 characters, not shown): '),
      (answer) => {
        const problem = checkPasswordPolicy(answer);
        return problem ? { problem: passwordProblemMessage(problem) } : { value: answer };
      },
    );
    if ((await prompt.askHidden('Password again: ')) === password) return password;
    console.error('The two passwords are not the same.');
    if (attempt >= ATTEMPTS) throw new Error('Too many invalid answers');
  }
}

/** Where `DATABASE_URL` points, without its credentials, so the person can see which database this will change. */
function describeDatabase(): string {
  const url = process.env.DATABASE_URL;
  if (!url || !URL.canParse(url)) return 'the development database (DATABASE_URL is not set)';
  const { hostname, port, pathname } = new URL(url);
  return `${hostname}${port ? `:${port}` : ''}${pathname}`;
}

async function main(): Promise<void> {
  const force = process.argv.includes('--force');
  const prisma = createPrisma();
  const prompt = createPrompter(stdin, stdout);
  try {
    console.log(`Database: ${describeDatabase()}`);
    const existing = await prisma.user.count({ where: { isSuperAdmin: true } });
    if (existing > 0 && !force) {
      console.error(
        `This database already has ${existing === 1 ? 'a Super Admin' : `${existing} Super Admins`}. ` +
          'Invite further staff from the Studio. To create another one from here anyway, run this again with --force.',
      );
      process.exitCode = 1;
      return;
    }

    const name = await askUntil<string>(
      () => prompt.ask('Name: '),
      (answer) => (answer.trim() && answer.trim().length <= 120 ? { value: answer.trim() } : { problem: 'Enter a name of up to 120 characters.' }),
    );
    const email = await askUntil<string>(
      () => prompt.ask('Email: '),
      (answer) => {
        const normalized = normalizeEmail(answer);
        return emailSchema.safeParse(normalized).success && normalized.length <= 254
          ? { value: normalized }
          : { problem: 'Enter a valid email address.' };
      },
    );
    const password = await askPassword(prompt);

    try {
      await createPasswordUser(prisma, { email, name, password, isSuperAdmin: true });
    } catch (error) {
      if (error instanceof EmailTakenError) {
        console.error(`An account with the email ${email} already exists.`);
        process.exitCode = 1;
        return;
      }
      throw error;
    }
    console.log(`Created the Super Admin ${email}.`);
    console.log(`Sign in at ${authEnv().baseUrl}/studio/sign-in. Two-factor authentication must be set up on the first sign-in.`);
  } finally {
    prompt.close();
    await prisma.$disconnect();
  }
}

/** What went wrong, without Prisma's message: it quotes the query's arguments, which here include the password's hash. */
function describeFailure(error: unknown): string {
  if (!(error instanceof Error)) return 'an unexpected error';
  if (!error.name.startsWith('PrismaClient')) return error.message;
  const code = (error as { code?: unknown }).code;
  return typeof code === 'string' ? `${error.name} (${code})` : error.name;
}

main().catch((error: unknown) => {
  console.error(`Could not create the Super Admin: ${describeFailure(error)}`);
  process.exitCode = 1;
});
