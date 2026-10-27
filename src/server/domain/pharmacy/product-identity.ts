import { normalizeScan } from './barcode';

/** The five things that make one sellable product different from another. */
export type ProductIdentityInput = {
  tradeName: string;
  strength: string;
  form: string;
  manufacturer: string;
  packLabel: string;
};

/**
 * Arabic and Kurdish letter variants folded to one letter (the Latin side is only case-folded):
 * alef forms to ا, ى ي ی to ي, ك ک to ك, and ة ە ھ to ه. The POS `nameKey` only trims and lower-cases, so it cannot be reused
 * for this; the unification is local on purpose, and `nameKey` is left exactly as it was.
 */
const LETTER_FOLD: Record<string, string> = {
  أ: 'ا', إ: 'ا', آ: 'ا', ٱ: 'ا',
  ى: 'ي', ی: 'ي',
  ک: 'ك',
  ة: 'ه', ە: 'ه', ھ: 'ه',
};

/** Harakat, Quranic marks, superscript alef and tatweel. */
const ARABIC_MARKS = /[ـً-ٰٟۖ-ۭ]/g;

/** Unit spellings (already letter-folded) to one canonical unit. Only read when glued or spaced to a number. */
const UNITS: Record<string, string> = {};
function unit(canonical: string, spellings: string[]): void {
  for (const s of [canonical, ...spellings]) UNITS[foldLetters(s)] = canonical;
}

function foldLetters(text: string): string {
  return text.replace(/[أإآٱىیکةەھ]/g, (ch) => LETTER_FOLD[ch] ?? ch);
}

unit('mg', ['milligram', 'milligrams', 'ملغ', 'ملغم', 'ملجم', 'ملغرام', 'ملي غرام']);
unit('mcg', ['µg', 'μg', 'ug', 'microgram', 'micrograms', 'مكغ', 'مكغم', 'ميكروغرام']);
unit('ml', ['milliliter', 'milliliters', 'millilitre', 'millilitres', 'مل', 'ملل', 'ملي']);
unit('g', ['gm', 'gram', 'grams', 'غ', 'غم', 'غرام']);

/** Each field is cut to this many UTF-16 units before anything else, bounding the work on hostile input. Real names are far shorter. */
const MAX_FIELD_LENGTH = 500;

function normalizeField(raw: unknown): string {
  let text = typeof raw === 'string' ? raw.slice(0, MAX_FIELD_LENGTH) : '';
  text = text.normalize('NFKC'); // also turns the micro sign into mu and Arabic presentation forms into base letters
  text = normalizeScan(text); // Arabic-Indic and Persian digits to Latin
  text = text.replace(/\p{Cc}/gu, ' '); // control characters out first, so \u0001 below can only be our own placeholder
  text = text.replace(/٫/g, '.').toLowerCase().replace(ARABIC_MARKS, '');
  text = foldLetters(text);
  // keep a decimal point between digits (2.5 and 25 differ); every other punctuation or space run becomes one space
  text = text.replace(/(\d)[.,](?=\d)/g, '$1\u0001');
  text = text.replace(/[^\p{L}\p{M}\p{N}\p{So}%\u0001]+/gu, ' ').replace(/\u0001/g, '.');
  text = text.replace(/\s+/g, ' ').trim();
  // a unit stays attached to its number, in one spelling: '٥٠٠ ملغم', '500 MG' and '500mg' all become '500mg'
  // (?<![\d.]) lets only a number's first digit start a match, which keeps this linear on long digit runs
  return text.replace(/(?<![\d.])(\d+(?:\.\d+)?) ?([\p{L}\p{M}]+)/gu, (whole, num: string, word: string) => {
    const canonical = UNITS[word];
    return canonical ? num + canonical : whole;
  });
}

/**
 * The key two entries of the same product share. Case, digit script, Arabic and Kurdish letter variants, diacritics,
 * punctuation and unit spelling are ignored; a different strength, form, pack label or manufacturer is a different key
 * (fields are joined with a separator that normalisation removes, so a word cannot move from one field to its neighbour).
 * Never throws.
 */
export function identityKeyOf(input: ProductIdentityInput): string {
  return [input.tradeName, input.strength, input.form, input.manufacturer, input.packLabel].map(normalizeField).join('|');
}

/**
 * One field or a search query in the form the identity key uses: the same unification of case, digit script, letter
 * variants, diacritics, punctuation and unit spelling, so what a person types meets what the catalog stores. Bounded
 * and linear on any input (cut to 500 UTF-16 units first). Never throws.
 */
export function normalizeForSearch(raw: unknown): string {
  return normalizeField(raw);
}

/** The fields a product is found by, in this order: the first is the trade name (a prefix of it ranks first). */
export type ProductSearchInput = {
  tradeName: string;
  genericName: string;
  activeIngredient: string;
  strength: string;
  form: string;
  manufacturer: string;
};

/** Between the fields of the search text. Normalisation turns `|` into a space, so it never appears inside a field or a query. */
export const SEARCH_FIELD_SEPARATOR = '|';

/**
 * The text `PhProduct.searchText` holds: each field normalised, joined by `|`. A query (normalised the same way) can
 * never match across two fields, and the trade name is its start.
 */
export function searchTextOf(input: ProductSearchInput): string {
  return [input.tradeName, input.genericName, input.activeIngredient, input.strength, input.form, input.manufacturer]
    .map(normalizeField)
    .join(SEARCH_FIELD_SEPARATOR);
}

export function sameProduct(a: ProductIdentityInput, b: ProductIdentityInput): boolean {
  return identityKeyOf(a) === identityKeyOf(b);
}
