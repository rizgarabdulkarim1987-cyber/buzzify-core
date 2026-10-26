import type { TemplateId } from '@/lib/templates';

/**
 * The catalog styles that are real templates, by catalog id. Every other style in the catalog is coming soon: the
 * Templates gallery shows its poster and its mockup, and it cannot be applied. A style leaves "coming soon" by
 * getting a line here.
 */
export const TEMPLATE_FOR_STYLE: Partial<Record<string, TemplateId>> = {
  'themed-book': 'the-book',
  'layout-mag': 'the-magazine',
  'layout-2-dep': 'taste-airport',
  'layout-elv': 'the-elevator',
  'layout-per': 'the-periodic-table',
  'layout-met': 'the-metro-line',
  'layout-cab': 'the-drawer-cabinet',
  'layout-shf': 'the-supermarket-shelves',
};

/** The template a catalog style is made real as, or null while it is coming soon. */
export function templateForStyle(styleId: string): TemplateId | null {
  return TEMPLATE_FOR_STYLE[styleId] ?? null;
}
