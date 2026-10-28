import { categoryOfStyle, type StyleCategory } from './categories';

/** The page of the design mockups a style comes from; with its `key` it makes the style's id. */
export type StylePage =
  | 'themed'
  | 'kurd-arab'
  | 'motion'
  | 'layout'
  | 'layout-2'
  | 'strange'
  | 'crazy'
  | 'heritage-crazy'
  | 'space'
  | 'space-2'
  | 'float'
  | 'arab-kurd'
  | 'kurd-crazy'
  | 'kurd-clothes'
  | 'news'
  | 'classic'
  | 'classic-20'
  | 'signature'
  | 'signature-2';


export interface MenuStyle {
  /** `<page>-<key>`, for example `motion-dep`. */
  id: string;
  /** 1-based position in the library. */
  number: number;
  /** The category the gallery filters by; see `categories.ts`. */
  category: StyleCategory;
  page: StylePage;
  key: string;
}

/** The picked styles, in the library's order. Which category each is in is `categories.ts`. */
const PICKED: readonly (readonly [page: StylePage, keys: readonly string[]])[] = [
  ['themed', ['kurd', 'shn', 'bab', 'spc', 'win', 'sum', 'prn', 'book']],
  ['kurd-arab', ['cit', 'ram', 'lyl', 'and']],
  ['motion', ['thr', 'stk', 'mor', 'fly', 'ink', 'stm', 'dep', 'kin']],
  ['layout', ['elv', 'per', 'met', 'cab', 'shf', 'tkt', 'mag', 'top']],
  ['layout-2', ['dep', 'cmc', 'hom', 'map', 'lvl', 'frg', 'bnt', 'box']],
  ['strange', ['city', 'sheet', 'peg', 'serp']],
  ['crazy', ['wash', 'jewel', 'snake', 'cable', 'balloon', 'pass']],
  ['heritage-crazy', ['ahwar', 'clay', 'dabka', 'tannour', 'misb', 'qays']],
  ['space', ['sp-deck', 'sp-orbit', 'sp-const', 'sp-ctrl', 'sp-comet', 'sp-hole']],
  ['space-2', ['sp-warp', 'sp-count', 'sp-worm']],
  ['float', ['sp-zero', 'sp-lift', 'sp-isle', 'sp-drift', 'sp-holo']],
  ['arab-kurd', ['shan', 'zel', 'sadu', 'kilim', 'newroz']],
  ['kurd-crazy', ['kew', 'henar', 'daf', 'honey', 'saj']],
  ['kurd-clothes', ['lira', 'faqi', 'pshtwen', 'jamana', 'klash', 'xayat']],
  ['news', ['front', 'ads', 'bourse', 'fold', 'kiosk', 'clips', 'tone']],
  ['classic', ['crate', 'typew', 'film', 'radio', 'catalog']],
  ['classic-20', ['apoth', 'stamps', 'cassette', 'ticket', 'album', 'deco', 'marquee', 'opera', 'manus', 'mashra', 'arcade', 'carpet', 'sadaf', 'afish', 'bazaar', 'resmal', 'halay', 'khurjin', 'dengbej']],
  ['signature', ['bp', 'type', 'wall', 'holo', 'dj', 'neon']],
  ['signature-2', ['hud', 'aqua', 'bank', 'chat']],
];

export const MENU_STYLES: readonly MenuStyle[] = PICKED.flatMap(([page, keys]) =>
  keys.map((key) => ({ id: `${page}-${key}`, page, key })),
).map((style, index) => ({ ...style, number: index + 1, category: categoryOfStyle(style.id) }));

export const STYLE_PAGES: readonly StylePage[] = ['themed', 'kurd-arab', 'motion', 'layout', 'layout-2', 'strange', 'crazy', 'heritage-crazy', 'space', 'space-2', 'float', 'arab-kurd', 'kurd-crazy', 'kurd-clothes', 'news', 'classic', 'classic-20', 'signature', 'signature-2'];

export function menuStyleById(id: string): MenuStyle | undefined {
  return MENU_STYLES.find((style) => style.id === id);
}
