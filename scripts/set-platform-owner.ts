import 'dotenv/config';
import { stdin, stdout } from 'node:process';
import { createPrisma } from '@/server/data/prisma';
import { normalizeEmail } from '@/server/studio/auth/users';
import { describeDatabase } from './database-target';
import { createPrompter } from './prompt';

/**
 * Moves the platform owner, the one account that changes restaurants' plans, to another Super Admin:
 * `npm run studio:set-platform-owner`. The Studio has no screen for it on purpose, so nobody can take it over from there;
 * this is for handing the business over, or for getting it back when the owner's account is lost. It asks for the new
 * owner's email, shows who holds it now, and changes nothing until it is confirmed with "yes".
 */

async function main(): Promise<void> {
  const prisma = createPrisma();
  const prompt = createPrompter(stdin, stdout);
  try {
    console.log(`Database: ${describeDatabase()}`);
    const email = normalizeEmail(await prompt.ask('Email of the new platform owner: '));
    const next = await prisma.user.findUnique({ where: { email }, select: { id: true, isSuperAdmin: true, deactivatedAt: true, isPlatformOwner: true } });
    if (!next || !next.isSuperAdmin || next.deactivatedAt) {
      console.error(`${email} is not an active Super Admin. Create or reactivate the account first.`);
      process.exitCode = 1;
      return;
    }
    if (next.isPlatformOwner) {
      console.log(`${email} is already the platform owner.`);
      return;
    }
    const current = await prisma.user.findFirst({ where: { isPlatformOwner: true }, select: { email: true } });
    console.log(`The platform owner now: ${current?.email ?? 'nobody'}.`);
    const answer = (await prompt.ask(`Make ${email} the platform owner instead? Type yes to confirm: `)).trim().toLowerCase();
    if (answer !== 'yes') {
      console.error('Nothing was changed.');
      process.exitCode = 1;
      return;
    }
    await prisma.$transaction([
      prisma.user.updateMany({ where: { isPlatformOwner: true }, data: { isPlatformOwner: false } }),
      prisma.user.update({ where: { id: next.id }, data: { isPlatformOwner: true } }),
    ]);
    console.log(`${email} is now the platform owner.`);
  } finally {
    prompt.close();
    await prisma.$disconnect();
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
