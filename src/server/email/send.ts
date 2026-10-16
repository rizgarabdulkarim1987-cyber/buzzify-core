import { mkdir, readdir, readFile, rename, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { mailEnv } from '@/server/env';

export interface Email {
  to: string;
  subject: string;
  html: string;
  text: string;
}

/** Where development mail goes, relative to the working directory (`.data/` is git-ignored). */
const mailDir = () => path.join(process.cwd(), '.data', 'mail');

/** An address as a file name part: only characters every file system accepts, lower case, and short enough for a Windows path. */
function fileSafe(address: string): string {
  return address
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9@._+-]/g, '_')
    .slice(0, 100);
}

const sameAddress = (a: string, b: string) => a.trim().toLowerCase() === b.trim().toLowerCase();

let lastSequence = 0;

/**
 * A name that sorts in sending order: the time to the millisecond (ISO 8601 with `-` for `:`, which Windows rejects),
 * then a counter that breaks ties between messages sent in the same millisecond, then the address.
 */
function fileName(to: string): string {
  const stamp = new Date().toISOString().replace(/:/g, '-');
  lastSequence = (lastSequence + 1) % 1_000_000;
  return `${stamp}-${String(lastSequence).padStart(6, '0')}-${fileSafe(to)}.json`;
}

/** The first web link in a text body, or `null`. */
function firstLink(text: string): string | null {
  return /https?:\/\/[^\s<>"']+/.exec(text)?.[0] ?? null;
}

async function writeDevMail(email: Email): Promise<void> {
  const dir = mailDir();
  await mkdir(dir, { recursive: true });
  const file = path.join(dir, fileName(email.to));
  // Written under another name and renamed, so a reader never meets a half-written file.
  await writeFile(`${file}.tmp`, JSON.stringify(email, null, 2), 'utf8');
  await rename(`${file}.tmp`, file);
  const link = firstLink(email.text);
  console.info(`[mail] to ${email.to}: ${email.subject}${link ? `\n[mail] ${link}` : ''}`);
}

async function sendWithResend(email: Email, apiKey: string, from: string): Promise<void> {
  const { Resend } = await import('resend');
  const { error } = await new Resend(apiKey).emails.send({
    from,
    to: email.to,
    subject: email.subject,
    html: email.html,
    text: email.text,
  });
  // Resend reports a refused message in the result instead of throwing. Nothing about the message goes in the error.
  if (error) throw new Error(`Email delivery failed (${error.name}): ${error.message}`);
}

/**
 * Sends an email. With `RESEND_API_KEY` set it goes through Resend from `EMAIL_FROM`. Without a key it is written to
 * `.data/mail/` and its subject and first link are logged, which is for development only: in production a missing key
 * is an error, so a reset or invitation never silently goes nowhere. Production never logs a message.
 */
export async function sendEmail(email: Email): Promise<void> {
  const { resendApiKey, emailFrom } = mailEnv();
  if (resendApiKey) return sendWithResend(email, resendApiKey, emailFrom);
  if (process.env.NODE_ENV === 'production') {
    throw new Error('RESEND_API_KEY is not set, so email cannot be sent in production.');
  }
  await writeDevMail(email);
}

/** The development mail sent to an address, newest first. Used by tests and the end-to-end suite. */
export async function readDevMail(to: string): Promise<Email[]> {
  const dir = mailDir();
  let names: string[];
  try {
    names = await readdir(dir);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return [];
    throw error;
  }
  const suffix = `-${fileSafe(to)}.json`;
  const found: Email[] = [];
  for (const name of names.filter((n) => n.endsWith(suffix)).sort().reverse()) {
    const email = JSON.parse(await readFile(path.join(dir, name), 'utf8')) as Email;
    // Different addresses can share a file-safe form, so the stored address decides.
    if (sameAddress(email.to, to)) found.push(email);
  }
  return found;
}
