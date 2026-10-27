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

function normalizeField(raw: unknown): string {
  let text = typeof raw === 'string' ? raw : '';
  text = text.normalize('NFKC'); // also turns the micro sign into mu and Arabic presentation forms into base letters
  text = normalizeScan(text); // Arabic-Indic and Persian digits to Latin
  text = text.replace(/٫/g, '.').toLowerCase().replace(ARABIC_MARKS, '');
  text = foldLetters(text);
  // keep a decimal point between digits (2.5 and 25 differ); every other punctuation or space run becomes one space
  text = text.replace(/(\d)[.,](?=\d)/g, '$1\u0001');
  text = text.replace(/[^\p{L}\p{M}\p{N}\p{So}%\u0001]+/gu, ' ').replace(/\u0001/g, '.');
  text = text.replace(/\s+/g, ' ').trim();
  // a unit stays attached to its number, in one spelling: '٥٠٠ ملغم', '500 MG' and '500mg' all become '500mg'
  return text.replace(/(\d+(?:\.\d+)?) ?([\p{L}\p{M}]+)/gu, (whole, num: string, word: string) => {
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

export function sameProduct(a: ProductIdentityInput, b: ProductIdentityInput): boolean {
  return identityKeyOf(a) === identityKeyOf(b);
}
