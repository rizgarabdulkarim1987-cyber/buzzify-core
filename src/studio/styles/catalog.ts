/** The page of the design mockups a style comes from; with its `key` it makes the style's id. */
export type StylePage = 'themed' | 'kurd-arab' | 'motion' | 'layout' | 'layout-2' | 'heritage-crazy';

export const STYLE_GROUPS = ['themes', 'heritage', 'motion', 'shapes'] as const;
export type StyleGroup = (typeof STYLE_GROUPS)[number];

export interface MenuStyle {
  /** `<page>-<key>`, for example `motion-dep`. */
  id: string;
  /** 1-based position in the library. */
  number: number;
  group: StyleGroup;
  page: StylePage;
  key: string;
}

/** The picked styles, in the library's order: themes, heritage, motion, the new shapes, then the later rounds' styles. */
const PICKED: readonly (readonly [group: StyleGroup, page: StylePage, keys: readonly string[]])[] = [
  ['themes', 'themed', ['kurd', 'shn', 'bab', 'spc', 'win', 'sum', 'prn', 'book']],
  ['heritage', 'kurd-arab', ['cit', 'ram', 'lyl']],
  ['motion', 'motion', ['thr', 'stk', 'mor', 'fly', 'ink', 'stm', 'dep', 'kin']],
  ['shapes', 'layout', ['elv', 'per', 'met', 'cab', 'shf', 'tkt', 'mag', 'top']],
  ['shapes', 'layout-2', ['dep', 'cmc', 'hom', 'map', 'lvl', 'frg', 'bnt', 'box']],
  ['heritage', 'heritage-crazy', ['misb']],
];

export const MENU_STYLES: readonly MenuStyle[] = PICKED.flatMap(([group, page, keys]) =>
  keys.map((key) => ({ id: `${page}-${key}`, group, page, key })),
).map((style, index) => ({ ...style, number: index + 1 }));

export const STYLE_PAGES: readonly StylePage[] = ['themed', 'kurd-arab', 'motion', 'layout', 'layout-2', 'heritage-crazy'];

export function menuStyleById(id: string): MenuStyle | undefined {
  return MENU_STYLES.find((style) => style.id === id);
}
