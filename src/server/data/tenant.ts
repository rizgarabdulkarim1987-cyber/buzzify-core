import type { PrismaClient } from '@/generated/prisma/client';
import { DEFAULT_PALETTES, sanitizePalette, type Palette } from '@/lib/brand';
import { isLocale, type Locale } from '@/lib/locale';
import { resolveRailStyle, type RailStyle } from '@/lib/rail';
import { resolveEngineConfig, type EngineConfig } from '@/server/domain/config';
import { cached } from './cache';
import { getPrisma } from './prisma';

export type { Palette };

export interface BrandView {
  logoText: string;
  theme: 'dark' | 'light';
  motionIntensity: 'none' | 'subtle' | 'expressive';
  /** How the category rail moves; the plain rail when the menu has turned motion off. */
  railStyle: RailStyle;
  tokens: { dark: Palette; light: Palette };
}

export interface TenantInfo {
  id: string;
  slug: string;
  name: string;
  currency: string;
  defaultLocale: Locale;
  locales: Locale[];
  timeZone: string;
  numeralSystem: 'latn' | 'arab';
  engineConfig: EngineConfig;
  brand: BrandView;
}

const SLUG = /^[a-z0-9][a-z0-9-]{0,39}$/;
const HOST = /^[a-z0-9.-]{1,253}$/;

export async function findTenant(
  prisma: PrismaClient,
  ref: { slug?: string; host?: string },
): Promise<TenantInfo | null> {
  let where: { slug: string } | { id: string };

  if (ref.slug !== undefined) {
    if (!SLUG.test(ref.slug)) return null;
    where = { slug: ref.slug };
  } else if (ref.host !== undefined) {
    const host = ref.host.toLowerCase().split(':')[0] ?? '';
    if (!HOST.test(host)) return null;
    const domain = await prisma.menuDomain.findUnique({ where: { host } });
    if (!domain) return null;
    where = { id: domain.menuId };
  } else {
    return null;
  }

  const row = await prisma.menu.findUnique({
    where,
    include: { brand: true, restaurant: { select: { status: true } } },
  });
  // Guests see a published menu of an active restaurant. Until publishing exists they see its draft.
  if (!row || row.status !== 'PUBLISHED' || row.restaurant.status !== 'ACTIVE') return null;

  const rawTokens = (row.brand?.tokens ?? {}) as { dark?: unknown; light?: unknown };
  const locales = row.locales.filter(isLocale);
  const motionIntensity =
    row.brand?.motionIntensity === 'none' || row.brand?.motionIntensity === 'expressive'
      ? row.brand.motionIntensity
      : 'subtle';
  return {
    id: row.id,
    slug: row.slug,
    name: row.name,
    currency: row.currency,
    defaultLocale: isLocale(row.defaultLocale) ? row.defaultLocale : 'en',
    locales: locales.length > 0 ? locales : ['en'],
    timeZone: row.timezone,
    numeralSystem: row.numeralSystem === 'ARAB' ? 'arab' : 'latn',
    engineConfig: resolveEngineConfig(row.engineConfig),
    brand: {
      logoText: row.brand?.logoText ?? row.name,
      theme: row.brand?.theme === 'LIGHT' ? 'light' : 'dark',
      motionIntensity,
      railStyle: resolveRailStyle(row.brand?.railStyle, motionIntensity),
      tokens: {
        dark: sanitizePalette(rawTokens.dark, DEFAULT_PALETTES.dark),
        light: sanitizePalette(rawTokens.light, DEFAULT_PALETTES.light),
      },
    },
  };
}

export function getTenant(slug: string): Promise<TenantInfo | null> {
  return cached(() => findTenant(getPrisma(), { slug }), ['tenant', slug], {
    revalidate: 60,
    tags: [`tenant:${slug}`],
  })();
}
