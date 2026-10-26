import type { MenuStyle, StyleGroup } from './catalog';

export interface StyleFilter {
  q: string;
  group: StyleGroup | 'all';
}

/** Arabic-Indic (٠–٩) and Persian (۰–۹) digits as Latin ones: a number typed on an Arabic keyboard finds its style. */
function latinDigits(text: string): string {
  return text.replace(/[٠-٩]/g, (d) => String(d.charCodeAt(0) - 0x0660)).replace(/[۰-۹]/g, (d) => String(d.charCodeAt(0) - 0x06f0));
}

/**
 * The styles a search shows, in the library's order: those of the chosen group whose name (in the Studio's language, from
 * `nameOf`) or id holds every word typed. A number, with or without `#`, finds the style with that number.
 */
export function filterStyles(styles: readonly MenuStyle[], filter: StyleFilter, nameOf: (id: string) => string): MenuStyle[] {
  const inGroup = filter.group === 'all' ? [...styles] : styles.filter((style) => style.group === filter.group);
  const query = latinDigits(filter.q).trim().toLocaleLowerCase();
  if (query === '') return inGroup;

  const number = query.replace(/^#/, '');
  if (/^\d+$/.test(number)) return inGroup.filter((style) => style.number === Number(number));

  const words = query.split(/\s+/).filter(Boolean);
  return inGroup.filter((style) => {
    const haystack = `${nameOf(style.id)} ${style.id.replace(/-/g, ' ')}`.toLocaleLowerCase();
    return words.every((word) => haystack.includes(word));
  });
}
