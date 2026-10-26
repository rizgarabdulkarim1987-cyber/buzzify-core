import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { getPrisma } from '@/server/data/prisma';
import { defaultPlatformSettings, normalizeReservedSlugs, readPlatformSettings } from '@/server/domain/platform-settings';
import * as menus from '@/server/studio/actions/menus';
import * as settingsActions from '@/server/studio/actions/settings';
import { loadActor, type Actor } from '@/server/studio/auth/actor';
import { runAction, type ActionDef } from '@/server/studio/framework/action';
import { runQuery, type QueryDef } from '@/server/studio/framework/query';
import type { ActionResult } from '@/server/studio/framework/result';
import * as menuQueries from '@/server/studio/queries/menus';
import * as settingsQueries from '@/server/studio/queries/settings';
import { checkSlugAvailable } from '@/server/studio/services/menus';
import { getPlatformSettings } from '@/server/studio/services/settings';
import { SERVER_TEXT } from '@/studio/errors';
import { sendEmail } from '@/server/email/send';
import { sendAfterResponse } from '@/server/studio/auth/auth';
import { databaseUrl, TEST_DB } from '../../scripts/db-config';
import { createMenuFixture, requireTestDb, resetTestData } from '../helpers/db';

// The mail an account email would send is watched, not sent.
vi.mock('@/server/email/send', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/server/email/send')>();
  return { ...actual, sendEmail: vi.fn(async () => undefined) };
});

const globalForPrisma = globalThis as unknown as { __prisma?: unknown };
const prisma = () => getPrisma();
const META = { ip: '203.0.113.9', userAgent: 'vitest' };

const dataOf = <T>(result: ActionResult<T>): T => {
  if (!result.ok) throw new Error(`expected success, got ${JSON.stringify(result.error)}`);
  return result.data;
};
const failureOf = (result: ActionResult<unknown>) => {
  if (result.ok) throw new Error(`expected a failure, got ${JSON.stringify(result.data)}`);
  return result.error;
};
const codeOf = (result: ActionResult<unknown>) => (result.ok ? 'OK' : result.error.code);

let admin: Actor;
let designer: Actor;
let atelier: { id: string };

async function person(id: string, name: string, memberships: Array<[string, 'DESIGNER' | 'OWNER']> = [], superAdmin = false): Promise<Actor> {
  await prisma().user.create({ data: { id, name, email: `${id}@example.com`, isSuperAdmin: superAdmin, twoFactorEnabled: superAdmin } });
  for (const [restaurantId, role] of memberships) await prisma().membership.create({ data: { userId: id, restaurantId, role } });
  return (await loadActor(prisma(), id)) as Actor;
}

const run = <I, O>(actor: Actor, def: ActionDef<I, O>, input: unknown) => runAction(prisma(), actor, def, input, META);
const ask = <I, O>(actor: Actor, def: QueryDef<I, O>, input: unknown = {}) => runQuery(prisma(), actor, def, input);

const SETTINGS = {
  reservedSlugs: [] as string[],
  emailSenderName: 'Buzzify Core',
  defaults: { locales: ['en', 'ar', 'ckb'], defaultLocale: 'en', currency: 'IQD', timezone: 'Asia/Baghdad' },
};
const save = (actor: Actor, change: Record<string, unknown> = {}) => run(actor, settingsActions.updatePlatformSettings, { ...SETTINGS, ...change });

beforeAll(async () => {
  requireTestDb();
  vi.stubEnv('DATABASE_URL', databaseUrl(TEST_DB));
  await resetTestData(prisma());
});

beforeEach(async () => {
  await resetTestData(prisma());
  vi.spyOn(console, 'error').mockImplementation(() => undefined);
  atelier = await prisma().restaurant.create({ data: { name: 'Atelier', city: 'Erbil' }, select: { id: true } });
  admin = await person('admin', 'Sam Admin', [], true);
  designer = await person('dee', 'Dee Designer', [[atelier.id, 'DESIGNER']]);
});

afterEach(() => {
  vi.restoreAllMocks();
});

afterAll(async () => {
  await resetTestData(prisma());
  await prisma().$disconnect();
  delete globalForPrisma.__prisma;
  vi.unstubAllEnvs();
});

describe('reading the settings', () => {
  it('gives the built-in defaults when nothing is stored', async () => {
    expect(await getPlatformSettings(prisma())).toEqual({
      reservedSlugs: [],
      emailSenderName: 'Buzzify Core',
      defaults: { locales: ['en', 'ar', 'ckb'], defaultLocale: 'en', currency: 'IQD', timezone: 'Asia/Baghdad' },
    });
  });

  it('ignores a stored value that does not fit its key, key by key, and keeps the others', async () => {
    await prisma().platformSetting.createMany({
      data: [
        { key: 'reservedSlugs', value: 'not a list' },
        { key: 'emailSenderName', value: 'Menus Team' },
        // Each part of the defaults stands alone: the valid currency stays, the rest fall back.
        { key: 'defaults', value: { locales: ['xx'], defaultLocale: 7, currency: 'USD', timezone: 'Mars/Base' } },
        { key: 'unknownKey', value: { anything: true } },
      ],
    });
    expect(await getPlatformSettings(prisma())).toEqual({
      reservedSlugs: [],
      emailSenderName: 'Menus Team',
      defaults: { locales: ['en', 'ar', 'ckb'], defaultLocale: 'en', currency: 'USD', timezone: 'Asia/Baghdad' },
    });
  });

  it('reads a default language that is not among the languages as the first language', () => {
    const settings = readPlatformSettings([{ key: 'defaults', value: { locales: ['ar', 'ckb'], defaultLocale: 'en' } }]);
    expect(settings.defaults).toMatchObject({ locales: ['ar', 'ckb'], defaultLocale: 'ar' });
  });

  it('normalizes the stored reserved words as slugs are compared', async () => {
    await prisma().platformSetting.create({ data: { key: 'reservedSlugs', value: ['  Ritz ', 'CAFÉ Bar', 'ritz', '', 7, '---'] } });
    expect((await getPlatformSettings(prisma())).reservedSlugs).toEqual(['ritz', 'cafe-bar']);
    expect(await checkSlugAvailable(prisma(), 'ritz', null)).toBe('RESERVED');
    expect(await checkSlugAvailable(prisma(), 'cafe-bar', null)).toBe('RESERVED');
    expect(await checkSlugAvailable(prisma(), 'ritz-bar', null)).toBe('ok');
  });

  it('is the same as the defaults function when there are no rows', () => {
    expect(readPlatformSettings([])).toEqual(defaultPlatformSettings());
  });

  it('normalizes words like a typed slug', () => {
    expect(normalizeReservedSlugs(['  Ritz ', 'CAFÉ Bar', 'ritz', 'two  words', 'a_b', 'مطعم', ''])).toEqual(['ritz', 'cafe-bar', 'two-words', 'a-b']);
  });
});

describe('updatePlatformSettings', () => {
  it('saves what Settings sends and reads it back', async () => {
    const result = dataOf(
      await save(admin, {
        reservedSlugs: ['  Ritz ', 'CAFÉ Bar', 'ritz'],
        emailSenderName: ' Studio & Co ',
        defaults: { locales: ['ar', 'ckb'], defaultLocale: 'ckb', currency: 'USD', timezone: 'Europe/London' },
      }),
    );
    const expected = {
      reservedSlugs: ['ritz', 'cafe-bar'],
      emailSenderName: 'Studio & Co',
      defaults: { locales: ['ar', 'ckb'], defaultLocale: 'ckb', currency: 'USD', timezone: 'Europe/London' },
    };
    expect(result).toEqual({ settings: expected, changed: true });
    expect(await getPlatformSettings(prisma())).toEqual(expected);
    // The same through the page's query, for the Settings form.
    expect(dataOf(await ask(admin, settingsQueries.platformSettings)).settings).toEqual(expected);

    const rows = await prisma().platformSetting.findMany({ orderBy: { key: 'asc' } });
    expect(rows.map((row) => row.key)).toEqual(['defaults', 'emailSenderName', 'reservedSlugs']);
    expect(rows.every((row) => row.updatedById === admin.userId)).toBe(true);
  });

  it('audits what changed, before and after, and nothing for what stayed', async () => {
    dataOf(await save(admin, { reservedSlugs: ['ritz'] }));
    dataOf(await save(admin, { reservedSlugs: ['ritz', 'cafe-bar'], defaults: { ...SETTINGS.defaults, currency: 'USD' } }));

    const audits = await prisma().auditLog.findMany({ where: { action: 'settings.updated' }, orderBy: { occurredAt: 'asc' } });
    expect(audits).toHaveLength(2);
    expect(audits[1]).toMatchObject({ actorId: admin.userId, restaurantId: null, menuId: null, entityType: 'PlatformSetting', entityId: 'platform' });
    expect(audits[1]!.changes).toEqual({
      reservedSlugs: { before: ['ritz'], after: ['ritz', 'cafe-bar'] },
      'defaults.currency': { before: 'IQD', after: 'USD' },
    });
  });

  it('answers changed: false and writes no audit row when nothing differs', async () => {
    dataOf(await save(admin, { reservedSlugs: ['ritz'] }));
    expect(dataOf(await save(admin, { reservedSlugs: ['RITZ', ' ritz '] })).changed).toBe(false);
    expect(await prisma().auditLog.count({ where: { action: 'settings.updated' } })).toBe(1);
  });

  it('is for Super Admins only (platform.settings can never be granted)', async () => {
    expect(codeOf(await save(designer))).toBe('FORBIDDEN');
    expect(codeOf(await ask(designer, settingsQueries.platformSettings))).toBe('FORBIDDEN');
    expect(codeOf(await save(null as unknown as Actor))).toBe('UNAUTHENTICATED');
    expect(await prisma().platformSetting.count()).toBe(0);
  });

  it('refuses what is not a currency, a time zone, a language or a sender name, naming the field', async () => {
    const cases: Array<[Record<string, unknown>, string, string]> = [
      [{ defaults: { ...SETTINGS.defaults, currency: 'ZZZ' } }, 'defaults.currency', 'Choose one of the currencies offered'],
      [{ defaults: { ...SETTINGS.defaults, timezone: 'Mars/Base' } }, 'defaults.timezone', 'Choose one of the time zones offered'],
      [{ defaults: { ...SETTINGS.defaults, locales: [] } }, 'defaults.locales', 'Choose at least one language'],
      [{ defaults: { ...SETTINGS.defaults, locales: ['en', 'en'] } }, 'defaults.locales', 'Choose each language once'],
      [{ defaults: { ...SETTINGS.defaults, locales: ['ar'], defaultLocale: 'en' } }, 'defaults.defaultLocale', 'Choose the default language among the menu languages'],
      [{ emailSenderName: '   ' }, 'emailSenderName', 'Enter the sender name'],
      [{ emailSenderName: 'Evil <x@y.z>' }, 'emailSenderName', 'Use letters, digits, spaces and . & ( ) - only'],
      [{ emailSenderName: 'Line\r\nBcc: x' }, 'emailSenderName', 'Use letters, digits, spaces and . & ( ) - only'],
      [{ emailSenderName: 'x'.repeat(61) }, 'emailSenderName', 'Use at most 60 characters'],
      [{ reservedSlugs: ['مطعم'] }, 'reservedSlugs', 'Use lowercase letters, digits and single hyphens'],
      [{ reservedSlugs: ['a'.repeat(49)] }, 'reservedSlugs', 'Use at most 48 characters'],
    ];
    for (const [change, field, message] of cases) {
      const error = failureOf(await save(admin, change));
      expect(error.code, field).toBe('INVALID');
      expect(error.fields?.[field], field).toBe(message);
    }
    expect(await prisma().platformSetting.count()).toBe(0);
  });

  it('has a translation for every refusal it can make', () => {
    for (const text of [
      'Enter the sender name',
      'Use at most 60 characters',
      'Use letters, digits, spaces and . & ( ) - only',
      'Use lowercase letters, digits and single hyphens',
      'Use at most 48 characters',
      'Reserve at most 500 words',
    ]) {
      expect(SERVER_TEXT[text], text).toBeTruthy();
    }
  });

  it('refuses a reserved word that a menu already uses, as its address or a former one, naming the menu', async () => {
    const live = await createMenuFixture(prisma(), 'ritz');
    const renamed = await createMenuFixture(prisma(), 'old-name');
    dataOf(await run(admin, menus.changeMenuSlug, { menuId: renamed.menu.id, slug: 'new-name', version: renamed.menu.version }));

    for (const [word, menu] of [
      ['ritz', live.menu],
      ['old-name', renamed.menu],
    ] as const) {
      const error = failureOf(await save(admin, { reservedSlugs: [word] }));
      expect(error.code, word).toBe('INVALID');
      expect(error.fields, word).toMatchObject({ inUseWord: word, inUseMenu: menu.name });
      expect(error.fields?.reservedSlugs, word).toContain(menu.name);
    }
    expect(await getPlatformSettings(prisma())).toEqual(defaultPlatformSettings());

    // The address of a deleted menu is a tombstone, which nobody uses: it may be reserved.
    await prisma().menuSlug.create({ data: { slug: 'gone-menu', menuId: null } });
    expect(dataOf(await save(admin, { reservedSlugs: ['gone-menu'] })).changed).toBe(true);
  });

  it('does not refuse a word that was reserved before, so other settings can still be saved', async () => {
    await createMenuFixture(prisma(), 'legacy');
    // Reserved by hand after the menu took it (the platform never lets that happen through Settings).
    await prisma().platformSetting.create({ data: { key: 'reservedSlugs', value: ['legacy'] } });
    expect(dataOf(await save(admin, { reservedSlugs: ['legacy'], emailSenderName: 'Studio Team' })).changed).toBe(true);
    expect(dataOf(await save(admin, { reservedSlugs: ['legacy', 'ritz'], emailSenderName: 'Studio Team' })).settings.reservedSlugs).toEqual(['legacy', 'ritz']);
  });
});

describe('a reserved word', () => {
  const NEW_MENU = { name: 'Dinner', numeralSystem: 'LATN' };

  it('blocks createMenu, changeMenuSlug and duplicateMenu, and the slug check', async () => {
    const own = await createMenuFixture(prisma(), 'atelier-own');
    await prisma().menu.update({ where: { id: own.menu.id }, data: { restaurantId: atelier.id } });
    dataOf(await save(admin, { reservedSlugs: ['ritz', 'cafe-bar'] }));

    const created = await run(admin, menus.createMenu, { restaurantId: atelier.id, slug: 'ritz', ...NEW_MENU });
    expect(failureOf(created)).toMatchObject({ code: 'INVALID', fields: { slug: 'This address is reserved' } });
    expect(await prisma().menu.count({ where: { slug: 'ritz' } })).toBe(0);

    const changed = await run(admin, menus.changeMenuSlug, { menuId: own.menu.id, slug: 'cafe-bar', version: own.menu.version });
    expect(failureOf(changed)).toMatchObject({ code: 'INVALID', fields: { slug: 'This address is reserved' } });

    const copied = await run(admin, menus.duplicateMenu, { menuId: own.menu.id, name: 'Copy', slug: 'ritz' });
    expect(failureOf(copied)).toMatchObject({ code: 'INVALID', fields: { slug: 'This address is reserved' } });

    expect(await checkSlugAvailable(prisma(), 'ritz', null)).toBe('RESERVED');
    expect(dataOf(await ask(admin, menuQueries.slugAvailability, { slug: 'ritz' }))).toEqual({ slug: 'ritz', status: 'RESERVED' });

    // Unreserving it frees the word again.
    dataOf(await save(admin, { reservedSlugs: ['cafe-bar'] }));
    expect(dataOf(await run(admin, menus.createMenu, { restaurantId: atelier.id, slug: 'ritz', ...NEW_MENU })).menuId).toBeTruthy();
  });
});

describe('createMenu with the platform defaults', () => {
  const MINIMAL = { name: 'Dinner' };

  it('uses the platform defaults for a menu form that leaves languages, currency and time zone out', async () => {
    dataOf(
      await save(admin, { defaults: { locales: ['ar', 'ckb'], defaultLocale: 'ckb', currency: 'USD', timezone: 'Europe/London' } }),
    );
    const { menuId } = dataOf(await run(designer, menus.createMenu, { restaurantId: atelier.id, slug: 'defaults-menu', ...MINIMAL }));
    const row = await prisma().menu.findUniqueOrThrow({ where: { id: menuId } });
    expect(row).toMatchObject({ locales: ['ar', 'ckb'], defaultLocale: 'ckb', currency: 'USD', timezone: 'Europe/London', numeralSystem: 'LATN' });
  });

  it('keeps what the form sends over the defaults, and picks a default language that fits', async () => {
    dataOf(await save(admin, { defaults: { ...SETTINGS.defaults, currency: 'USD' } }));
    const sent = dataOf(await run(designer, menus.createMenu, { restaurantId: atelier.id, slug: 'sent-menu', ...MINIMAL, currency: 'EUR', locales: ['ar'] }));
    expect(await prisma().menu.findUniqueOrThrow({ where: { id: sent.menuId } })).toMatchObject({
      locales: ['ar'],
      // The platform's default language (English) is not one of this menu's languages.
      defaultLocale: 'ar',
      currency: 'EUR',
      timezone: 'Asia/Baghdad',
    });
  });

  it('still refuses a default language that is not among the languages it was sent with', async () => {
    const error = failureOf(await run(designer, menus.createMenu, { restaurantId: atelier.id, slug: 'bad-default', ...MINIMAL, locales: ['ar'], defaultLocale: 'en' }));
    expect(error).toMatchObject({ code: 'INVALID', fields: { defaultLocale: 'Choose the default language among the menu languages' } });
  });

  it('offers the platform defaults to the New menu form', async () => {
    dataOf(await save(admin, { defaults: { ...SETTINGS.defaults, currency: 'USD', timezone: 'Asia/Dubai' } }));
    const options = dataOf(await ask(designer, menuQueries.newMenuOptions));
    expect(options.defaults).toMatchObject({ locales: ['en', 'ar', 'ckb'], defaultLocale: 'en', currency: 'USD', timezone: 'Asia/Dubai', numeralSystem: 'LATN' });
  });
});

describe('the email sender name', () => {
  const to = { email: 'someone@example.com', name: 'Someone', locale: 'en' };

  it('is the platform setting, passed to every account email', async () => {
    dataOf(await save(admin, { emailSenderName: 'Studio Team' }));
    sendAfterResponse(to, 'emailChanged', { newEmail: 'new@example.com' });
    await vi.waitFor(() => expect(sendEmail).toHaveBeenCalledTimes(1));
    expect(vi.mocked(sendEmail).mock.calls[0]![1]).toEqual({ senderName: 'Studio Team' });
    expect(vi.mocked(sendEmail).mock.calls[0]![0]).toMatchObject({ to: 'someone@example.com' });
  });

  it('is the built-in name while the setting is unchanged', async () => {
    vi.mocked(sendEmail).mockClear();
    sendAfterResponse(to, 'emailChanged', { newEmail: 'new@example.com' });
    await vi.waitFor(() => expect(sendEmail).toHaveBeenCalledTimes(1));
    expect(vi.mocked(sendEmail).mock.calls[0]![1]).toEqual({ senderName: 'Buzzify Core' });
  });
});
