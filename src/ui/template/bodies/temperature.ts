/**
 * The temperature a dish is served at, for the Living Steam shape (hot dishes steam, cold ones sweat). The menu has no
 * temperature field, and none was added: it is read from the dish's name and its section's name, in English, Arabic and
 * Sorani, by keyword. A pure function, so it is unit-tested and the owner can later replace it with a field.
 *
 * Order of reading, the first that decides wins:
 * 1. the dish name, an explicit word ("hot", "iced", "سارد", "حار"): a hot word and a cold word together decide nothing;
 * 2. the dish name, a kind of dish ("soup", "juice", "كعك"): hot and cold kinds together ("coffee cake") decide nothing;
 * 3. the section name, the same two steps ("Hot drinks", "Desserts").
 * Nothing found: `neutral`, and the shape draws no effect. The diet tags (spicy, vegan ...) say nothing about
 * temperature and are not read; nor is the description (it names ingredients and "served with ice" alike).
 *
 * Latin words match from the start of a word (so `ice` finds "iced" and "ice cream" but not "spice" or "rice"); Arabic
 * script has prefixes (ال) and no spaces inside words, so those match anywhere, except a few short words that match
 * whole words only.
 */
export type Temperature = 'hot' | 'cold' | 'neutral';

const START = String.raw`(?<![\p{L}\p{M}])`;
const END = String.raw`(?![\p{L}\p{M}])`;
/** Latin words, matched from the start of a word. */
const latin = (words: string) => new RegExp(`${START}(?:${words})`, 'iu');
/** Arabic-script words, matched anywhere in a word. */
const script = (words: string) => new RegExp(`(?:${words})`, 'u');
/** Short Arabic-script words, matched as whole words. */
const whole = (words: string) => new RegExp(`${START}(?:${words})${END}`, 'u');

const EXPLICIT_HOT = [latin(String.raw`hot\b|warm\b|steaming`), script('حار|ساخن|دافئ|گەرم')];
const EXPLICIT_COLD = [latin(String.raw`cold\b|iced?\b|ice[ -]?cream|chilled|frozen|frosty`), script('بارد|مثلج|مجمد|آيس|ايس|سارد|ئایس|بەستوو')];

const HOT_KINDS = [
  latin(
    String.raw`soups?\b|broth|stew|curry|grill|bbq|barbecue|kebab|kabab|kofta|roast|fried|fries|baked|oven|toast|pizza|pasta|lasagn|steak|burger|noodle|ramen|biryani|rice\b|tikka|shawarma|falafel|wings|omelet|pancake|waffle|croissant|viennoiserie|bread|sourdough|baguette|coffee|espresso|latte|cappuccino|americano|macchiato|mocha|tea\b|chai|cocoa|tagine|casserole|skewer|tandoor|manakish|dolma`,
  ),
  script('شوربة|شورباء|حساء|مشاوي|مشوي|مشويات|شواء|كباب|كفتة|تكة|مقلي|مقليات|محمص|بيتزا|معكرونة|باستا|ستيك|برغر|برجر|نودلز|برياني|أرز|شاورما|فلافل|كرواسون|معجنات|خبز|قهوة|إسبريسو|كابتشينو|لاتيه|شاي|كاكاو|طاجن|مناقيش|دولمة'),
  script('شۆربا|گرێل|برژاو|برژان|کەباب|کۆفتە|تکە|سووراو|سورکراو|پیتزا|پاستا|ستیک|برگر|نوودڵ|برنج|شاورما|فەلافل|کرواسان|هەویر|قاوە|ئێسپرێسۆ|کاپوچینۆ|لاتێ|چای|کاکاو|دۆڵمە'),
  whole('چا|نان|ساج'),
];
const COLD_KINDS = [
  latin(
    String.raw`juices?\b|soda\b|smoothie|shake|milkshake|lemonade|frapp|freddo|mojito|cocktail|mocktail|sorbet|gelato|dessert|cake|cheesecake|tart\b|tarte|pudding|mousse|patisserie|pâtisserie|[ée]clair|mille[ -]?feuille|macaron|salad|yogh?urt|labneh|hummus|cola\b|pepsi|water\b|sparkling|slush|granita|parfait|tiramisu|brownie|cookie|sweets?\b`,
  ),
  script('عصير|عصائر|سموذي|ميلك شيك|ميلكشيك|ليموناد|مشروبات غازية|صودا|موهيتو|كوكتيل|فرابيه|آيس كريم|بوظة|مثلجات|حلويات|حلوى|كعك|كيك|تارت|بودينغ|تشيز|سلطة|سلطات|زبادي|تيراميسو|براوني|كوكيز|بسكويت|مياه'),
  script('شەربەت|ئاوی|جووس|جوس|سموزی|میلک شەیک|لیمۆناد|مۆهیتۆ|کۆکتەیل|سۆدا|ئایسکرێم|بەستەنی|شیرینی|شیرینیات|کێک|تارت|پودینگ|چیزکێک|زەڵاتە|سەڵاتە|ماست|تیرامیسو|براونی|کووکی|بسکویت'),
  whole('موس|لبن|اللبن'),
];

const any = (rules: RegExp[], text: string) => rules.some((rule) => rule.test(text));

function read(text: string): Temperature {
  if (!text) return 'neutral';
  const hot = any(EXPLICIT_HOT, text);
  const cold = any(EXPLICIT_COLD, text);
  if (hot !== cold) return hot ? 'hot' : 'cold';
  if (hot && cold) return 'neutral';
  const hotKind = any(HOT_KINDS, text);
  const coldKind = any(COLD_KINDS, text);
  if (hotKind !== coldKind) return hotKind ? 'hot' : 'cold';
  return 'neutral';
}

/**
 * The dish's temperature from its name, then its section's name (see the file's notes for the order). `product` is a
 * `MenuProductView` and `category` a `MenuCategory`; only their names are read.
 */
export function temperatureOf(product: { name: string }, category: { name: string }): Temperature {
  const own = read(product.name.normalize('NFC'));
  return own !== 'neutral' ? own : read(category.name.normalize('NFC'));
}

/**
 * The two lanes' colours: a chip's fill with the text colour that reads on it (each pair is unit-tested at 4.5:1), and
 * the lane's stripe colour on the row. Fixed whatever the menu's palette, so the chip reads on every one.
 */
export const LANES = {
  hot: { fill: '#F4A259', ink: '#2B1407', stripe: '#E8742A' },
  cold: { fill: '#A9DCF5', ink: '#0B2A3B', stripe: '#4FA9DC' },
} as const;
