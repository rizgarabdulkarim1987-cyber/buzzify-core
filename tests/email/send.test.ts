import { randomUUID } from 'node:crypto';
import { readdir, rm } from 'node:fs/promises';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Email } from '@/server/email/send';

const resend = vi.hoisted(() => ({ send: vi.fn(), keys: [] as unknown[] }));
vi.mock('resend', () => ({
  Resend: class {
    emails = { send: resend.send };
    constructor(key: unknown) {
      resend.keys.push(key);
    }
  },
}));

const MAIL_DIR = path.join(process.cwd(), '.data', 'mail');
const run = randomUUID();

/** A recipient no other test run shares, so the shared development folder never mixes runs. */
const address = (label: string) => `${label}-${run}@example.test`;

function mail(to: string, subject = 'Welcome', link = 'https://studio.example.test/studio/invite/TOKEN'): Email {
  return { to, subject, html: `<p><a href="${link}">Open</a></p>`, text: `Open it:\n${link}\n` };
}

/** `send.ts` reads the configuration once, so each test loads a fresh copy under its own environment. */
async function load() {
  vi.resetModules();
  return import('@/server/email/send');
}

async function ownFiles(): Promise<string[]> {
  try {
    return (await readdir(MAIL_DIR)).filter((name) => name.includes(run));
  } catch {
    return [];
  }
}

beforeEach(() => {
  resend.send.mockReset();
  resend.keys.length = 0;
  vi.stubEnv('RESEND_API_KEY', '');
  vi.stubEnv('EMAIL_FROM', '');
  vi.spyOn(console, 'info').mockImplementation(() => undefined);
  vi.spyOn(console, 'log').mockImplementation(() => undefined);
  vi.spyOn(console, 'warn').mockImplementation(() => undefined);
  vi.spyOn(console, 'error').mockImplementation(() => undefined);
});

afterEach(async () => {
  vi.useRealTimers();
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
  await Promise.all((await ownFiles()).map((name) => rm(path.join(MAIL_DIR, name), { force: true })));
});

describe('development mail folder', () => {
  it('writes the message to .data/mail and reads it back', async () => {
    const { sendEmail, readDevMail } = await load();
    const to = address('reader');
    const email = mail(to);
    await sendEmail(email);
    expect(await readDevMail(to)).toEqual([email]);
  });

  it('returns nothing for an address that has no mail, or before the folder exists', async () => {
    const { readDevMail } = await load();
    expect(await readDevMail(address('nobody'))).toEqual([]);
  });

  it('keeps one recipient’s mail apart from another’s', async () => {
    const { sendEmail, readDevMail } = await load();
    const [a, b] = [address('a'), address('b')];
    await sendEmail(mail(a, 'For A'));
    await sendEmail(mail(b, 'For B'));
    expect((await readDevMail(a)).map((m) => m.subject)).toEqual(['For A']);
    expect((await readDevMail(b)).map((m) => m.subject)).toEqual(['For B']);
  });

  it('matches an address regardless of case and surrounding spaces', async () => {
    const { sendEmail, readDevMail } = await load();
    const to = address('Mixed.Case');
    await sendEmail(mail(to));
    expect(await readDevMail(`  ${to.toUpperCase()} `)).toHaveLength(1);
  });

  it('returns newest first, also when several messages share a millisecond', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-10-16T09:30:00.123Z'));
    const { sendEmail, readDevMail } = await load();
    const to = address('order');
    for (const subject of ['first', 'second', 'third']) await sendEmail(mail(to, subject));
    vi.setSystemTime(new Date('2026-10-16T09:30:00.124Z'));
    await sendEmail(mail(to, 'fourth'));
    expect((await readDevMail(to)).map((m) => m.subject)).toEqual(['fourth', 'third', 'second', 'first']);
  });

  it('uses file names Windows accepts, even for an address with awkward characters', async () => {
    const { sendEmail, readDevMail } = await load();
    const to = `we:ird/${run}..\\"x"<y>|?*@example.test`;
    const email = mail(to);
    await sendEmail(email);
    expect(await readDevMail(to)).toEqual([email]);
    const names = await ownFiles();
    expect(names).toHaveLength(1);
    expect(names[0]).toMatch(/^[\w.@+-]+\.json$/);
  });

  it('logs the subject and the first link, and not the body', async () => {
    const { sendEmail } = await load();
    await sendEmail({
      to: address('log'),
      subject: 'Reset your password',
      html: '<p>SECRET-HTML-BODY</p>',
      text: 'SECRET-TEXT-BODY\nhttps://studio.example.test/reset?token=abc\nhttps://elsewhere.example.test/second\n',
    });
    const logged = vi.mocked(console.info).mock.calls.flat().join('\n');
    expect(logged).toContain('Reset your password');
    expect(logged).toContain('https://studio.example.test/reset?token=abc');
    expect(logged).not.toContain('elsewhere.example.test');
    expect(logged).not.toContain('SECRET');
  });

  it('does not call Resend without a key', async () => {
    const { sendEmail } = await load();
    await sendEmail(mail(address('nokey')));
    expect(resend.send).not.toHaveBeenCalled();
  });
});

describe('production', () => {
  it('refuses to send without a key, writes no file and logs nothing', async () => {
    vi.stubEnv('NODE_ENV', 'production');
    const { sendEmail } = await load();
    const to = address('prod-nokey');
    await expect(sendEmail(mail(to))).rejects.toThrow(/RESEND_API_KEY/);
    expect(await ownFiles()).toEqual([]);
    expect(resend.send).not.toHaveBeenCalled();
    for (const method of ['info', 'log', 'warn', 'error'] as const) expect(console[method]).not.toHaveBeenCalled();
  });

  it('sends through Resend with from, to, subject, html and text, and logs nothing', async () => {
    vi.stubEnv('NODE_ENV', 'production');
    vi.stubEnv('RESEND_API_KEY', 're_test_key');
    resend.send.mockResolvedValue({ data: { id: 'msg_1' }, error: null, headers: null });
    const { sendEmail } = await load();
    const to = address('prod');
    const email = mail(to, 'Your invitation');
    await sendEmail(email);
    expect(resend.keys).toEqual(['re_test_key']);
    expect(resend.send).toHaveBeenCalledTimes(1);
    expect(resend.send).toHaveBeenCalledWith({
      from: 'Buzzify Studio <studio@buzzify.me>',
      to,
      subject: 'Your invitation',
      html: email.html,
      text: email.text,
    });
    expect(await ownFiles()).toEqual([]);
    for (const method of ['info', 'log', 'warn', 'error'] as const) expect(console[method]).not.toHaveBeenCalled();
  });

  it('sends from EMAIL_FROM when it is set', async () => {
    vi.stubEnv('NODE_ENV', 'production');
    vi.stubEnv('RESEND_API_KEY', 're_test_key');
    vi.stubEnv('EMAIL_FROM', 'Menus <menus@example.test>');
    resend.send.mockResolvedValue({ data: { id: 'msg_2' }, error: null, headers: null });
    const { sendEmail } = await load();
    await sendEmail(mail(address('from')));
    expect(resend.send).toHaveBeenCalledWith(expect.objectContaining({ from: 'Menus <menus@example.test>' }));
  });

  it('puts the platform sender name in front of the address from EMAIL_FROM', async () => {
    vi.stubEnv('NODE_ENV', 'production');
    vi.stubEnv('RESEND_API_KEY', 're_test_key');
    vi.stubEnv('EMAIL_FROM', 'Menus <menus@example.test>');
    resend.send.mockResolvedValue({ data: { id: 'msg_name' }, error: null, headers: null });
    const { sendEmail } = await load();
    await sendEmail(mail(address('named')), { senderName: 'Studio Team' });
    expect(resend.send).toHaveBeenCalledWith(expect.objectContaining({ from: 'Studio Team <menus@example.test>' }));

    // A bare address in EMAIL_FROM gets the name too.
    vi.stubEnv('EMAIL_FROM', 'menus@example.test');
    const second = await load();
    await second.sendEmail(mail(address('named-bare')), { senderName: 'Studio Team' });
    expect(resend.send).toHaveBeenLastCalledWith(expect.objectContaining({ from: 'Studio Team <menus@example.test>' }));
  });

  it('keeps the name in EMAIL_FROM when the platform has none to give, and never lets a name change the address', async () => {
    vi.stubEnv('NODE_ENV', 'production');
    vi.stubEnv('RESEND_API_KEY', 're_test_key');
    resend.send.mockResolvedValue({ data: { id: 'msg_plain' }, error: null, headers: null });
    const { sendEmail, fromWithName } = await load();
    await sendEmail(mail(address('unnamed')), {});
    expect(resend.send).toHaveBeenCalledWith(expect.objectContaining({ from: 'Buzzify Studio <studio@buzzify.me>' }));
    // Whatever the name holds, the header stays one name and the configured address.
    expect(fromWithName('Buzzify Studio <studio@buzzify.me>', 'Evil <x@y.z>\r\nBcc: a@b.c')).toBe('Buzzify Studio <studio@buzzify.me>');
    expect(fromWithName('Buzzify Studio <studio@buzzify.me>', 'مطعم الاستوديو')).toBe('مطعم الاستوديو <studio@buzzify.me>');
  });

  it('surfaces an error result from Resend as a thrown error without the message body', async () => {
    vi.stubEnv('NODE_ENV', 'production');
    vi.stubEnv('RESEND_API_KEY', 're_test_key');
    resend.send.mockResolvedValue({
      data: null,
      error: { name: 'validation_error', message: 'The from domain is not verified.', statusCode: 403 },
      headers: null,
    });
    const { sendEmail } = await load();
    const failure = await sendEmail(mail(address('fail'))).then(
      () => null,
      (error: unknown) => error,
    );
    expect(failure).toBeInstanceOf(Error);
    expect((failure as Error).message).toContain('The from domain is not verified.');
    expect((failure as Error).message).toContain('validation_error');
    expect((failure as Error).message).not.toContain('TOKEN');
    for (const method of ['info', 'log', 'warn', 'error'] as const) expect(console[method]).not.toHaveBeenCalled();
  });
});

describe('with a key outside production', () => {
  it('sends through Resend instead of the folder', async () => {
    vi.stubEnv('RESEND_API_KEY', 're_dev_key');
    resend.send.mockResolvedValue({ data: { id: 'msg_3' }, error: null, headers: null });
    const { sendEmail } = await load();
    await sendEmail(mail(address('devkey')));
    expect(resend.send).toHaveBeenCalledTimes(1);
    expect(await ownFiles()).toEqual([]);
  });
});
