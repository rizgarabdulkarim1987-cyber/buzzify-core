import { randomInt } from 'node:crypto';
import { Prisma } from '@/generated/prisma/client';
import type { Locale } from '@/lib/locale';
import { parseMedia } from '@/lib/media';
import { getPrisma } from '@/server/data/prisma';
import { getCatalog } from '@/server/data/public-menu';
import type { TenantInfo } from '@/server/data/tenant';
import { menuDb } from '@/server/data/tenant-db';
import { dayOf, drawSlice, IP_SPIN_FACTOR, MIN_SLICES, spinAllowed, wheelOpen } from '@/server/domain/wheel';

/** What a slice shows a guest: the dish, its first photo and the prize line. Never the weight. */
export interface WheelSliceView {
  productId: string;
  name: string;
  photo: { url: string; width: number; height: number };
  label: string;
}

export interface WheelState {
  available: boolean;
  slices: WheelSliceView[];
  spinsLeft: number;
}

export type SpinResult = { ok: true; winnerProductId: string; label: string; spinsLeft: number } | { ok: false; reason: 'NOT_AVAILABLE' | 'SPINS_USED' };

const NOT_AVAILABLE: WheelState = { available: false, slices: [], spinsLeft: 0 };

function pickText(map: unknown, locale: Locale, defaultLocale: Locale): string {
  if (typeof map !== 'object' || map === null || Array.isArray(map)) return '';
  const stored = map as Record<string, unknown>;
  for (const candidate of [locale, defaultLocale, 'en', 'ar', 'ckb']) {
    const value = stored[candidate];
    if (typeof value === 'string' && value.trim() !== '') return value.trim();
  }
  return '';
}

function nameIn(translations: unknown, locale: Locale, defaultLocale: Locale): string {
  if (typeof translations !== 'object' || translations === null) return '';
  const map = translations as Record<string, { name?: unknown } | undefined>;
  for (const candidate of [locale, defaultLocale, 'en', 'ar', 'ckb']) {
    const name = map[candidate]?.name;
    if (typeof name === 'string' && name.trim() !== '') return name.trim();
  }
  return '';
}

/** The wheel as a guest may use it now: its dates and switches, and only the slices whose dish is on the menu, in stock and has a photo. */
async function usableWheel(tenant: TenantInfo, locale: Locale, now: Date) {
  if (!tenant.extras?.about || !tenant.extras.wheel) return null;
  const db = menuDb(getPrisma(), tenant.id);
  const [wheel, slices, catalog] = await Promise.all([
    db.menuWheel.findUnique({ where: { menuId: tenant.id } }),
    db.wheelSlice.findMany({ where: { menuId: tenant.id }, orderBy: { sortOrder: 'asc' } }),
    getCatalog(tenant),
  ]);
  if (!wheel || !wheelOpen(wheel, now)) return null;
  const products = new Map(catalog.products.map((product) => [product.id, product]));
  const usable: (WheelSliceView & { weight: number })[] = [];
  for (const slice of slices) {
    const product = products.get(slice.productId);
    if (!product || product.isHidden || !product.isAvailable) continue;
    const photo = parseMedia(product.media).find((item) => item.kind === 'image');
    if (!photo || photo.kind !== 'image') continue;
    usable.push({
      productId: product.id,
      name: nameIn(product.translations, locale, tenant.defaultLocale) || product.slug,
      photo: { url: photo.url, width: photo.width, height: photo.height },
      label: pickText(slice.label, locale, tenant.defaultLocale),
      weight: slice.weight,
    });
  }
  if (usable.length < MIN_SLICES) return null;
  return { wheel, slices: usable };
}

async function spinsSoFar(tenant: TenantInfo, day: string, guestKey: string | null, ipHash: string) {
  const db = menuDb(getPrisma(), tenant.id);
  const [guestSpins, ipSpins] = await Promise.all([
    guestKey === null ? 0 : db.wheelSpin.count({ where: { menuId: tenant.id, day, guestKey } }),
    db.wheelSpin.count({ where: { menuId: tenant.id, day, ipHash } }),
  ]);
  return { guestSpins, ipSpins };
}

const spinsLeftOf = (spinsPerDay: number, { guestSpins, ipSpins }: { guestSpins: number; ipSpins: number }) =>
  Math.max(0, Math.min(spinsPerDay - guestSpins, spinsPerDay * IP_SPIN_FACTOR - ipSpins));

/** What the wheel section shows: the slices and how many spins this guest has left today. */
export async function loadWheelState(tenant: TenantInfo, locale: Locale, guestKey: string | null, ipHash: string, now: Date): Promise<WheelState> {
  const ready = await usableWheel(tenant, locale, now);
  if (!ready) return NOT_AVAILABLE;
  const counts = await spinsSoFar(tenant, dayOf(now, tenant.timeZone), guestKey, ipHash);
  return {
    available: true,
    slices: ready.slices.map(({ productId, name, photo, label }) => ({ productId, name, photo, label })),
    spinsLeft: spinsLeftOf(ready.wheel.spinsPerDay, counts),
  };
}

/**
 * One spin: the winner is drawn here, by weight among the dishes a guest can order now, and the spin is written before the answer
 * leaves. Two spins at once cannot both take a guest's last one: the spin's slot is unique per guest and day.
 */
export async function spin(tenant: TenantInfo, locale: Locale, guestKey: string, ipHash: string, now: Date): Promise<SpinResult> {
  const ready = await usableWheel(tenant, locale, now);
  if (!ready) return { ok: false, reason: 'NOT_AVAILABLE' };
  const day = dayOf(now, tenant.timeZone);
  const db = menuDb(getPrisma(), tenant.id);
  const { spinsPerDay } = ready.wheel;
  for (let attempt = 0; attempt < 3; attempt++) {
    const counts = await spinsSoFar(tenant, day, guestKey, ipHash);
    if (!spinAllowed({ ...counts, spinsPerDay })) return { ok: false, reason: 'SPINS_USED' };
    const winnerId = drawSlice(
      ready.slices.map((slice) => ({ id: slice.productId, weight: slice.weight })),
      (limit) => randomInt(limit),
    );
    try {
      await db.wheelSpin.create({ data: { menuId: tenant.id, guestKey, ipHash, day, slot: counts.guestSpins } });
    } catch (error) {
      // Another spin of this guest took the slot first: count again, and stop if that was the last one.
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') continue;
      throw error;
    }
    const winner = ready.slices.find((slice) => slice.productId === winnerId);
    return {
      ok: true,
      winnerProductId: winnerId,
      label: winner?.label ?? '',
      spinsLeft: spinsLeftOf(spinsPerDay, { guestSpins: counts.guestSpins + 1, ipSpins: counts.ipSpins + 1 }),
    };
  }
  return { ok: false, reason: 'SPINS_USED' };
}
