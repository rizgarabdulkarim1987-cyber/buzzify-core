import { z } from 'zod';
import { HEX } from '@/lib/brand';
import { FONT_PAIR_IDS } from '@/lib/font-pairs';
import { LOCALES } from '@/lib/locale';
import {
  CARD_KINDS,
  CORNERS,
  DENSITIES,
  DETAIL_KINDS,
  HEADING_STYLES,
  HERO_KINDS,
  IMAGE_RATIOS,
  NAV_KINDS,
  OPTION_STYLES,
  ORDERING_MODES,
  SHADOWS,
  TEMPLATE_IDS,
  VISUAL_MODES,
  type DesignOverrides,
  type MenuDesign,
} from '@/lib/templates/types';
import { DAYS, TIME_OF_DAY } from './restaurant-profile';

/**
 * A published menu's design as a snapshot stores it (`BrandView.design`). Strict: a value the renderer could misuse (a
 * colour that is not a colour, a link that is not https) fails the whole snapshot rather than reaching guests.
 */

const colour = z.string().regex(HEX);
const https = z.string().regex(/^https:\/\/[^\s<>"']{3,500}$/);
const phone = z.string().regex(/^\+?[0-9][0-9 ()-]{4,24}$/);
const text = (max: number) => z.partialRecord(z.enum(LOCALES), z.string().max(max));
const range = z.tuple([z.string().regex(TIME_OF_DAY), z.string().regex(TIME_OF_DAY)]);

const hours = z.object(Object.fromEntries(DAYS.map((day) => [day, z.array(range).max(3)])) as Record<(typeof DAYS)[number], z.ZodArray<typeof range>>);

const overrides = z.custom<DesignOverrides>((value) => typeof value === 'object' && value !== null && !Array.isArray(value));

export const menuDesignSchema: z.ZodType<MenuDesign> = z.object({
  templateId: z.enum(TEMPLATE_IDS),
  theme: z.enum(['dark', 'light']),
  palette: z.object({
    bg: colour,
    surface: colour,
    raised: colour,
    card: colour,
    text: colour,
    muted: colour,
    line: colour,
    accent: colour,
    onAccent: colour,
    button: colour,
    onButton: colour,
  }),
  type: z.object({
    fontPairId: z.enum(FONT_PAIR_IDS),
    scale: z.number().min(0.85).max(1.25),
    displayCase: z.enum(['normal', 'upper']),
    tracking: z.number().min(-0.04).max(0.2),
  }),
  layout: z.object({
    hero: z.enum(HERO_KINDS),
    nav: z.enum(NAV_KINDS),
    card: z.enum(CARD_KINDS),
    detail: z.enum(DETAIL_KINDS),
    options: z.enum(OPTION_STYLES),
    imageRatio: z.enum(IMAGE_RATIOS),
    density: z.enum(DENSITIES),
    corners: z.enum(CORNERS),
    shadow: z.enum(SHADOWS),
    heading: z.enum(HEADING_STYLES),
  }),
  scene: z.object({
    mode: z.enum(VISUAL_MODES),
    intensity: z.number().min(0).max(1),
    speed: z.number().min(0.25).max(2),
    ambient: z.boolean(),
    tap: z.boolean(),
    scroll: z.boolean(),
    brightness: z.number().min(0.5).max(1.5),
    blur: z.number().min(0).max(12),
    opacity: z.number().min(0).max(1),
    overlay: z.number().min(0).max(0.8),
  }),
  featured: z.object({ slugs: z.array(z.string().regex(/^[a-z0-9][a-z0-9-]{0,80}$/)).max(12), title: text(80).optional() }),
  promo: z.object({ title: text(80), body: text(300), terms: text(300) }).optional(),
  info: z.object({
    hours: hours.optional(),
    address: z.string().max(300).optional(),
    mapUrl: https.optional(),
    phone: phone.optional(),
    whatsapp: phone.optional(),
    social: z
      .object({ instagram: https.optional(), facebook: https.optional(), tiktok: https.optional(), website: https.optional() })
      .optional(),
  }),
  ordering: z.enum(ORDERING_MODES),
  poweredBy: z.boolean(),
  source: z.object({ templateVersion: z.number().int().min(1), customTemplateId: z.string().max(64).optional(), overrides }),
});
