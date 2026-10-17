import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { strFromU8, unzipSync } from 'fflate';
import sharp from 'sharp';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { recordEvents } from '@/server/data/events';
import { getPrisma } from '@/server/data/prisma';
import { resolvePublicMenu } from '@/server/data/public-menu';
import { getStorage } from '@/server/storage/storage';
import * as menus from '@/server/studio/actions/menus';
import * as qr from '@/server/studio/actions/qr';
import { loadActor, type Actor } from '@/server/studio/auth/actor';
import { runAction, type ActionDef } from '@/server/studio/framework/action';
import { runQuery } from '@/server/studio/framework/query';
import type { ActionResult } from '@/server/studio/framework/result';
import * as qrQueries from '@/server/studio/queries/qr';
import { databaseUrl, TEST_DB } from '../../scripts/db-config';
import { createMenuFixture, requireTestDb, resetTestData } from '../helpers/db';

const prisma = () => getPrisma();
const META = { ip: '203.0.113.7', userAgent: 'vitest' };
const ORIGIN = 'https://menu.example.test';

const dataOf = <T>(result: ActionResult<T>): T => {
  if (!result.ok) throw new Error(`expected success, got ${JSON.stringify(result.error)}`);
  return result.data;
};
const failureOf = (result: ActionResult<unknown>) => {
  if (result.ok) throw new Error(`expected a failure, got ${JSON.stringify(result.data)}`);
  return result.error;
};

let dir: string;
let a: Awaited<ReturnType<typeof createMenuFixture>>;
let designer: Actor;

const run = <I, O>(def: ActionDef<I, O>, input: unknown) => runAction(prisma(), designer, def, input, META);
const list = async () => dataOf(await runQuery(prisma(), designer, qrQueries.list, { menuId: a.menu.id })).codes;

/** The file behind a development download link: the key sits between the public prefix and the query. */
async function downloaded(url: string): Promise<Uint8Array> {
  const key = decodeURIComponent(new URL(url, 'http://localhost').pathname.replace(/^\/api\/dev-media\//, ''));
  const file = await getStorage().get(key, 50_000_000);
  if (!file) throw new Error(`nothing stored at ${key}`);
  return file.bytes;
}

beforeAll(() => {
  requireTestDb();
  vi.stubEnv('DATABASE_URL', databaseUrl(TEST_DB));
  vi.stubEnv('PUBLIC_MENU_ORIGIN', ORIGIN);
  dir = mkdtempSync(join(tmpdir(), 'buzzify-qr-'));
  vi.stubEnv('MEDIA_LOCAL_DIR', dir);
  vi.stubEnv('MEDIA_PUBLIC_URL', '/api/dev-media');
});

beforeEach(async () => {
  await resetTestData(prisma());
  vi.spyOn(console, 'error').mockImplementation(() => undefined);
  a = await createMenuFixture(prisma(), 'qr-a');
  await prisma().user.create({ data: { id: 'designer-a', name: 'Alpha Designer', email: 'designer-a@example.com' } });
  await prisma().membership.create({ data: { userId: 'designer-a', restaurantId: a.restaurant.id, role: 'DESIGNER' } });
  designer = (await loadActor(prisma(), 'designer-a')) as Actor;
});

afterAll(async () => {
  await resetTestData(prisma());
  rmSync(dir, { recursive: true, force: true });
});

describe('QR codes', () => {
  it('makes a code for the menu and one for a table, with the table row, and audits them', async () => {
    const menuCode = dataOf(await run(qr.create, { menuId: a.menu.id, label: 'Window poster' }));
    const tableCode = dataOf(await run(qr.create, { menuId: a.menu.id, label: 'Patio 7', tableNumber: 7 }));
    expect(await prisma().table.findFirstOrThrow({ where: { menuId: a.menu.id, number: 7 } })).toMatchObject({ label: 'Table 7' });
    const codes = await list();
    expect(codes.find((code) => code.id === menuCode.id)).toMatchObject({ label: 'Window poster', tableNumber: null, url: `${ORIGIN}/qr-a?qr=${menuCode.id}`, scans30d: 0 });
    expect(codes.find((code) => code.id === tableCode.id)).toMatchObject({ tableNumber: 7, url: `${ORIGIN}/qr-a/t/7?qr=${tableCode.id}` });
    expect(codes[0]!.svg).toMatch(/^<svg /);
    expect(await prisma().auditLog.count({ where: { action: 'qr.created', entityType: 'QrCode' } })).toBe(2);
  });

  it('names new tables and their codes in the language of the person who makes them', async () => {
    await prisma().user.update({ where: { id: 'designer-a' }, data: { locale: 'ar' } });
    designer = (await loadActor(prisma(), 'designer-a')) as Actor;
    dataOf(await run(qr.createForTables, { menuId: a.menu.id, from: 3, to: 3 }));
    expect((await list())[0]!.label).toBe('الطاولة 3');
    expect(await prisma().table.findFirstOrThrow({ where: { menuId: a.menu.id, number: 3 } })).toMatchObject({ label: 'الطاولة 3' });
  });

  it('refuses a second code for the same table', async () => {
    dataOf(await run(qr.create, { menuId: a.menu.id, label: 'Patio 7', tableNumber: 7 }));
    expect(failureOf(await run(qr.create, { menuId: a.menu.id, label: 'Again', tableNumber: 7 })).code).toBe('INVALID');
  });

  it('makes codes for tables 1 to 5, creating the tables, and skips them the second time', async () => {
    expect(dataOf(await run(qr.createForTables, { menuId: a.menu.id, from: 1, to: 5 }))).toEqual({ created: 5, skipped: 0 });
    expect(await prisma().table.count({ where: { menuId: a.menu.id } })).toBe(5);
    expect(dataOf(await run(qr.createForTables, { menuId: a.menu.id, from: 3, to: 7 }))).toEqual({ created: 2, skipped: 3 });
    expect((await list()).map((code) => code.tableNumber)).toEqual([1, 2, 3, 4, 5, 6, 7]);
    expect(failureOf(await run(qr.createForTables, { menuId: a.menu.id, from: 1, to: 300 })).code).toBe('INVALID');
    expect(failureOf(await run(qr.createForTables, { menuId: a.menu.id, from: 5, to: 1 })).code).toBe('INVALID');
  });

  it('saves a style, refuses one scanners may not read, and refuses a stale save', async () => {
    const code = dataOf(await run(qr.create, { menuId: a.menu.id, label: 'Door' }));
    const style = { foreground: '#1B1A19', background: '#F7F5F1', logo: false, frameText: 'Scan for the menu' };
    expect(dataOf(await run(qr.update, { menuId: a.menu.id, qrCodeId: code.id, version: 1, label: 'Front door', style }))).toEqual({ version: 2 });
    expect((await list())[0]).toMatchObject({ label: 'Front door', style, version: 2 });
    const unreadable = failureOf(await run(qr.update, { menuId: a.menu.id, qrCodeId: code.id, version: 2, label: 'Door', style: { ...style, foreground: '#C8C4BC' } }));
    expect(unreadable).toMatchObject({ code: 'INVALID', fields: { style: expect.any(String) } });
    expect(failureOf(await run(qr.update, { menuId: a.menu.id, qrCodeId: code.id, version: 1, label: 'Door', style })).code).toBe('CONFLICT');
    expect(await prisma().auditLog.findFirstOrThrow({ where: { action: 'qr.updated' } })).toMatchObject({ entityId: code.id });
  });

  it('previews a style before it is saved', async () => {
    const code = dataOf(await run(qr.create, { menuId: a.menu.id, label: 'Door' }));
    const style = { foreground: '#1B1A19', background: '#F7F5F1', logo: false, frameText: 'Scan me' };
    const { svg } = dataOf(await runQuery(prisma(), designer, qrQueries.preview, { menuId: a.menu.id, qrCodeId: code.id, style }));
    expect(svg).toContain('fill="#1B1A19"');
    expect(svg).toContain('fill="#F7F5F1"');
    expect(svg).not.toContain('<text');
    expect((await list())[0]!.style.foreground).toBe('#000000');
  });

  it('gives every code of the menu the look of one', async () => {
    const source = dataOf(await run(qr.create, { menuId: a.menu.id, label: 'Door' }));
    dataOf(await run(qr.createForTables, { menuId: a.menu.id, from: 1, to: 2 }));
    const style = { foreground: '#1B1A19', background: '#F7F5F1', logo: true, frameText: 'Scan for the menu' };
    dataOf(await run(qr.update, { menuId: a.menu.id, qrCodeId: source.id, version: 1, label: 'Door', style }));
    expect(dataOf(await run(qr.applyStyle, { menuId: a.menu.id, qrCodeId: source.id }))).toEqual({ updated: 2 });
    const codes = await list();
    expect(codes.map((code) => code.style)).toEqual([style, style, style]);
    expect(codes.filter((code) => code.id !== source.id).map((code) => code.version)).toEqual([2, 2]);
    expect(await prisma().auditLog.count({ where: { action: 'qr.updated' } })).toBe(3);
  });

  it('deletes a code', async () => {
    const code = dataOf(await run(qr.create, { menuId: a.menu.id, label: 'Door' }));
    dataOf(await run(qr.remove, { menuId: a.menu.id, qrCodeId: code.id }));
    expect(await list()).toEqual([]);
    expect(await prisma().auditLog.count({ where: { action: 'qr.deleted', entityId: code.id } })).toBe(1);
  });

  it('downloads a code as SVG and as a PNG of the asked size', async () => {
    const code = dataOf(await run(qr.create, { menuId: a.menu.id, label: 'Door', tableNumber: 3 }));
    const png = dataOf(await run(qr.download, { menuId: a.menu.id, qrCodeId: code.id, format: 'png', size: 1024 }));
    expect((await sharp(Buffer.from(await downloaded(png.url))).metadata()).width).toBe(1024);
    const svg = dataOf(await run(qr.download, { menuId: a.menu.id, qrCodeId: code.id, format: 'svg' }));
    expect(new URL(svg.url, 'http://localhost').searchParams.get('name')).toBe('qr-a-table-3.svg');
    expect(new TextDecoder().decode(await downloaded(svg.url))).toMatch(/^<svg /);
  });

  it('zips every table code with an index', async () => {
    dataOf(await run(qr.createForTables, { menuId: a.menu.id, from: 1, to: 2 }));
    dataOf(await run(qr.create, { menuId: a.menu.id, label: 'Poster' }));
    const zip = dataOf(await run(qr.downloadTables, { menuId: a.menu.id }));
    const files = unzipSync(await downloaded(zip.url));
    expect(Object.keys(files).sort()).toEqual(['codes.csv', 'qr-a-table-1.png', 'qr-a-table-1.svg', 'qr-a-table-2.png', 'qr-a-table-2.svg']);
    expect(strFromU8(files['codes.csv']!)).toContain(`${ORIGIN}/qr-a/t/2?qr=`);
    expect(failureOf(await run(qr.downloadTables, { menuId: (await createMenuFixture(prisma(), 'qr-empty')).menu.id })).code).toBe('NOT_FOUND');
  });

  it('counts scans with the code’s id, and keeps no code of another menu', async () => {
    const code = dataOf(await run(qr.create, { menuId: a.menu.id, label: 'Door' }));
    const other = await createMenuFixture(prisma(), 'qr-b');
    const foreign = await prisma().qrCode.create({ data: { menuId: other.menu.id, label: 'Theirs' } });
    const view = (qrCodeId: string) => ({ type: 'MENU_VIEW' as const, payload: {}, qrCodeId });
    await recordEvents(prisma(), a.menu.id, { anonymousSessionId: 'session-qr-0001', tableNumber: null, events: [view(code.id)] });
    await recordEvents(prisma(), a.menu.id, { anonymousSessionId: 'session-qr-0002', tableNumber: null, events: [view(foreign.id)] });
    const events = await prisma().analyticsEvent.findMany({ where: { menuId: a.menu.id }, orderBy: { anonymousSessionId: 'asc' } });
    expect(events.map((event) => [event.qrCodeId, event.source])).toEqual([
      [code.id, 'qr'],
      [null, null],
    ]);
    // A scan older than 30 days no longer counts.
    await prisma().analyticsEvent.create({
      data: { menuId: a.menu.id, anonymousSessionId: 'session-qr-0003', type: 'MENU_VIEW', qrCodeId: code.id, source: 'qr', occurredAt: new Date(Date.now() - 31 * 86_400_000) },
    });
    expect((await list())[0]!.scans30d).toBe(1);
  });

  it('follows a slug change, and the printed address still redirects', async () => {
    const code = dataOf(await run(qr.create, { menuId: a.menu.id, label: 'Door' }));
    dataOf(await run(menus.changeMenuSlug, { menuId: a.menu.id, slug: 'qr-renamed', version: a.menu.version }));
    expect((await list())[0]!.url).toBe(`${ORIGIN}/qr-renamed?qr=${code.id}`);
    expect(await resolvePublicMenu('qr-a')).toMatchObject({ kind: 'redirect', slug: 'qr-renamed' });
  });
});
