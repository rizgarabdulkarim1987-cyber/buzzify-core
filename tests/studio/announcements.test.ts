import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { pickAnnouncement } from '@/lib/announcements';
import { archiveAnnouncement, createAnnouncement, updateAnnouncement } from '@/server/studio/actions/announcements';
import { activeAnnouncements, listAnnouncements } from '@/server/studio/queries/announcements';
import { ask, codeOf, dataOf, failureOf, person, prisma, resetWorld, restaurant, run, useTestDatabase, type Person } from '../pos/fixture';

vi.mock('next/headers', () => ({ headers: vi.fn(), cookies: vi.fn() }));
const globalForPrisma = globalThis as unknown as { __prisma?: unknown };

let admin: Person;
let owner: Person;
let cashier: Person;
let cook: Person;

const HOUR = 3_600_000;
const both = { titles: { en: 'Maintenance', ar: 'صيانة' }, bodies: { en: 'Tonight at 2am', ar: 'الليلة الساعة 2' } };

beforeAll(() => {
  useTestDatabase();
});

beforeEach(async () => {
  await resetWorld();
  const r = await restaurant('Announce A');
  admin = await person('admin', { superAdmin: true });
  owner = await person('owner', { membership: [r.id, 'OWNER'] });
  cashier = await person('cashier', { staff: [r.id, 'CASHIER'] });
  cook = await person('cook', { staff: [r.id, 'KITCHEN'] });
});

afterAll(async () => {
  await prisma().$disconnect();
  delete globalForPrisma.__prisma;
  vi.unstubAllEnvs();
});

describe('pickAnnouncement', () => {
  it('takes the viewer language, else the first language that has both title and body', () => {
    const titles = { en: 'Hello', ar: 'مرحبا' };
    const bodies = { en: 'Body', ar: 'نص' };
    expect(pickAnnouncement(titles, bodies, 'ar')).toEqual({ title: 'مرحبا', body: 'نص' });
    expect(pickAnnouncement({ ar: 'مرحبا' }, { ar: 'نص' }, 'en')).toEqual({ title: 'مرحبا', body: 'نص' });
  });
  it('never mixes languages, and hides one with no language that has both', () => {
    expect(pickAnnouncement({ en: 'Title' }, { ar: 'نص' }, 'en')).toBeNull();
    expect(pickAnnouncement({ en: '  ' }, { en: 'x' }, 'en')).toBeNull();
    expect(pickAnnouncement(null, null, 'en')).toBeNull();
  });
});

describe('writing announcements', () => {
  it('lets a Super Admin create one', async () => {
    const created = dataOf(await run(admin, createAnnouncement, both));
    expect(created.id).toBeTruthy();
    expect(await prisma().announcement.count()).toBe(1);
  });

  it('refuses an owner, a cashier and a cook', async () => {
    for (const who of [owner, cashier, cook]) {
      expect(codeOf(await run(who, createAnnouncement, both))).toBe('FORBIDDEN');
    }
    expect(await prisma().announcement.count()).toBe(0);
  });

  it('needs a title and a body in at least one language', async () => {
    const error = failureOf(await run(admin, createAnnouncement, { titles: { en: 'Only title' }, bodies: {} }));
    expect(error.code).toBe('INVALID');
  });

  it('refuses an end before the start', async () => {
    const now = Date.now();
    const error = failureOf(await run(admin, createAnnouncement, { ...both, startsAt: new Date(now + HOUR).toISOString(), endsAt: new Date(now).toISOString() }));
    expect(error.code).toBe('INVALID');
  });

  it('updates and archives, and audits each', async () => {
    const { id } = dataOf(await run(admin, createAnnouncement, both));
    dataOf(await run(admin, updateAnnouncement, { id, ...both, titles: { en: 'Changed' } }));
    expect((await prisma().announcement.findUniqueOrThrow({ where: { id } })).titles).toEqual({ en: 'Changed' });
    dataOf(await run(admin, archiveAnnouncement, { id }));
    expect((await prisma().announcement.findUniqueOrThrow({ where: { id } })).archivedAt).not.toBeNull();
    expect(await prisma().auditLog.count({ where: { action: { startsWith: 'announcement.' } } })).toBe(3);
  });
});

describe('reading announcements', () => {
  it('shows the active ones to a cashier and a cook, in their own language', async () => {
    dataOf(await run(admin, createAnnouncement, both));
    for (const who of [cashier, cook, owner]) {
      const list = dataOf(await ask(who, activeAnnouncements, {}));
      expect(list).toHaveLength(1);
      expect(list[0]).toMatchObject({ title: 'Maintenance', body: 'Tonight at 2am' });
    }
  });

  it('reaches an English reader when it was written only in Arabic', async () => {
    dataOf(await run(admin, createAnnouncement, { titles: { ar: 'صيانة' }, bodies: { ar: 'الليلة' } }));
    expect(dataOf(await ask(cashier, activeAnnouncements, {}))[0]).toMatchObject({ title: 'صيانة', body: 'الليلة' });
  });

  it('hides future, expired and archived ones', async () => {
    const now = Date.now();
    dataOf(await run(admin, createAnnouncement, { ...both, startsAt: new Date(now + HOUR).toISOString() }));
    dataOf(await run(admin, createAnnouncement, { ...both, startsAt: new Date(now - 2 * HOUR).toISOString(), endsAt: new Date(now - HOUR).toISOString() }));
    const gone = dataOf(await run(admin, createAnnouncement, both));
    dataOf(await run(admin, archiveAnnouncement, { id: gone.id }));
    expect(dataOf(await ask(cashier, activeAnnouncements, {}))).toHaveLength(0);
  });

  it('lists everything to a Super Admin only', async () => {
    dataOf(await run(admin, createAnnouncement, both));
    expect(dataOf(await ask(admin, listAnnouncements, {}))).toHaveLength(1);
    expect(codeOf(await ask(cashier, listAnnouncements, {}))).toBe('FORBIDDEN');
  });
});
