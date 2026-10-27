import type { TemplateId } from '@/lib/templates';

/**
 * The catalog styles that are real templates, by catalog id. Today every style in the catalog has a line here (a test
 * holds it). The coming-soon path (Gallery's `isSoon` and `soonStyleOf`, the Studio's coming-soon labels) is kept for
 * a style added to the catalog before its template: the Templates gallery then shows its poster and its mockup, it
 * cannot be applied, and it leaves "coming soon" by getting a line here.
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
  'layout-tkt': 'the-kitchen-ticket-rail',
  'layout-top': 'the-table-from-above',
  'layout-2-cmc': 'the-kitchen-comics',
  'layout-2-hom': 'the-phone-home-screen',
  'layout-2-map': 'the-treasure-map',
  'layout-2-lvl': 'the-game-levels',
  'layout-2-frg': 'the-fridge',
  'layout-2-bnt': 'the-bento-box',
  'layout-2-box': 'the-mailbox-wall',
  'motion-dep': 'the-scroll-depth',
  'motion-kin': 'the-dancing-letters',
  'motion-thr': 'the-curtain-and-spotlight',
  'motion-stk': 'the-stacked-sheets',
  'motion-mor': 'the-photo-to-details',
  'motion-fly': 'the-fly-to-cart',
  'motion-ink': 'the-section-ink',
  'motion-stm': 'the-living-steam',
  'kurd-arab-cit': 'the-erbil-citadel',
  'kurd-arab-ram': 'the-ramadan-nights',
  'kurd-arab-lyl': 'the-thousand-and-one-nights',
  'themed-kurd': 'the-jajim-and-nowruz',
  'themed-shn': 'the-baghdad-shanashil',
  'themed-bab': 'the-ishtar-gate',
  'themed-spc': 'the-space-station',
  'themed-win': 'the-frosted-window',
  'themed-sum': 'the-summer-beach',
  'themed-prn': 'the-3d-printer',
  'heritage-crazy-misb': 'the-prayer-beads',
};

/** The template a catalog style is made real as, or null while it is coming soon. */
export function templateForStyle(styleId: string): TemplateId | null {
  return TEMPLATE_FOR_STYLE[styleId] ?? null;
}
