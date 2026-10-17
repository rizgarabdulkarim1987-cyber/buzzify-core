import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import type { PrismaClient } from '@/generated/prisma/client';
import { menuDb } from '@/server/data/tenant-db';
import { parseQrStyle, QR_FRAME_MAX, qrStyleProblem, qrTargetUrl, type QrStyle, type QrStyleProblem } from '@/server/domain/qr';
import { hostEnv } from '@/server/env';
import { assetImage, loadAssets } from '@/server/media/resolve';
import { previewQr, qrPng, qrZip, renderQr } from '@/server/qr/render';
import { exportKey } from '@/server/storage/keys';
import { getStorage } from '@/server/storage/storage';
import type { ActionContext } from '@/server/studio/framework/action';
import { updateWithVersion } from '@/server/studio/framework/concurrency';
import { StudioError } from '@/server/studio/framework/result';
import { getStudioTranslator } from '@/studio/messages';

/**
 * Printed QR codes (spec 10.8): one for the menu or one per table, each with its look, its downloads and its scans. A
 * table's code opens that table's page, so making one makes the table too. Downloads are drawn on demand, kept under
 * `exports/` and handed out through a link that works for five minutes.
 */

const HEX = /^#[0-9A-Fa-f]{6}$/;
const colour = z.string().regex(HEX, 'Use a colour such as #1A1A1A');

export const qrLabelField = z.string().trim().min(1, 'Enter a name for the code').max(120, 'Use at most 120 characters');
export const tableNumberField = z.number().int().min(1, 'Choose a table from 1 to 999').max(999, 'Choose a table from 1 to 999');
export const qrStyleField = z.object({
  foreground: colour,
  background: colour,
  logo: z.boolean(),
  frameText: z.string().trim().max(QR_FRAME_MAX, 'Use at most 40 characters'),
});

/** The most codes one request makes, and draws into one ZIP. */
export const MAX_TABLE_CODES = 200;
export const QR_PNG_SIZES = [512, 1024, 2048] as const;
export type QrPngSize = (typeof QR_PNG_SIZES)[number];

const DOWNLOAD_LINK_SEC = 300;
const LOGO_MAX_BYTES = 10_000_000;
const SCAN_WINDOW_MS = 30 * 86_400_000;

const STYLE_MESSAGES: Record<QrStyleProblem, string> = {
  LOW_CONTRAST: 'Scanners need more contrast between the code and its background',
  INVERTED: 'Scanners need a dark code on a light background',
  FRAME_TOO_LONG: 'Use at most 40 characters',
};

function menuOf(ctx: { menuId: string | null }): string {
  if (ctx.menuId === null) throw new Error('A menu action ran without a menu');
  return ctx.menuId;
}

function restaurantOf(ctx: { restaurantId: string | null }): string {
  if (ctx.restaurantId === null) throw new Error('A menu action ran without a restaurant');
  return ctx.restaurantId;
}

/** A table's default name, in the language of the person who makes it ("Table 7"). */
const tableName = (ctx: ActionContext, number: number) => getStudioTranslator(ctx.actor.locale)('qr.kind.table', { number });

/** A table's row, made with its default name when the menu has none for that number. */
async function ensureTables(ctx: ActionContext, tx: { table: ActionTx['table'] }, menuId: string, numbers: number[]): Promise<void> {
  await tx.table.createMany({ data: numbers.map((number) => ({ menuId, number, label: tableName(ctx, number) })), skipDuplicates: true } as never);
}

type ActionTx = Parameters<Parameters<ActionContext['transaction']>[0]>[0];

export async function createQrCode(ctx: ActionContext, input: { label: string; tableNumber?: number | undefined }): Promise<{ id: string }> {
  const menuId = menuOf(ctx);
  const tableNumber = input.tableNumber ?? null;
  return ctx.transaction(async (tx) => {
    if (tableNumber !== null) {
      if (await tx.qrCode.findFirst({ where: { tableNumber }, select: { id: true } })) {
        throw new StudioError('INVALID', undefined, { tableNumber: 'This table already has a code' });
      }
      await ensureTables(ctx, tx, menuId, [tableNumber]);
    }
    const code = await tx.qrCode.create({ data: { menuId, label: input.label, tableNumber }, select: { id: true } });
    ctx.audit({ action: 'qr.created', entityType: 'QrCode', entityId: code.id, changes: { label: { before: null, after: input.label }, tableNumber: { before: null, after: tableNumber } } });
    return { id: code.id };
  });
}

/** Codes for tables `from` to `to`, skipping the tables that have one; each code is called after its table. */
export async function createTableCodes(ctx: ActionContext, input: { from: number; to: number }): Promise<{ created: number; skipped: number }> {
  const menuId = menuOf(ctx);
  const numbers = Array.from({ length: input.to - input.from + 1 }, (_, index) => input.from + index);
  return ctx.transaction(async (tx) => {
    const taken = new Set(
      (await tx.qrCode.findMany({ where: { tableNumber: { in: numbers } }, select: { tableNumber: true } })).map((code) => code.tableNumber),
    );
    const fresh = numbers.filter((number) => !taken.has(number));
    await ensureTables(ctx, tx, menuId, fresh);
    const labels = new Map((await tx.table.findMany({ where: { number: { in: fresh } }, select: { number: true, label: true } })).map((table) => [table.number, table.label]));
    for (const number of fresh) {
      const label = labels.get(number) ?? tableName(ctx, number);
      const code = await tx.qrCode.create({ data: { menuId, label, tableNumber: number }, select: { id: true } });
      ctx.audit({ action: 'qr.created', entityType: 'QrCode', entityId: code.id, changes: { label: { before: null, after: label }, tableNumber: { before: null, after: number } } });
    }
    return { created: fresh.length, skipped: numbers.length - fresh.length };
  });
}

export async function updateQrCode(
  ctx: ActionContext,
  input: { qrCodeId: string; version: number; label: string; style: QrStyle },
): Promise<{ version: number }> {
  const problem = qrStyleProblem(input.style);
  if (problem) throw new StudioError('INVALID', undefined, { style: STYLE_MESSAGES[problem] });
  return ctx.transaction(async (tx) => {
    const before = await tx.qrCode.findFirst({ where: { id: input.qrCodeId }, select: { label: true, style: true } });
    if (!before) throw new StudioError('NOT_FOUND');
    await updateWithVersion(tx.qrCode, { id: input.qrCodeId, version: input.version, data: { label: input.label, style: { ...input.style } }, entityType: 'QrCode' }, tx);
    const changes: Record<string, { before: unknown; after: unknown }> = {};
    if (before.label !== input.label) changes.label = { before: before.label, after: input.label };
    const oldStyle = parseQrStyle(before.style);
    for (const key of ['foreground', 'background', 'logo', 'frameText'] as const) {
      if (oldStyle[key] !== input.style[key]) changes[key] = { before: oldStyle[key], after: input.style[key] };
    }
    ctx.audit({ action: 'qr.updated', entityType: 'QrCode', entityId: input.qrCodeId, changes });
    return { version: input.version + 1 };
  });
}

/** Gives every other code of the menu this code's saved look, so a set of table codes is styled once. */
export async function applyQrStyle(ctx: ActionContext, input: { qrCodeId: string }): Promise<{ updated: number }> {
  return ctx.transaction(async (tx) => {
    const source = await tx.qrCode.findFirst({ where: { id: input.qrCodeId }, select: { style: true } });
    if (!source) throw new StudioError('NOT_FOUND');
    const style = parseQrStyle(source.style);
    const others = await tx.qrCode.findMany({ where: { id: { not: input.qrCodeId } }, select: { id: true, style: true } });
    let updated = 0;
    for (const code of others) {
      const before = parseQrStyle(code.style);
      const changes: Record<string, { before: unknown; after: unknown }> = {};
      for (const key of ['foreground', 'background', 'logo', 'frameText'] as const) {
        if (before[key] !== style[key]) changes[key] = { before: before[key], after: style[key] };
      }
      if (Object.keys(changes).length === 0) continue;
      await tx.qrCode.updateMany({ where: { id: code.id }, data: { style: { ...style }, version: { increment: 1 } } });
      ctx.audit({ action: 'qr.updated', entityType: 'QrCode', entityId: code.id, changes });
      updated += 1;
    }
    return { updated };
  });
}

/** Deletes a code. Its table stays: the table's page keeps working for codes already printed elsewhere. */
export async function deleteQrCode(ctx: ActionContext, input: { qrCodeId: string }): Promise<void> {
  await ctx.transaction(async (tx) => {
    const code = await tx.qrCode.findFirst({ where: { id: input.qrCodeId }, select: { id: true, label: true, tableNumber: true } });
    if (!code) throw new StudioError('NOT_FOUND');
    await tx.qrCode.deleteMany({ where: { id: code.id } });
    ctx.audit({ action: 'qr.deleted', entityType: 'QrCode', entityId: code.id, changes: { label: { before: code.label, after: null }, tableNumber: { before: code.tableNumber, after: null } } });
  });
}

// Drawing ------------------------------------------------------------------------------------------------------------

/** The brand's light logo, the one a code on a light ground shows. */
async function brandLogoAsset(db: PrismaClient, menuId: string, restaurantId: string) {
  const brand = await db.brandConfig.findUnique({ where: { menuId }, select: { logoAssetId: true } });
  if (!brand?.logoAssetId) return null;
  const asset = (await loadAssets(db, restaurantId, [brand.logoAssetId])).get(brand.logoAssetId);
  return asset ? assetImage(asset, (key) => getStorage().publicUrl(key)) : null;
}

async function brandLogoBytes(db: PrismaClient, menuId: string, restaurantId: string): Promise<Uint8Array | null> {
  const logo = await brandLogoAsset(db, menuId, restaurantId);
  if (!logo) return null;
  return (await getStorage().get(logo.rasterKey, LOGO_MAX_BYTES))?.bytes ?? null;
}

const fileBase = (slug: string, code: { tableNumber: number | null }) => (code.tableNumber === null ? `${slug}-menu` : `${slug}-table-${code.tableNumber}`);

/** Keeps `body` under `exports/` and answers a link that downloads it as `fileName` for five minutes. */
async function handOut(menuId: string, fileName: string, body: Uint8Array, contentType: string): Promise<{ url: string }> {
  const storage = getStorage();
  const key = exportKey(menuId, randomUUID(), fileName);
  await storage.put(key, body, { contentType, cacheControl: 'private, no-store' });
  return { url: await storage.presignGet(key, { fileName, expiresInSec: DOWNLOAD_LINK_SEC }) };
}

async function menuSlug(db: PrismaClient, menuId: string): Promise<string> {
  const menu = await db.menu.findUnique({ where: { id: menuId }, select: { slug: true } });
  if (!menu) throw new StudioError('NOT_FOUND');
  return menu.slug;
}

export async function downloadQrCode(
  ctx: ActionContext,
  input: { qrCodeId: string; format: 'svg' | 'png'; size?: QrPngSize | undefined },
): Promise<{ url: string }> {
  const menuId = menuOf(ctx);
  const code = await menuDb(ctx.db, menuId).qrCode.findFirst({ where: { id: input.qrCodeId } });
  if (!code) throw new StudioError('NOT_FOUND');
  const slug = await menuSlug(ctx.db, menuId);
  const style = parseQrStyle(code.style);
  const svg = await renderQr({
    url: qrTargetUrl(hostEnv().publicOrigin, slug, code),
    style,
    logo: style.logo ? await brandLogoBytes(ctx.db, menuId, restaurantOf(ctx)) : null,
  });
  const base = fileBase(slug, code);
  if (input.format === 'svg') return handOut(menuId, `${base}.svg`, new TextEncoder().encode(svg), 'image/svg+xml');
  return handOut(menuId, `${base}.png`, await qrPng(svg, input.size ?? 1024), 'image/png');
}

/** A CSV cell: quoted when it holds a comma, a quote or a line break, and never read as a formula. */
function csvCell(value: string): string {
  const safe = /^[=+\-@\t\r]/.test(value) ? `'${value}` : value;
  return /[",\r\n]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
}

/** Every table's code as an SVG and a 1024 px PNG, with `codes.csv` listing them, in one ZIP. */
export async function downloadTableCodes(ctx: ActionContext): Promise<{ url: string }> {
  const menuId = menuOf(ctx);
  const codes = await menuDb(ctx.db, menuId).qrCode.findMany({ where: { tableNumber: { not: null } }, orderBy: { tableNumber: 'asc' }, take: 999 });
  if (codes.length === 0) throw new StudioError('NOT_FOUND', 'No table has a code yet');
  const slug = await menuSlug(ctx.db, menuId);
  const origin = hostEnv().publicOrigin;
  const logo = codes.some((code) => parseQrStyle(code.style).logo) ? await brandLogoBytes(ctx.db, menuId, restaurantOf(ctx)) : null;
  const files: Array<{ name: string; body: Uint8Array }> = [];
  const rows = ['table,label,url'];
  for (const code of codes) {
    const url = qrTargetUrl(origin, slug, code);
    const svg = await renderQr({ url, style: parseQrStyle(code.style), logo });
    const base = fileBase(slug, code);
    files.push({ name: `${base}.svg`, body: new TextEncoder().encode(svg) }, { name: `${base}.png`, body: await qrPng(svg, 1024) });
    rows.push([String(code.tableNumber), csvCell(code.label), url].join(','));
  }
  files.push({ name: 'codes.csv', body: new TextEncoder().encode(`${rows.join('\r\n')}\r\n`) });
  return handOut(menuId, `${slug}-table-codes.zip`, qrZip(files), 'application/zip');
}

// Reading ------------------------------------------------------------------------------------------------------------

export interface QrCodeView {
  id: string;
  label: string;
  tableNumber: number | null;
  style: QrStyle;
  version: number;
  /** The address it opens. */
  url: string;
  /** The code as drawn, the logo linked rather than embedded. */
  svg: string;
  /** Menu views from this code in the last 30 days. */
  scans30d: number;
}

export interface QrCodesView {
  codes: QrCodeView[];
  /** Whether the brand has a logo a code can show. */
  hasLogo: boolean;
  slug: string;
}

const previewLogo = (logo: Awaited<ReturnType<typeof brandLogoAsset>>) => (logo ? { href: logo.url, width: logo.width, height: logo.height } : null);

/** A code drawn in a style that is not saved yet, for the QR tab's preview while the style is chosen. */
export async function previewQrCode(db: PrismaClient, menuId: string, restaurantId: string, input: { qrCodeId: string; style: QrStyle }): Promise<{ svg: string }> {
  const code = await menuDb(db, menuId).qrCode.findFirst({ where: { id: input.qrCodeId }, select: { id: true, tableNumber: true } });
  if (!code) throw new StudioError('NOT_FOUND');
  const [slug, logo] = await Promise.all([menuSlug(db, menuId), input.style.logo ? brandLogoAsset(db, menuId, restaurantId) : null]);
  return { svg: previewQr({ url: qrTargetUrl(hostEnv().publicOrigin, slug, code), style: input.style, logo: previewLogo(logo) }) };
}

/** The menu's codes, the menu's own first and then by table, each drawn and with its scans of the last 30 days. */
export async function listQrCodes(db: PrismaClient, menuId: string, restaurantId: string): Promise<QrCodesView> {
  const scoped = menuDb(db, menuId);
  const [codes, slug, logo, scans] = await Promise.all([
    scoped.qrCode.findMany({ orderBy: [{ tableNumber: { sort: 'asc', nulls: 'first' } }, { createdAt: 'asc' }] }),
    menuSlug(db, menuId),
    brandLogoAsset(db, menuId, restaurantId),
    scoped.analyticsEvent.groupBy({
      by: ['qrCodeId'],
      where: { type: 'MENU_VIEW', qrCodeId: { not: null }, occurredAt: { gte: new Date(Date.now() - SCAN_WINDOW_MS) } },
      _count: { _all: true },
    } as never) as unknown as Promise<Array<{ qrCodeId: string; _count: { _all: number } }>>,
  ]);
  const counts = new Map(scans.map((row) => [row.qrCodeId, row._count._all]));
  const origin = hostEnv().publicOrigin;
  const image = previewLogo(logo);
  return {
    slug,
    hasLogo: logo !== null,
    codes: codes.map((code) => {
      const style = parseQrStyle(code.style);
      const url = qrTargetUrl(origin, slug, code);
      return {
        id: code.id,
        label: code.label,
        tableNumber: code.tableNumber,
        style,
        version: code.version,
        url,
        svg: previewQr({ url, style, logo: image }),
        scans30d: counts.get(code.id) ?? 0,
      };
    }),
  };
}
