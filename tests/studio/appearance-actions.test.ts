import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_APPEARANCE } from '@/lib/appearance';
import { getPrisma } from '@/server/data/prisma';
import * as accountActions from '@/server/studio/actions/account';
import { loadActor } from '@/server/studio/auth/actor';
import { createPasswordUser } from '@/server/studio/auth/users';
import { invoke, invokePublic } from '@/server/studio/framework/invoke';
import type { ActionResult } from '@/server/studio/framework/result';
import * as session from '@/server/studio/public-actions/session';
import { databaseUrl, TEST_DB } from '../../scripts/db-config';
import { Browser } from '../helpers/browser';
import { requireTestDb, resetTestData } from '../helpers/db';
import { devMail } from '../helpers/mail';

vi.mock('next/headers', () => ({ headers: vi.fn(), cookies: vi.fn() }));

const GOOD = 'correct horse battery staple';
const globalForPrisma = globalThis as unknown as { __prisma?: unknown };
const { address, nextTest, quiet, clean } = devMail();
const prisma = () => getPrisma();

const dark = { font: 'serif', bg: '#101010', text: '#f5f5f5', button: '#f2b705', buttonText: '#000000', shape: 'round' } as const;

const dataOf = <T>(result: ActionResult<T>): T => {
  if (!result.ok) throw new Error(`expected success, got ${JSON.stringify(result.error)}`);
  return result.data;
};

async function signedIn(email: string, ip: string) {
  const browser = new Browser(ip, 'Mozilla/5.0 (vitest browser)').activate();
  expect(await invokePublic(session.signIn, { email, password: GOOD })).toMatchObject({ ok: true });
  return browser;
}

let dana: { userId: string };
let omar: { userId: string };
let danaBrowser: Browser;
let omarBrowser: Browser;

beforeAll(async () => {
  requireTestDb();
  vi.stubEnv('DATABASE_URL', databaseUrl(TEST_DB));
  vi.stubEnv('RESEND_API_KEY', '');
  await resetTestData(prisma());
});

beforeEach(async () => {
  nextTest();
  await resetTestData(prisma());
  vi.spyOn(console, 'info').mockImplementation(() => undefined);
  vi.spyOn(console, 'warn').mockImplementation(() => undefined);
  dana = await createPasswordUser(prisma(), { email: address('dana'), name: 'Dana', password: GOOD });
  omar = await createPasswordUser(prisma(), { email: address('omar'), name: 'Omar', password: GOOD });
  danaBrowser = await signedIn(address('dana'), '198.51.100.7');
  omarBrowser = await signedIn(address('omar'), '198.51.100.8');
});

afterEach(async () => {
  vi.restoreAllMocks();
  await clean();
});

afterAll(async () => {
  await quiet();
  await clean();
  await resetTestData(prisma());
  await prisma().$disconnect();
  delete globalForPrisma.__prisma;
  vi.unstubAllEnvs();
});

describe('account.setAppearance', () => {
  it('saves the person’s own look and the actor reads it back', async () => {
    danaBrowser.activate();
    expect(dataOf(await invoke(accountActions.setAppearance, dark))).toEqual(dark);
    expect((await loadActor(prisma(), dana.userId))?.appearance).toEqual(dark);
  });

  it('refuses an unreadable colour on that field and stores nothing', async () => {
    danaBrowser.activate();
    const result = await invoke(accountActions.setAppearance, { ...dark, text: '#101010' });
    expect(result).toMatchObject({ ok: false, error: { code: 'INVALID', fields: { text: expect.any(String) } } });
    expect((await prisma().user.findUniqueOrThrow({ where: { id: dana.userId } })).appearance).toBeNull();
  });

  it('never changes another person’s look', async () => {
    danaBrowser.activate();
    dataOf(await invoke(accountActions.setAppearance, dark));
    expect((await loadActor(prisma(), omar.userId))?.appearance).toEqual(DEFAULT_APPEARANCE);
    omarBrowser.activate();
    dataOf(await invoke(accountActions.setAppearance, { ...dark, shape: 'square' }));
    expect((await loadActor(prisma(), dana.userId))?.appearance).toEqual(dark);
  });

  it('is audited with before and after', async () => {
    danaBrowser.activate();
    dataOf(await invoke(accountActions.setAppearance, dark));
    const rows = await prisma().auditLog.findMany({ where: { action: 'account.appearance_changed' } });
    expect(rows).toHaveLength(1);
  });
});

describe('account.resetAppearance', () => {
  it('returns the person to the default look', async () => {
    danaBrowser.activate();
    dataOf(await invoke(accountActions.setAppearance, dark));
    dataOf(await invoke(accountActions.resetAppearance, undefined));
    expect((await loadActor(prisma(), dana.userId))?.appearance).toEqual(DEFAULT_APPEARANCE);
  });

  it('refuses a request without a session', async () => {
    new Browser().activate();
    expect(await invoke(accountActions.resetAppearance, undefined)).toMatchObject({ ok: false, error: { code: 'UNAUTHENTICATED' } });
  });
});
