import { readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { LOCALES } from '@/lib/locale';
import { getPrisma } from '@/server/data/prisma';
import { AUDIT_ACTIONS, AUDIT_ENTITY_TYPES } from '@/server/domain/audit-actions';
import { loadActor, type Actor } from '@/server/studio/auth/actor';
import { runQuery, type QueryDef } from '@/server/studio/framework/query';
import type { ActionResult } from '@/server/studio/framework/result';
import * as activityQueries from '@/server/studio/queries/activity';
import { STUDIO_MESSAGES } from '@/studio/messages';
import { databaseUrl, TEST_DB } from '../../scripts/db-config';
import { createMenuFixture, requireTestDb, resetTestData } from '../helpers/db';

const globalForPrisma = globalThis as unknown as { __prisma?: unknown };
const prisma = () => getPrisma();

const dataOf = <T>(result: ActionResult<T>): T => {
  if (!result.ok) throw new Error(`expected success, got ${JSON.stringify(result.error)}`);
  return result.data;
};
const codeOf = (result: ActionResult<unknown>) => (result.ok ? 'OK' : result.error.code);

let admin: Actor;
let designer: Actor;
let owner: Actor;
let atelier: { id: string };
let bistro: { id: string };
let atelierMenu: { id: string; name: string };
let bistroMenu: { id: string; name: string };

async function person(id: string, name: string, memberships: Array<[string, 'DESIGNER' | 'OWNER']> = [], superAdmin = false): Promise<Actor> {
  await prisma().user.create({ data: { id, name, email: `${id}@example.com`, isSuperAdmin: superAdmin, twoFactorEnabled: superAdmin } });
  for (const [restaurantId, role] of memberships) await prisma().membership.create({ data: { userId: id, restaurantId, role } });
  return (await loadActor(prisma(), id)) as Actor;
}

const ask = <I, O>(actor: Actor, def: QueryDef<I, O>, input: unknown = {}) => runQuery(prisma(), actor, def, input);
const list = async (actor: Actor, input: Record<string, unknown> = {}) => dataOf(await ask(actor, activityQueries.listActivity, input));

async function menuIn(restaurantId: string, slug: string) {
  const fixture = await createMenuFixture(prisma(), slug, { publish: false });
  await prisma().menu.update({ where: { id: fixture.menu.id }, data: { restaurantId } });
  await prisma().restaurant.delete({ where: { id: fixture.restaurant.id } });
  return { id: fixture.menu.id, name: fixture.menu.name };
}

interface Entry {
  actorId?: string | null;
  restaurantId?: string | null;
  menuId?: string | null;
  action?: string;
  entityType?: string;
  entityId?: string;
  at: Date;
  changes?: object;
}

async function log(entries: Entry[]) {
  await prisma().auditLog.createMany({
    data: entries.map((entry) => ({
      actorId: entry.actorId ?? null,
      restaurantId: entry.restaurantId ?? null,
      menuId: entry.menuId ?? null,
      action: entry.action ?? 'menu.published',
      entityType: entry.entityType ?? 'Menu',
      entityId: entry.entityId ?? entry.menuId ?? 'x',
      occurredAt: entry.at,
      changes: entry.changes ?? {},
    })),
  });
}

/** Studio time is UTC+3: this local time in Baghdad as an instant. */
const baghdad = (date: string, time: string) => new Date(`${date}T${time}+03:00`);

beforeAll(async () => {
  requireTestDb();
  vi.stubEnv('DATABASE_URL', databaseUrl(TEST_DB));
  await resetTestData(prisma());
});

beforeEach(async () => {
  await resetTestData(prisma());
  vi.spyOn(console, 'error').mockImplementation(() => undefined);
  atelier = await prisma().restaurant.create({ data: { name: 'Atelier' } });
  bistro = await prisma().restaurant.create({ data: { name: 'Bistro' } });
  atelierMenu = await menuIn(atelier.id, 'act-atelier');
  bistroMenu = await menuIn(bistro.id, 'act-bistro');
  admin = await person('admin', 'Sam Admin', [], true);
  designer = await person('dee', 'Dee Designer', [[atelier.id, 'DESIGNER']]);
  owner = await person('olive', 'Olive Owner', [[atelier.id, 'OWNER']]);
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

describe('listActivity', () => {
  it('is for those who may read the audit log: not designers, not owners, not the signed-out', async () => {
    expect(codeOf(await ask(designer, activityQueries.listActivity))).toBe('FORBIDDEN');
    expect(codeOf(await ask(owner, activityQueries.listActivity))).toBe('FORBIDDEN');
    expect(codeOf(await runQuery(prisma(), null, activityQueries.listActivity, {}))).toBe('UNAUTHENTICATED');
    // Not even a client policy that tries to grant it.
    await prisma().restaurant.update({ where: { id: atelier.id }, data: { permissionPolicy: { DESIGNER: { grant: ['audit.view'], revoke: [] } } } });
    expect(codeOf(await ask(designer, activityQueries.listActivity))).toBe('FORBIDDEN');
    expect(codeOf(await ask(admin, activityQueries.listActivity))).toBe('OK');
  });

  it('shows the actor, the action, the entity, the restaurant, the menu and the time, newest first', async () => {
    await log([
      { actorId: admin.userId, restaurantId: atelier.id, menuId: atelierMenu.id, action: 'menu.published', at: new Date('2026-05-02T10:00:00Z') },
      { actorId: designer.userId, restaurantId: atelier.id, action: 'membership.assigned', entityType: 'User', entityId: owner.userId, at: new Date('2026-05-03T10:00:00Z') },
      { actorId: null, restaurantId: null, action: 'settings.updated', entityType: 'PlatformSetting', entityId: 'platform', at: new Date('2026-05-04T10:00:00Z') },
    ]);
    const page = await list(admin);
    expect(page).toMatchObject({ total: 3, page: 1, pageSize: 50 });
    expect(page.rows.map((row) => row.action)).toEqual(['settings.updated', 'membership.assigned', 'menu.published']);
    expect(page.rows[0]).toMatchObject({
      actor: null,
      restaurant: null,
      menu: null,
      entityType: 'PlatformSetting',
      entityId: 'platform',
      entityName: null,
      occurredAt: '2026-05-04T10:00:00.000Z',
    });
    expect(page.rows[1]).toMatchObject({
      actor: { id: designer.userId, name: 'Dee Designer' },
      restaurant: { id: atelier.id, name: 'Atelier' },
      menu: null,
      entityType: 'User',
      entityName: 'Olive Owner',
    });
    expect(page.rows[2]).toMatchObject({
      actor: { id: admin.userId, name: 'Sam Admin' },
      restaurant: { id: atelier.id, name: 'Atelier' },
      menu: { id: atelierMenu.id, name: atelierMenu.name },
    });
  });

  it('keeps a row whose restaurant, menu or person is gone, with no name for them', async () => {
    await log([{ actorId: 'ghost', restaurantId: 'gone-restaurant', menuId: 'gone-menu', action: 'menu.deleted', entityId: 'gone-menu', at: new Date('2026-05-02T10:00:00Z') }]);
    expect((await list(admin)).rows[0]).toMatchObject({
      actor: { id: 'ghost', name: null },
      restaurant: { id: 'gone-restaurant', name: null },
      menu: { id: 'gone-menu', name: null },
    });
  });

  it('filters by actor, restaurant, menu, action and date range, alone and together', async () => {
    await log([
      { actorId: admin.userId, restaurantId: atelier.id, menuId: atelierMenu.id, action: 'menu.published', at: baghdad('2026-05-01', '09:00') },
      { actorId: admin.userId, restaurantId: bistro.id, menuId: bistroMenu.id, action: 'menu.status_changed', at: baghdad('2026-05-02', '12:00') },
      { actorId: designer.userId, restaurantId: atelier.id, menuId: atelierMenu.id, action: 'menu.status_changed', at: baghdad('2026-05-03', '23:59') },
      { actorId: designer.userId, restaurantId: atelier.id, action: 'restaurant.updated', entityType: 'Restaurant', entityId: atelier.id, at: baghdad('2026-05-04', '00:00') },
    ]);
    const actions = async (filters: Record<string, unknown>) => (await list(admin, filters)).rows.map((row) => row.action).sort();

    expect(await actions({ actorId: designer.userId })).toEqual(['menu.status_changed', 'restaurant.updated']);
    expect(await actions({ restaurantId: bistro.id })).toEqual(['menu.status_changed']);
    expect(await actions({ menuId: atelierMenu.id })).toEqual(['menu.published', 'menu.status_changed']);
    expect(await actions({ action: 'menu.status_changed' })).toEqual(['menu.status_changed', 'menu.status_changed']);
    // Both ends of the range are whole days in Studio time (UTC+3): 23:59 on the 3rd is in, 00:00 on the 4th is not.
    expect(await actions({ from: '2026-05-02', to: '2026-05-03' })).toEqual(['menu.status_changed', 'menu.status_changed']);
    expect(await actions({ from: '2026-05-04' })).toEqual(['restaurant.updated']);
    expect(await actions({ to: '2026-05-01' })).toEqual(['menu.published']);
    expect(await actions({ actorId: designer.userId, menuId: atelierMenu.id, action: 'menu.status_changed', from: '2026-05-03', to: '2026-05-03' })).toEqual([
      'menu.status_changed',
    ]);
    expect(await actions({ actorId: admin.userId, restaurantId: atelier.id, action: 'restaurant.updated' })).toEqual([]);
    expect((await list(admin, { actorId: designer.userId, from: '2026-05-01', to: '2026-05-03' })).total).toBe(1);
  });

  it('names what the filters hold, so the page can show them', async () => {
    const page = await list(admin, { actorId: admin.userId, restaurantId: atelier.id, menuId: atelierMenu.id });
    expect(page.selected).toEqual({
      actor: { id: admin.userId, name: 'Sam Admin' },
      restaurant: { id: atelier.id, name: 'Atelier' },
      menu: { id: atelierMenu.id, name: atelierMenu.name },
    });
    expect((await list(admin)).selected).toEqual({ actor: null, restaurant: null, menu: null });
    expect((await list(admin, { actorId: 'missing' })).selected.actor).toEqual({ id: 'missing', name: null });
  });

  it('pages by 50, newest first, without repeating or skipping a row at a boundary', async () => {
    const at = new Date('2026-05-01T00:00:00Z');
    // 120 rows, 40 of them in one second: the id breaks the tie.
    await log(
      Array.from({ length: 120 }, (_, i) => ({
        actorId: admin.userId,
        restaurantId: atelier.id,
        action: 'restaurant.updated',
        entityType: 'Restaurant',
        entityId: `row-${i}`,
        at: new Date(at.getTime() + Math.floor(i / 40) * 1000),
      })),
    );
    const seen = new Set<string>();
    for (const [page, expected] of [[1, 50], [2, 50], [3, 20], [4, 0]] as const) {
      const result = await list(admin, { page });
      expect(result).toMatchObject({ total: 120, page, pageSize: 50 });
      expect(result.rows, `page ${page}`).toHaveLength(expected);
      for (const row of result.rows) seen.add(row.id);
    }
    expect(seen.size).toBe(120);
    expect(codeOf(await ask(admin, activityQueries.listActivity, { page: 0 }))).toBe('INVALID');
    expect(codeOf(await ask(admin, activityQueries.listActivity, { pageSize: 500 }))).toBe('OK');
    expect((await list(admin, { pageSize: 500 })).pageSize).toBe(50);
  });

  it('never gives what a change held: no `changes` on a row, not even a secret in one', async () => {
    await log([
      {
        actorId: admin.userId,
        restaurantId: atelier.id,
        action: 'restaurant.updated',
        entityType: 'Restaurant',
        entityId: atelier.id,
        at: new Date('2026-05-02T10:00:00Z'),
        changes: { notes: { before: 'secret-before', after: 'secret-after' } },
      },
    ]);
    const page = await list(admin);
    expect(page.rows[0]).not.toHaveProperty('changes');
    expect(JSON.stringify(page)).not.toContain('secret-');
  });

  it('refuses a filter that is not an action the Studio writes or a calendar day', async () => {
    expect(codeOf(await ask(admin, activityQueries.listActivity, { action: 'drop.table' }))).toBe('INVALID');
    expect(codeOf(await ask(admin, activityQueries.listActivity, { from: '2026-13-40' }))).toBe('INVALID');
    expect(codeOf(await ask(admin, activityQueries.listActivity, { to: 'yesterday' }))).toBe('INVALID');
  });
});

describe('the audit action labels', () => {
  /** Every `.ts` file under a folder, recursively. */
  function sources(dir: string): string[] {
    return readdirSync(dir).flatMap((name) => {
      const file = path.join(dir, name);
      return statSync(file).isDirectory() ? sources(file) : file.endsWith('.ts') || file.endsWith('.tsx') ? [file] : [];
    });
  }

  it('lists every action name the Studio code writes', () => {
    const written = new Set<string>();
    for (const file of sources(path.join(process.cwd(), 'src', 'server', 'studio'))) {
      for (const match of readFileSync(file, 'utf8').matchAll(/\baction: '([a-z_]+\.[a-z_]+)'/g)) written.add(match[1]!);
    }
    expect(written.size).toBeGreaterThan(30);
    expect([...written].filter((name) => !(AUDIT_ACTIONS as readonly string[]).includes(name))).toEqual([]);
    expect(new Set(AUDIT_ACTIONS).size).toBe(AUDIT_ACTIONS.length);
  });

  it('has a label for every action and every kind of entity, in every language', () => {
    for (const locale of LOCALES) {
      const missing = [
        ...AUDIT_ACTIONS.filter((name) => !STUDIO_MESSAGES[locale][`activity.action.${name}`]).map((name) => `activity.action.${name}`),
        ...AUDIT_ENTITY_TYPES.filter((type) => !STUDIO_MESSAGES[locale][`activity.entity.${type}`]).map((type) => `activity.entity.${type}`),
      ];
      expect(missing, locale).toEqual([]);
    }
  });
});
