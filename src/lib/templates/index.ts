import { BAKERY_PRESETS } from './presets/bakery';
import { CAFE_PRESETS } from './presets/cafe';
import { ICECREAM_PRESETS } from './presets/icecream';
import { RESTAURANT_PRESETS } from './presets/restaurant';
import { STYLE_PRESETS } from './presets/styles';
import type { BusinessType, TemplateId, TemplatePreset } from './types';

export * from './types';

const ALL = [...RESTAURANT_PRESETS, ...CAFE_PRESETS, ...BAKERY_PRESETS, ...ICECREAM_PRESETS, ...STYLE_PRESETS].sort((a, b) => a.number - b.number);

/** Every preset by id. */
export const TEMPLATES = Object.fromEntries(ALL.map((preset) => [preset.id, preset])) as Record<TemplateId, TemplatePreset>;

/** The presets in the brief's order, 1 to 33. */
export function templateList(): readonly TemplatePreset[] {
  return ALL;
}

export function presetsFor(business: BusinessType): TemplatePreset[] {
  return ALL.filter((preset) => preset.business === business);
}
