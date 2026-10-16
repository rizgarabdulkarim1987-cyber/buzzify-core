import { randomUUID } from 'node:crypto';
import { readdir, rm } from 'node:fs/promises';
import path from 'node:path';
import { expect, vi } from 'vitest';
import { readDevMail } from '@/server/email/send';

const MAIL_DIR = path.join(process.cwd(), '.data', 'mail');

/**
 * Development mail for one test file. Mail goes to the shared `.data/mail` folder, so each file takes a run id, puts it
 * in every address it uses and removes only its own messages.
 *
 * A send does not delay the response, so a message can land after the test that caused it has finished. Call
 * `nextTest()` in `beforeEach`: addresses carry the number of the test they were made in, so a late message to an earlier
 * test's address is never mistaken for one of the current test's.
 */
export function devMail() {
  const run = randomUUID().slice(0, 8);
  let test = 0;

  const files = async (): Promise<string[]> => {
    try {
      return (await readdir(MAIL_DIR)).filter((name) => name.includes(run));
    } catch {
      return [];
    }
  };

  return {
    /** Starts a new test: its addresses are not the previous test's. */
    nextTest() {
      test += 1;
    },

    /** An address no other test or run shares. */
    address: (label: string) => `${label}-${run}-${test}@example.test`,

    /** The messages sent to an address, once `count` of them have arrived. */
    async mailTo(to: string, count = 1) {
      await vi.waitFor(async () => expect(await readDevMail(to)).toHaveLength(count), { timeout: 5000, interval: 25 });
      return readDevMail(to);
    },

    /** Gives anything that is still being sent time to arrive, for a test that expects nothing to. */
    async quiet() {
      await new Promise((resolve) => setTimeout(resolve, 150));
    },

    /** Removes this file's messages. */
    async clean() {
      await Promise.all((await files()).map((name) => rm(path.join(MAIL_DIR, name), { force: true })));
    },
  };
}

/** The first web link in a message's text. */
export const linkIn = (text: string): string => /https?:\/\/[^\s]+/.exec(text)?.[0] as string;

/** A query parameter of the first link in a message's text. */
export const linkParam = (text: string, name: string): string => new URL(linkIn(text)).searchParams.get(name) as string;
