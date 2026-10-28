/**
 * The categories the Templates gallery filters the menu styles by. Each style is in exactly one (a test holds it), so
 * a category is a place to look, never an overlap. The names are `styles.category.<category>` in the three languages.
 */
export const STYLE_CATEGORIES = ['space', 'kurdish', 'arab', 'retro', 'lists', 'cards', 'play', 'cinema'] as const;
export type StyleCategory = (typeof STYLE_CATEGORIES)[number];

/** The catalog ids of each category, in the library's order. */
export const CATEGORY_STYLES: Readonly<Record<StyleCategory, readonly string[]>> = {
  space: [
    'themed-spc', 'space-sp-deck', 'space-sp-orbit', 'space-sp-const', 'space-sp-ctrl', 'space-sp-comet', 'space-sp-hole',
    'space-2-sp-warp', 'space-2-sp-count', 'space-2-sp-worm', 'float-sp-zero', 'float-sp-lift', 'float-sp-isle', 'float-sp-drift',
    'float-sp-holo', 'signature-2-hud',
  ],
  kurdish: [
    'themed-kurd', 'kurd-arab-cit', 'heritage-crazy-qays', 'arab-kurd-kilim', 'arab-kurd-newroz',
    'kurd-crazy-kew', 'kurd-crazy-henar', 'kurd-crazy-daf', 'kurd-crazy-honey', 'kurd-crazy-saj',
    'kurd-clothes-lira', 'kurd-clothes-faqi', 'kurd-clothes-pshtwen', 'kurd-clothes-jamana', 'kurd-clothes-klash', 'kurd-clothes-xayat',
    'classic-20-halay', 'classic-20-dengbej', 'classic-20-bazaar',
  ],
  arab: [
    'themed-shn', 'themed-bab', 'kurd-arab-ram', 'kurd-arab-lyl', 'kurd-arab-and',
    'heritage-crazy-ahwar', 'heritage-crazy-clay', 'heritage-crazy-dabka', 'heritage-crazy-tannour', 'heritage-crazy-misb',
    'arab-kurd-shan', 'arab-kurd-zel', 'arab-kurd-sadu',
    'classic-20-mashra', 'classic-20-arcade', 'classic-20-carpet', 'classic-20-sadaf', 'classic-20-resmal', 'classic-20-khurjin', 'classic-20-manus',
  ],
  retro: [
    'themed-book', 'layout-mag',
    'news-front', 'news-ads', 'news-fold', 'news-kiosk', 'news-clips', 'news-tone',
    'classic-crate', 'classic-typew', 'classic-radio', 'classic-catalog',
    'classic-20-apoth', 'classic-20-stamps', 'classic-20-cassette', 'classic-20-ticket', 'classic-20-album', 'classic-20-deco',
  ],
  lists: [
    'layout-per', 'layout-met', 'layout-cab', 'layout-shf', 'layout-tkt', 'layout-2-dep',
    'strange-sheet', 'strange-peg', 'strange-serp', 'news-bourse', 'signature-bp', 'signature-2-bank',
  ],
  cards: [
    'layout-top', 'layout-2-hom', 'layout-2-frg', 'layout-2-bnt', 'layout-2-box', 'crazy-pass',
    'signature-wall', 'signature-holo', 'signature-2-chat',
  ],
  play: [
    'layout-elv', 'layout-2-cmc', 'layout-2-map', 'layout-2-lvl', 'strange-city',
    'crazy-wash', 'crazy-jewel', 'crazy-snake', 'crazy-cable', 'crazy-balloon',
    'signature-dj', 'signature-neon', 'signature-2-aqua',
  ],
  cinema: [
    'themed-win', 'themed-sum', 'themed-prn',
    'motion-thr', 'motion-stk', 'motion-mor', 'motion-fly', 'motion-ink', 'motion-stm', 'motion-dep', 'motion-kin',
    'classic-film', 'classic-20-marquee', 'classic-20-afish', 'classic-20-opera', 'signature-type',
  ],
};

const CATEGORY_BY_STYLE: ReadonlyMap<string, StyleCategory> = new Map(
  STYLE_CATEGORIES.flatMap((category) => CATEGORY_STYLES[category].map((id) => [id, category] as const)),
);

/** The category a catalog style is in. Throws for an id in no category, which the categories test keeps from happening. */
export function categoryOfStyle(styleId: string): StyleCategory {
  const category = CATEGORY_BY_STYLE.get(styleId);
  if (!category) throw new Error(`Menu style ${styleId} is in no category`);
  return category;
}
