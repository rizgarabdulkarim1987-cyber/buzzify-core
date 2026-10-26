import { spawnSync } from 'node:child_process';
import { PassThrough, type Writable } from 'node:stream';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { createPrompter, type PromptInput } from '../../scripts/prompt';
import { databaseUrl, TEST_DB } from '../../scripts/db-config';
import { createPasswordUser } from '@/server/studio/auth/users';
import { requireTestDb, resetTestData, testPrisma } from '../helpers/db';

const GOOD = 'correct horse battery staple';

describe('the prompts', () => {
  /** A terminal: input that can be put in raw mode, and an output that records what was written to the screen. */
  function terminal() {
    const input = Object.assign(new PassThrough(), { isTTY: true, setRawMode: vi.fn() }) as PromptInput & PassThrough;
    const screen: string[] = [];
    const output = new PassThrough();
    output.on('data', (chunk: Buffer) => screen.push(chunk.toString()));
    return { input, output: output as Writable, screen: () => screen.join(''), prompt: createPrompter(input, output) };
  }

  it('reads a hidden answer key by key without showing any of it, and ends it at Enter', async () => {
    const { input, screen, prompt } = terminal();
    const answer = prompt.askHidden('Password: ');
    input.write('s3cret');
    input.write('!\r');
    expect(await answer).toBe('s3cret!');
    expect(screen()).toBe('Password: \n');
    expect(input.setRawMode).toHaveBeenCalledWith(true);
    expect(input.setRawMode).toHaveBeenLastCalledWith(false);
    prompt.close();
  });

  it('takes a pasted answer, and backspace removes the last character', async () => {
    const { input, screen, prompt } = terminal();
    const answer = prompt.askHidden('Password: ');
    input.write('abcd\u007f\u007fxyz\r');
    expect(await answer).toBe('abxyz');
    expect(screen()).toBe('Password: \n');
  });

  it('shows a visible answer as it is typed', async () => {
    const { input, screen, prompt } = terminal();
    const answer = prompt.ask('Name: ');
    input.write('Ann');
    input.write('x\u007f\r');
    expect(await answer).toBe('Ann');
    expect(screen()).toContain('Ann');
  });

  it('does not type the arrow and function keys into the answer', async () => {
    const { input, prompt } = terminal();
    const answer = prompt.askHidden('Password: ');
    input.write('ab\u001b[Acd\u001b[1;5Cef\u001bOPg\r');
    expect(await answer).toBe('abcdefg');
  });

  it('rejects at Ctrl+C and restores the terminal', async () => {
    const { input, prompt } = terminal();
    const answer = prompt.askHidden('Password: ');
    input.write('abc\u0003');
    await expect(answer).rejects.toThrow('Cancelled');
    expect(input.setRawMode).toHaveBeenLastCalledWith(false);
  });

  it('takes one line per question from piped input, echoing none of an answer, and says when there are no more', async () => {
    const input = new PassThrough();
    const screen: string[] = [];
    const output = new PassThrough();
    output.on('data', (chunk: Buffer) => screen.push(chunk.toString()));
    const prompt = createPrompter(input, output);

    input.write('first\r\nsecret-word\nlast');
    input.end();
    expect(await prompt.ask('One: ')).toBe('first');
    expect(await prompt.askHidden('Two: ')).toBe('secret-word');
    expect(await prompt.ask('Three: ')).toBe('last');
    await expect(prompt.ask('Four: ')).rejects.toThrow(/no more input/);
    expect(screen.join('')).not.toContain('secret-word');
    prompt.close();
  });
});

describe('npm run studio:create-admin', () => {
  const prisma = testPrisma();
  const TSX = 'node_modules/tsx/dist/cli.mjs';

  /** Runs the script as `tsx` does, against the test database, with these lines on its standard input. */
  function run(lines: string[], args: string[] = []) {
    const result = spawnSync(process.execPath, [TSX, 'scripts/create-admin.ts', ...args], {
      cwd: process.cwd(),
      input: `${lines.join('\n')}\n`,
      encoding: 'utf8',
      timeout: 60_000,
      env: { ...process.env, DATABASE_URL: databaseUrl(TEST_DB), RESEND_API_KEY: '' },
    });
    return { code: result.status, out: `${result.stdout}${result.stderr}` };
  }

  beforeAll(() => requireTestDb());
  beforeEach(() => resetTestData(prisma));
  afterAll(async () => {
    await resetTestData(prisma);
    await prisma.$disconnect();
  });

  it('runs under tsx, creating a verified Super Admin whose password signs in, and never prints the password', async () => {
    const { code, out } = run(['  Ada Admin ', '  Ada@Example.TEST ', GOOD, GOOD]);

    expect(code).toBe(0);
    expect(out).toContain('Created the Super Admin ada@example.test');
    expect(out).toContain('/studio/sign-in');
    expect(out).not.toContain(GOOD);
    const user = await prisma.user.findUniqueOrThrow({ where: { email: 'ada@example.test' }, include: { accounts: true } });
    // The first Super Admin is the one who sells: the platform owner.
    expect(user).toMatchObject({ name: 'Ada Admin', isSuperAdmin: true, isPlatformOwner: true, emailVerified: true, twoFactorEnabled: false, deactivatedAt: null });
    expect(out).toContain('platform owner');
    expect(user.accounts[0]).toMatchObject({ providerId: 'credential' });
    expect(user.accounts[0]?.password).not.toContain(GOOD);
    // The password that was typed is the one stored.
    const { authFor } = await import('@/server/studio/auth/auth');
    const signedIn = await authFor(prisma).api.signInEmail({ body: { email: 'ada@example.test', password: GOOD } });
    expect(signedIn.user.id).toBe(user.id);
  }, 90_000);

  it('refuses when a Super Admin exists, unless --force', async () => {
    await createPasswordUser(prisma, { email: 'root@example.test', name: 'Root', password: GOOD, isSuperAdmin: true, isPlatformOwner: true });

    const refused = run(['Second', 'second@example.test', GOOD, GOOD]);
    expect(refused.code).toBe(1);
    expect(refused.out).toContain('--force');
    expect(await prisma.user.count()).toBe(1);

    const forced = run(['Second', 'second@example.test', GOOD, GOOD], ['--force']);
    expect(forced.code).toBe(0);
    expect(await prisma.user.count({ where: { isSuperAdmin: true } })).toBe(2);
    // A further Super Admin never takes the platform owner's place.
    expect(await prisma.user.findUniqueOrThrow({ where: { email: 'second@example.test' } })).toMatchObject({ isPlatformOwner: false });
  }, 90_000);

  it('asks again for a weak password, a mismatch and a bad email, and says what is wrong', async () => {
    const { code, out } = run(['Ada', 'not an email', 'ada@example.test', 'password1234', 'short', GOOD, 'something else entirely', GOOD, GOOD]);

    expect(code).toBe(0);
    expect(out).toContain('Enter a valid email address');
    expect(out).toContain('too common');
    expect(out).toContain('at least 12');
    expect(out).toContain('not the same');
    expect(out).not.toContain('password1234');
    expect(await prisma.user.count({ where: { email: 'ada@example.test' } })).toBe(1);
  }, 90_000);

  it('reports an address that is taken, and gives up when there is no more input', async () => {
    await createPasswordUser(prisma, { email: 'ada@example.test', name: 'Ada', password: GOOD });
    const taken = run(['Ada Two', 'ADA@example.test', GOOD, GOOD], ['--force']);
    expect(taken.code).toBe(1);
    expect(taken.out).toContain('already exists');

    const short = run(['Only a name'], ['--force']);
    expect(short.code).toBe(1);
    expect(short.out).toContain('Could not create the Super Admin');
    expect(await prisma.user.count()).toBe(1);
  }, 90_000);
});
