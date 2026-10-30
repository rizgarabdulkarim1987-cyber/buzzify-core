/**
 * The temperature a dish is served at, for the Living Steam shape (hot dishes steam, cold ones sweat). The menu has no
 * temperature field, and none was added: it is read from the dish's name and its section's name, in English, Arabic and
 * Sorani. A pure function, so it is unit-tested and the owner can later replace it with a field.
 *
 * Only an explicit temperature word counts ("hot", "iced", "ساخن", "بارد", "گەرم", "سارد"), never the kind of dish: a
 * soup, a cake or a coffee is not guessed, because a guess put frost on hot dishes and steam on cold ones (batch-7
 * review). Words that are ambiguous on a menu are left out: Arabic حار mostly means spicy, not hot.
 *
 * Order of reading, the first that decides wins:
 * 1. the dish name: a hot word and a cold word together decide nothing;
 * 2. the section name ("Hot drinks", "المشروبات الباردة"), the same way.
 * Nothing found: `neutral`, and the shape draws no effect. The diet tags and the description are not read.
 *
 * Matching is by whole word, never by part of a word: the text is folded (`fold`), split into words on anything that
 * is not a letter or a digit, and each word is compared with the folded lists. So "ice" is "Ice cream" but not "rice",
 * "price" or "spicy", and ايس is آيس لاتيه but not رايس or سبايسي. An Arabic word may carry the article (ال).
 */
export type Temperature = 'hot' | 'cold' | 'neutral';

/**
 * Text folded for matching: lower case; Arabic-script spelling made one (tashkeel and the superscript alef and tatweel
 * dropped; أ إ آ ٱ to ا; ى, ی and ئ to ي; ؤ to و; a lone hamza dropped; ة and ە to ه; ک to ك), so the usual ways owners
 * type a word on Arabic, Persian and Kurdish keyboards read the same.
 */
export function fold(text: string): string {
  return text
    .normalize('NFC')
    .toLowerCase()
    .replace(/[ً-ٰٟـ]/gu, '')
    .replace(/[أإآٱ]/gu, 'ا')
    .replace(/[ىیئ]/gu, 'ي')
    .replace(/ؤ/gu, 'و')
    .replace(/ء/gu, '')
    .replace(/[ةە]/gu, 'ه')
    .replace(/ک/gu, 'ك');
}

const words = (list: readonly string[]) => new Set(list.map(fold));

const HOT = words([
  // English
  'hot',
  'warm',
  // Arabic: hot, warm (not حار: on a menu it means spicy)
  'ساخن',
  'ساخنة',
  'دافئ',
  'دافئة',
  // Sorani: hot
  'گەرم',
]);

const COLD = words([
  // English
  'cold',
  'iced',
  'ice',
  'chilled',
  'frozen',
  // Arabic: cold, iced/chilled, frozen, "ice" (آيس, as in آيس لاتيه)
  'بارد',
  'باردة',
  'مثلج',
  'مثلجة',
  'مبرد',
  'مبردة',
  'مجمد',
  'مجمدة',
  'آيس',
  // Sorani: cold, ice, frozen
  'سارد',
  'ئایس',
  'بەستوو',
]);

const ARTICLE = fold('ال');

const has = (list: Set<string>, word: string) => list.has(word) || (word.startsWith(ARTICLE) && list.has(word.slice(ARTICLE.length)));

function read(text: string): Temperature {
  if (!text) return 'neutral';
  const found = fold(text).split(/[^\p{L}\p{M}\p{N}]+/u).filter(Boolean);
  const hot = found.some((word) => has(HOT, word));
  const cold = found.some((word) => has(COLD, word));
  if (hot === cold) return 'neutral';
  return hot ? 'hot' : 'cold';
}

/**
 * The dish's temperature from its name, then its section's name (see the file's notes for the order). `product` is a
 * `MenuProductView` and `category` a `MenuCategory`; only their names are read.
 */
export function temperatureOf(product: { name: string }, category: { name: string }): Temperature {
  const own = read(product.name);
  return own !== 'neutral' ? own : read(category.name);
}

/**
 * The two lanes' colours: a badge's fill with the text colour that reads on it (each pair is unit-tested at 4.5:1), and
 * the lane's stripe colour (the rail under a heading). Fixed whatever the menu's palette, so the chip reads on every one.
 */
export const LANES = {
  hot: { fill: '#F4A259', ink: '#2B1407', stripe: '#E8742A' },
  cold: { fill: '#A9DCF5', ink: '#0B2A3B', stripe: '#4FA9DC' },
} as const;
