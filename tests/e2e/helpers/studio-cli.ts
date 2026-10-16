/**
 * The Studio account work of the end-to-end helpers that needs the Studio's sign-in code (`createPasswordUser`, which
 * builds Better Auth, and `createInvitation`, which mails through it). Playwright's module loader cannot resolve the
 * `next/server` import that code makes, so `studio.ts` runs this file with tsx in a child process, as
 * `npm run studio:create-admin` runs the same code. It reads a command and a JSON argument and prints its JSON answer
 * on a line of its own after `STUDIO_CLI ` (the development mailer logs to the same output).
 */
import { createPrisma } from '@/server/data/prisma';
import { createPasswordUser } from '@/server/studio/auth/users';
import { createInvitation } from '@/server/studio/services/invitations';
import { DEV_DB, databaseUrl } from '../../../scripts/db-config';

const [command, raw = '{}'] = process.argv.slice(2);
const input = JSON.parse(raw) as Record<string, unknown>;
const prisma = createPrisma(databaseUrl(DEV_DB));

try {
  let answer: unknown;
  switch (command) {
    case 'create-user':
      answer = await createPasswordUser(prisma, {
        email: String(input.email),
        name: String(input.name),
        password: String(input.password),
        isSuperAdmin: input.superAdmin === true,
        locale: input.locale === 'ar' || input.locale === 'ckb' ? input.locale : 'en',
      });
      break;
    case 'invite-owner':
      answer = await createInvitation(prisma, {
        email: String(input.email),
        restaurantId: String(input.restaurantId),
        role: 'OWNER',
        asSuperAdmin: false,
        invitedById: String(input.inviterId),
        now: new Date(),
      });
      break;
    default:
      throw new Error(`Unknown command ${command}`);
  }
  process.stdout.write(`\nSTUDIO_CLI ${JSON.stringify(answer)}\n`);
} finally {
  await prisma.$disconnect();
}
