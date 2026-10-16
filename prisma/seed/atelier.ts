import type { RestaurantType } from '@/generated/prisma/enums';
import type { ArtKind } from '@/lib/media';
import type { RailStyle } from '@/lib/rail';
import type { Daypart, VisualKey } from '@/server/domain/types';

export interface Tri {
  en: string;
  ar: string;
  ckb: string;
}

export interface TriList {
  en: string[];
  ar: string[];
  ckb: string[];
}

export interface SeedOption {
  name: Tri;
  effect?: Tri;
  priceDelta: number;
  costDelta: number | null;
  suggested?: boolean;
  suggestPriority?: number;
  /** What the option does to the 3D model, when the product has one. */
  visualKey?: VisualKey;
}

export interface SeedGroup {
  name: Tri;
  min: number;
  max: number;
  options: SeedOption[];
}

export interface SeedVariant {
  name: Tri;
  priceDelta: number;
  costDelta: number | null;
  isDefault?: boolean;
}

export interface SeedProduct {
  slug: string;
  category: string;
  price: number;
  cost: number | null;
  popularity: number;
  priority: number;
  signature?: boolean;
  featured?: boolean;
  stock?: number;
  lowStock?: number;
  dayparts?: Daypart[];
  hideOutsideDaypart?: boolean;
  slot?: string;
  art: ArtKind;
  /** Which 3D model draws the art, when the art kind alone is ambiguous. */
  model?: string;
  tone: string;
  name: Tri;
  description: Tri;
  ingredients: TriList;
  allergens: string[];
  groups?: SeedGroup[];
  variants?: SeedVariant[];
}

export interface SeedPairingRule {
  source: { product: string } | { category: string };
  target: string;
  weight: number;
  reason: Tri;
  dayparts?: Daypart[];
}

export interface SeedUpsellRule {
  source: string;
  target: string;
  priority: number;
  pitch: Tri;
  effect: Tri;
}

export interface SeedBundle {
  slug: string;
  price: number;
  dayparts?: Daypart[];
  name: Tri;
  description: Tri;
  items: Array<{ product: string; quantity: number }>;
}

export interface SeedPalette {
  bg: string;
  surface: string;
  raised: string;
  accent: string;
  text: string;
  muted: string;
  line: string;
  onAccent: string;
}

export interface SeedData {
  /** The client business that owns the menu. */
  profile: {
    name: string;
    type: RestaurantType;
    city: string;
    country: string;
    phone: string;
    whatsapp: string;
    instagram: string;
    description: string;
  };
  /** The menu's own settings: its slug, currency, locales and domains. The business is `profile`. */
  restaurant: {
    slug: string;
    name: string;
    currency: string;
    defaultLocale: 'en' | 'ar' | 'ckb';
    locales: Array<'en' | 'ar' | 'ckb'>;
    timezone: string;
    numeralSystem: 'LATN' | 'ARAB';
    domains: string[];
  };
  brand: {
    logoText: string;
    theme: 'DARK' | 'LIGHT';
    motionIntensity: 'none' | 'subtle' | 'expressive';
    navStyle: string;
    railStyle: RailStyle;
    typography: { display: string; text: string; arabic: string };
    tokens: { dark: SeedPalette; light: SeedPalette };
  };
  categories: Array<{ slug: string; name: Tri }>;
  products: SeedProduct[];
  pairingRules: SeedPairingRule[];
  upsellRules: SeedUpsellRule[];
  bundles: SeedBundle[];
  schedule: Array<{ daypart: Daypart; startMinute: number; endMinute: number; daysOfWeek: number }>;
  tables: number[];
}

const t = (en: string, ar: string, ckb: string): Tri => ({ en, ar, ckb });
const list = (en: string[], ar: string[], ckb: string[]): TriList => ({ en, ar, ckb });

const MILK_GROUP = (): SeedGroup => ({
  name: t('Milk', 'الحليب', 'شیر'),
  min: 0,
  max: 1,
  options: [
    {
      name: t('Oat milk', 'حليب الشوفان', 'شیری جۆ'),
      effect: t('Creamy, plant-based, lightly sweet', 'كريمي نباتي بحلاوة خفيفة', 'کرێمی و ڕووەکی و کەمێک شیرین'),
      priceDelta: 50,
      costDelta: 15,
      suggested: true,
      suggestPriority: 40,
    },
    {
      name: t('Almond milk', 'حليب اللوز', 'شیری بادەم'),
      priceDelta: 50,
      costDelta: 20,
    },
  ],
});

const EXTRA_SHOT_GROUP = (): SeedGroup => ({
  name: t('Extras', 'إضافات', 'زیادەکراوەکان'),
  min: 0,
  max: 1,
  options: [
    {
      name: t('Extra shot', 'جرعة إضافية', 'شۆتی زیادە'),
      effect: t('A second shot of espresso', 'جرعة ثانية من الإسبريسو', 'شۆتێکی دووەمی ئێسپرێسۆ'),
      priceDelta: 100,
      costDelta: 20,
      suggested: true,
      suggestPriority: 60,
    },
  ],
});

const SIZE_VARIANTS = (largeCost: number): SeedVariant[] => [
  { name: t('Regular 350 ml', 'عادي ٣٥٠ مل', 'ئاسایی ٣٥٠ مل'), priceDelta: 0, costDelta: 0, isDefault: true },
  { name: t('Large 500 ml', 'كبير ٥٠٠ مل', 'گەورە ٥٠٠ مل'), priceDelta: 150, costDelta: largeCost },
];

const REASON = {
  fries: t('Crisp and salted, the classic partner', 'مقرمشة ومملّحة، الرفيق الكلاسيكي', 'کرچ و سویر، هاوەڵی کلاسیکی'),
  coldDrink: t('Something cold and bright alongside', 'شيء بارد ومنعش بجانبه', 'شتێکی ساردی تازە لەگەڵیدا'),
  bubbles: t('Clean bubbles to reset the palate', 'فقاعات نقيّة تنعش الذوق', 'بلقی پاک بۆ تازەکردنەوەی تامەکە'),
  steakSide: t('A side that stands up to the steak', 'طبق جانبي يليق بالستيك', 'لایەنێک کە لەگەڵ ستەیکەکە دەگونجێت'),
  starter: t('A crisp start before the pasta', 'بداية مقرمشة قبل المعكرونة', 'دەستپێکێکی کرچ پێش پاستاکە'),
  finish: t('A bright finish to the meal', 'ختام منعش للوجبة', 'کۆتاییەکی تازە بۆ ژەمەکە'),
  withCoffee: t('Pairs with your coffee', 'يتناغم مع قهوتك', 'لەگەڵ قاوەکەت دەگونجێت'),
  sweet: t('Something sweet with it', 'شيء حلو معها', 'شتێکی شیرین لەگەڵیدا'),
  chocolate: t('Dark chocolate suits a short espresso', 'الشوكولاتة الداكنة تناسب الإسبريسو', 'چکلێتی تاریک لەگەڵ ئێسپرێسۆ دەگونجێت'),
  coffeeAfter: t('A coffee to go with it', 'قهوة تناسبها', 'قاوەیەک بۆ لەگەڵیدا'),
  juice: t('Fresh juice with your eggs', 'عصير طازج مع البيض', 'شەربەتی تازە لەگەڵ هێلکەکان'),
  flatWhite: t('A flat white goes well with it', 'فلات وايت يناسبها', 'فلات وایت لەگەڵیدا باشە'),
};

export const ATELIER: SeedData = {
  profile: {
    name: 'ATELIER',
    type: 'CAFE',
    city: 'Erbil',
    country: 'Iraq',
    phone: '',
    whatsapp: '',
    instagram: '',
    description: '',
  },
  restaurant: {
    slug: 'atelier',
    name: 'ATELIER',
    currency: 'USD',
    defaultLocale: 'en',
    locales: ['en', 'ar', 'ckb'],
    timezone: 'Asia/Baghdad',
    numeralSystem: 'LATN',
    domains: ['atelier.localhost'],
  },
  brand: {
    logoText: 'ATELIER',
    theme: 'DARK',
    motionIntensity: 'subtle',
    navStyle: 'rail',
    railStyle: 'deck',
    typography: { display: 'Bodoni Moda', text: 'Hanken Grotesk', arabic: 'Noto Naskh Arabic' },
    tokens: {
      dark: {
        bg: '#0E0E0F',
        surface: '#1B1A19',
        raised: '#2A2826',
        accent: '#D6BC8A',
        text: '#EDE8DF',
        muted: '#A7A096',
        line: '#3A3633',
        onAccent: '#0E0E0F',
      },
      light: {
        bg: '#F7F5F1',
        surface: '#FFFFFF',
        raised: '#EFEBE4',
        accent: '#7A5F26',
        text: '#1B1A19',
        muted: '#6B655D',
        line: '#D9D3C9',
        onAccent: '#FFFFFF',
      },
    },
  },
  categories: [
    { slug: 'coffee-tea', name: t('Coffee & Tea', 'القهوة والشاي', 'قاوە و چا') },
    { slug: 'breakfast', name: t('Breakfast', 'الفطور', 'نانی بەیانی') },
    { slug: 'plates', name: t('Plates', 'الأطباق الرئيسية', 'خواردنی سەرەکی') },
    { slug: 'patisserie', name: t('Pâtisserie', 'الحلويات', 'شیرینی') },
    { slug: 'cold', name: t('Cold & Sparkling', 'المشروبات الباردة', 'خواردنەوە ساردەکان') },
  ],
  products: [
    {
      slug: 'espresso',
      category: 'coffee-tea',
      price: 300,
      cost: 45,
      popularity: 80,
      priority: 40,
      slot: 'DRINK',
      art: 'cup',
      tone: '#6B4A2F',
      name: t('Espresso', 'إسبريسو', 'ئێسپرێسۆ'),
      description: t(
        'A short, concentrated shot of our house blend.',
        'جرعة قصيرة ومركّزة من مزيجنا الخاص.',
        'شۆتێکی کورت و خەست لە تێکەڵەی تایبەتی ئێمە.',
      ),
      ingredients: list(['Coffee'], ['قهوة'], ['قاوە']),
      allergens: [],
      groups: [EXTRA_SHOT_GROUP()],
    },
    {
      slug: 'flat-white',
      category: 'coffee-tea',
      price: 450,
      cost: 90,
      popularity: 85,
      priority: 60,
      signature: true,
      slot: 'DRINK',
      art: 'cup',
      tone: '#8A6A4B',
      name: t('Flat White', 'فلات وايت', 'فلات وایت'),
      description: t(
        'Silky steamed milk over a double espresso.',
        'حليب مبخّر ناعم فوق إسبريسو مزدوج.',
        'شیری بەرزکراوەی نەرم لەسەر ئێسپرێسۆی دووجار.',
      ),
      ingredients: list(['Espresso', 'Milk'], ['إسبريسو', 'حليب'], ['ئێسپرێسۆ', 'شیر']),
      allergens: ['milk'],
      groups: [MILK_GROUP(), EXTRA_SHOT_GROUP()],
    },
    {
      slug: 'cappuccino',
      category: 'coffee-tea',
      price: 450,
      cost: 85,
      popularity: 78,
      priority: 50,
      slot: 'DRINK',
      art: 'cup',
      tone: '#9B7653',
      name: t('Cappuccino', 'كابتشينو', 'کاپوچینۆ'),
      description: t(
        'Espresso under a thick cap of velvety foam.',
        'إسبريسو تحت طبقة كثيفة من الرغوة المخملية.',
        'ئێسپرێسۆ لەژێر چینێکی خەستی کەفی نەرم.',
      ),
      ingredients: list(['Espresso', 'Milk'], ['إسبريسو', 'حليب'], ['ئێسپرێسۆ', 'شیر']),
      allergens: ['milk'],
      groups: [MILK_GROUP(), EXTRA_SHOT_GROUP()],
    },
    {
      slug: 'cortado',
      category: 'coffee-tea',
      price: 400,
      cost: 80,
      popularity: 55,
      priority: 40,
      slot: 'DRINK',
      art: 'cup',
      tone: '#7A5A3F',
      name: t('Cortado', 'كورتادو', 'کۆرتادۆ'),
      description: t(
        'Equal parts espresso and warm milk.',
        'كميات متساوية من الإسبريسو والحليب الدافئ.',
        'بڕی یەکسان ئێسپرێسۆ و شیری گەرم.',
      ),
      ingredients: list(['Espresso', 'Milk'], ['إسبريسو', 'حليب'], ['ئێسپرێسۆ', 'شیر']),
      allergens: ['milk'],
      groups: [MILK_GROUP()],
    },
    {
      slug: 'matcha-latte',
      category: 'coffee-tea',
      price: 550,
      cost: 140,
      popularity: 62,
      priority: 70,
      slot: 'DRINK',
      art: 'cup',
      tone: '#7F9A5E',
      name: t('Matcha Latte', 'ماتشا لاتيه', 'ماچا لاتە'),
      description: t(
        'Stone-ground matcha whisked with steamed milk.',
        'ماتشا مطحونة على الحجر مخفوقة مع حليب مبخّر.',
        'ماچای ئاش‌کراو بە بەرد لەگەڵ شیری بەرزکراوە.',
      ),
      ingredients: list(['Matcha', 'Milk'], ['ماتشا', 'حليب'], ['ماچا', 'شیر']),
      allergens: ['milk'],
      groups: [MILK_GROUP()],
    },
    {
      slug: 'earl-grey',
      category: 'coffee-tea',
      price: 350,
      cost: 40,
      popularity: 45,
      priority: 30,
      slot: 'DRINK',
      art: 'cup',
      tone: '#B58B4C',
      name: t('Earl Grey', 'شاي إيرل غراي', 'چای ئێرل گرەی'),
      description: t(
        'Black tea scented with bergamot, served in a pot.',
        'شاي أسود معطّر بالبرغموت، يُقدَّم في إبريق.',
        'چایی ڕەش بۆنخۆشکراو بە بێرگاموت، لە قوریەکدا.',
      ),
      ingredients: list(['Black tea', 'Bergamot'], ['شاي أسود', 'برغموت'], ['چایی ڕەش', 'بێرگاموت']),
      allergens: [],
    },
    {
      slug: 'croissant',
      model: 'croissant',
      category: 'breakfast',
      price: 350,
      cost: 80,
      popularity: 85,
      priority: 60,
      signature: true,
      stock: 30,
      lowStock: 8,
      dayparts: ['BREAKFAST'],
      slot: 'BAKERY',
      art: 'pastry',
      tone: '#C98F4A',
      name: t('Croissant au beurre', 'كرواسون بالزبدة', 'کرواسانی کەرە'),
      description: t(
        'Laminated all-butter pastry, baked each morning.',
        'عجينة مورّقة بالزبدة الخالصة، تُخبز كل صباح.',
        'هەویری چین‌چین بە کەرەی خاڵیس، هەموو بەیانییەک دەکرێتە فڕن.',
      ),
      ingredients: list(['Butter', 'Flour', 'Milk'], ['زبدة', 'طحين', 'حليب'], ['کەرە', 'ئارد', 'شیر']),
      allergens: ['gluten', 'milk'],
    },
    {
      slug: 'avocado-toast',
      category: 'breakfast',
      price: 900,
      cost: 260,
      popularity: 70,
      priority: 55,
      dayparts: ['BREAKFAST', 'LUNCH'],
      slot: 'MAIN',
      art: 'plate',
      tone: '#7C9B5A',
      name: t('Avocado Toast', 'توست الأفوكادو', 'تۆستی ئەڤۆکادۆ'),
      description: t(
        'Sourdough, smashed avocado, lime and chilli flakes.',
        'خبز العجين المخمّر مع أفوكادو مهروس وليمون ورقائق الفلفل الحار.',
        'نانی هەویری ترش لەگەڵ ئەڤۆکادۆی کوتراو، لیمۆ و پەلی بیبەری تیژ.',
      ),
      ingredients: list(
        ['Sourdough', 'Avocado', 'Lime', 'Chilli'],
        ['خبز العجين المخمّر', 'أفوكادو', 'ليمون', 'فلفل حار'],
        ['نانی هەویری ترش', 'ئەڤۆکادۆ', 'لیمۆ', 'بیبەری تیژ'],
      ),
      allergens: ['gluten'],
      groups: [
        {
          name: t('Add', 'إضافة', 'زیادە بکە'),
          min: 0,
          max: 1,
          options: [
            {
              name: t('Poached egg', 'بيضة مسلوقة', 'هێلکەی کوڵاو'),
              effect: t('One soft poached egg', 'بيضة واحدة مسلوقة طرية', 'یەک هێلکەی نەرمی کوڵاو'),
              priceDelta: 150,
              costDelta: 40,
              suggested: true,
              suggestPriority: 65,
            },
          ],
        },
      ],
    },
    {
      slug: 'shakshuka',
      category: 'breakfast',
      price: 1050,
      cost: 240,
      popularity: 68,
      priority: 60,
      dayparts: ['BREAKFAST', 'LUNCH'],
      slot: 'MAIN',
      art: 'plate',
      tone: '#B5432F',
      name: t('Shakshuka', 'شكشوكة', 'شەکشوکە'),
      description: t(
        'Eggs baked in spiced tomato and pepper sauce, with warm bread.',
        'بيض مخبوز في صلصة الطماطم والفلفل المتبّلة، مع خبز دافئ.',
        'هێلکەی فڕنکراو لە سۆسی تەماتە و بیبەری بەهاراتکراو، لەگەڵ نانی گەرم.',
      ),
      ingredients: list(
        ['Eggs', 'Tomato', 'Pepper', 'Bread'],
        ['بيض', 'طماطم', 'فلفل', 'خبز'],
        ['هێلکە', 'تەماتە', 'بیبەر', 'نان'],
      ),
      allergens: ['egg', 'gluten'],
    },
    {
      slug: 'granola-bowl',
      category: 'breakfast',
      price: 800,
      cost: 190,
      popularity: 52,
      priority: 45,
      dayparts: ['BREAKFAST'],
      slot: 'MAIN',
      art: 'bowl',
      tone: '#C9A86A',
      name: t('Granola Bowl', 'وعاء الغرانولا', 'قاپی گرانۆلا'),
      description: t(
        'House granola, yoghurt, seasonal fruit and honey.',
        'غرانولا منزلية الصنع مع لبن وفاكهة موسمية وعسل.',
        'گرانۆلای ماڵی لەگەڵ ماست، میوەی وەرز و هەنگوین.',
      ),
      ingredients: list(
        ['Granola', 'Yoghurt', 'Fruit', 'Honey'],
        ['غرانولا', 'لبن', 'فاكهة', 'عسل'],
        ['گرانۆلا', 'ماست', 'میوە', 'هەنگوین'],
      ),
      allergens: ['milk', 'nuts', 'gluten'],
    },
    {
      slug: 'atelier-burger',
      category: 'plates',
      price: 900,
      cost: 310,
      popularity: 75,
      priority: 70,
      signature: true,
      dayparts: ['LUNCH', 'DINNER'],
      slot: 'MAIN',
      art: 'burger',
      tone: '#A5662F',
      name: t('Atelier Burger', 'برغر أتيليه', 'بەرگەری ئاتەلیە'),
      description: t(
        'Dry-aged beef, brioche bun, house pickles and sauce.',
        'لحم بقري معتّق، خبز بريوش، مخلل منزلي وصلصة خاصة.',
        'گۆشتی مانگای پیرکراو، نانی بریۆش، تورشی ماڵی و سۆسی تایبەت.',
      ),
      ingredients: list(
        ['Beef', 'Brioche', 'Pickles', 'House sauce'],
        ['لحم بقري', 'بريوش', 'مخلل', 'صلصة خاصة'],
        ['گۆشتی مانگا', 'بریۆش', 'تورشی', 'سۆسی تایبەت'],
      ),
      allergens: ['gluten', 'egg', 'milk', 'mustard'],
      groups: [
        {
          name: t('Make it yours', 'اجعلها على ذوقك', 'بە دڵی خۆت بیکە'),
          min: 0,
          max: 2,
          options: [
            {
              name: t('Premium cheese', 'جبنة فاخرة', 'پەنیری تایبەت'),
              effect: t('Aged cheddar, melted', 'شيدر معتّق مذاب', 'چێدەری پیرکراوی تواوە'),
              priceDelta: 100,
              costDelta: 35,
              suggested: true,
              suggestPriority: 70,
              visualKey: 'cheese',
            },
            {
              name: t('Double patty', 'قرصان من اللحم', 'دوو پارچە گۆشت'),
              effect: t('A second 140 g beef patty', 'قرص لحم ثانٍ بوزن ١٤٠ غ', 'پارچەیەکی دووەمی گۆشت ١٤٠ گرام'),
              priceDelta: 300,
              costDelta: 160,
              suggested: true,
              suggestPriority: 85,
              visualKey: 'patty',
            },
            {
              name: t('Bacon', 'لحم مقدد', 'باکۆن'),
              priceDelta: 150,
              costDelta: 60,
              visualKey: 'bacon',
            },
          ],
        },
      ],
    },
    {
      slug: 'wagyu-burger',
      category: 'plates',
      price: 1300,
      cost: 590,
      popularity: 58,
      priority: 65,
      dayparts: ['DINNER'],
      slot: 'MAIN',
      art: 'burger',
      tone: '#7D4A25',
      name: t('Wagyu Burger', 'برغر واغيو', 'بەرگەری واگیو'),
      description: t(
        'Wagyu beef patty, aged cheddar and truffle mayo on toasted brioche.',
        'قرص لحم واغيو مع شيدر معتّق ومايونيز الكمأة على خبز بريوش محمّص.',
        'پارچەی گۆشتی واگیو لەگەڵ چێدەری پیرکراو و مایۆنیزی ترۆفڵ لەسەر بریۆشی برژاو.',
      ),
      ingredients: list(
        ['Wagyu beef', 'Cheddar', 'Truffle mayo', 'Brioche'],
        ['لحم واغيو', 'شيدر', 'مايونيز الكمأة', 'بريوش'],
        ['گۆشتی واگیو', 'چێدەر', 'مایۆنیزی ترۆفڵ', 'بریۆش'],
      ),
      allergens: ['gluten', 'egg', 'milk'],
    },
    {
      slug: 'truffle-pasta',
      category: 'plates',
      price: 1550,
      cost: 420,
      popularity: 66,
      priority: 72,
      dayparts: ['LUNCH', 'DINNER'],
      slot: 'MAIN',
      art: 'plate',
      tone: '#D8C39A',
      name: t('Truffle Tagliatelle', 'تاليتيلي بالكمأة', 'تاگلیاتێلی ترۆفڵ'),
      description: t(
        'Fresh egg pasta, black truffle butter and parmesan.',
        'معكرونة بيض طازجة بزبدة الكمأة السوداء والبارميزان.',
        'پاستای هێلکەی تازە لەگەڵ کەرەی ترۆفڵی ڕەش و پارمیزان.',
      ),
      ingredients: list(
        ['Egg pasta', 'Black truffle', 'Butter', 'Parmesan'],
        ['معكرونة بيض', 'كمأة سوداء', 'زبدة', 'بارميزان'],
        ['پاستای هێلکە', 'ترۆفڵی ڕەش', 'کەرە', 'پارمیزان'],
      ),
      allergens: ['gluten', 'egg', 'milk'],
      groups: [
        {
          name: t('Add', 'إضافة', 'زیادە بکە'),
          min: 0,
          max: 1,
          options: [
            {
              name: t('Grilled chicken', 'دجاج مشوي', 'مریشکی برژاو'),
              effect: t('Sliced grilled chicken breast', 'شرائح صدر دجاج مشوي', 'پارچە سنگی مریشکی برژاو'),
              priceDelta: 400,
              costDelta: 160,
              suggested: true,
              suggestPriority: 50,
            },
            {
              name: t('Burrata', 'بوراتا', 'بوراتا'),
              effect: t('A whole burrata, torn over the top', 'حبّة بوراتا كاملة تُمزَّق فوق الطبق', 'بوراتایەکی تەواو لەسەر خواردنەکە'),
              priceDelta: 350,
              costDelta: 150,
              suggested: true,
              suggestPriority: 60,
            },
          ],
        },
      ],
    },
    {
      slug: 'ribeye',
      category: 'plates',
      price: 2800,
      cost: 1150,
      popularity: 55,
      priority: 60,
      dayparts: ['DINNER'],
      slot: 'MAIN',
      art: 'plate',
      tone: '#5C3524',
      name: t('Ribeye 250 g', 'ريب آي ٢٥٠ غ', 'ڕیب‌ئای ٢٥٠ گرام'),
      description: t(
        'Ribeye grilled over charcoal with bone-marrow butter.',
        'ريب آي مشوي على الفحم مع زبدة نخاع العظم.',
        'ڕیب‌ئای برژاو لەسەر خەڵووز لەگەڵ کەرەی مۆخی ئێسقان.',
      ),
      ingredients: list(
        ['Ribeye', 'Bone-marrow butter', 'Sea salt'],
        ['ريب آي', 'زبدة نخاع العظم', 'ملح البحر'],
        ['ڕیب‌ئای', 'کەرەی مۆخی ئێسقان', 'خوێی دەریا'],
      ),
      allergens: ['milk'],
      groups: [
        {
          name: t('Doneness', 'درجة النضج', 'پلەی پێگەیشتن'),
          min: 1,
          max: 1,
          options: [
            { name: t('Rare', 'نادج', 'خاو'), priceDelta: 0, costDelta: 0 },
            { name: t('Medium rare', 'متوسط النضج قليلاً', 'ناوەندی خاو'), priceDelta: 0, costDelta: 0 },
            { name: t('Medium', 'متوسط', 'ناوەند'), priceDelta: 0, costDelta: 0 },
            { name: t('Well done', 'ناضج جيدًا', 'باش برژاو'), priceDelta: 0, costDelta: 0 },
          ],
        },
        {
          name: t('Sauce', 'الصلصة', 'سۆس'),
          min: 0,
          max: 1,
          options: [
            {
              name: t('Peppercorn sauce', 'صلصة الفلفل الأسود', 'سۆسی بیبەری ڕەش'),
              effect: t('Cracked pepper cream sauce', 'صلصة كريمة بالفلفل المجروش', 'سۆسی کرێمی بیبەری کوتراو'),
              priceDelta: 150,
              costDelta: 40,
              suggested: true,
              suggestPriority: 55,
            },
          ],
        },
      ],
    },
    {
      slug: 'caesar-salad',
      category: 'plates',
      price: 1000,
      cost: 280,
      popularity: 48,
      priority: 40,
      slot: 'STARTER',
      art: 'bowl',
      tone: '#8DAA6A',
      name: t('Caesar Salad', 'سلطة سيزر', 'زەڵاتەی سیزەر'),
      description: t(
        'Little gem, parmesan, sourdough croutons and anchovy dressing.',
        'خس صغير مع بارميزان وقطع خبز محمّصة وصلصة الأنشوجة.',
        'کاهووی بچووک لەگەڵ پارمیزان، پارچە نانی برژاو و سۆسی ئەنچۆڤی.',
      ),
      ingredients: list(
        ['Little gem', 'Parmesan', 'Croutons', 'Anchovy'],
        ['خس صغير', 'بارميزان', 'خبز محمّص', 'أنشوجة'],
        ['کاهووی بچووک', 'پارمیزان', 'نانی برژاو', 'ئەنچۆڤی'],
      ),
      allergens: ['gluten', 'milk', 'fish', 'egg'],
    },
    {
      slug: 'truffle-fries',
      category: 'plates',
      price: 550,
      cost: 120,
      popularity: 70,
      priority: 55,
      slot: 'SIDE',
      art: 'plate',
      tone: '#D9B45A',
      name: t('Truffle Fries', 'بطاطس بالكمأة', 'پەتاتەی سووربەکراوی ترۆفڵ'),
      description: t(
        'Hand-cut fries, truffle oil and grated parmesan.',
        'بطاطس مقطّعة يدويًا مع زيت الكمأة وبارميزان مبشور.',
        'پەتاتەی بە دەست بڕاو لەگەڵ زەیتی ترۆفڵ و پارمیزانی ڕنراو.',
      ),
      ingredients: list(
        ['Potato', 'Truffle oil', 'Parmesan'],
        ['بطاطس', 'زيت الكمأة', 'بارميزان'],
        ['پەتاتە', 'زەیتی ترۆفڵ', 'پارمیزان'],
      ),
      allergens: ['milk'],
    },
    {
      slug: 'tarte-citron',
      category: 'patisserie',
      price: 650,
      cost: 170,
      popularity: 60,
      priority: 55,
      slot: 'DESSERT',
      art: 'pastry',
      tone: '#E5D06A',
      name: t('Tarte au Citron', 'تارت الليمون', 'تارتی لیمۆ'),
      description: t(
        'Buttery shortcrust, lemon curd and torched meringue.',
        'عجينة هشّة بالزبدة وكريمة الليمون وميرنغ محروق.',
        'هەویری کەرەیی، کرێمی لیمۆ و مرینگی سووتێنراو.',
      ),
      ingredients: list(
        ['Butter pastry', 'Lemon', 'Meringue'],
        ['عجينة بالزبدة', 'ليمون', 'ميرنغ'],
        ['هەویری کەرە', 'لیمۆ', 'مرینگ'],
      ),
      allergens: ['gluten', 'egg', 'milk'],
    },
    {
      slug: 'mille-feuille',
      model: 'millefeuille',
      category: 'patisserie',
      price: 800,
      cost: 230,
      popularity: 64,
      priority: 70,
      signature: true,
      stock: 12,
      lowStock: 4,
      slot: 'DESSERT',
      art: 'pastry',
      tone: '#9DB07A',
      name: t('Pistachio Mille-feuille', 'ميل فوي بالفستق', 'میلفۆیی فستق'),
      description: t(
        'Caramelised puff pastry, pistachio cream, crushed pistachio.',
        'عجينة مورّقة مكرمَلة مع كريمة الفستق وفتات الفستق.',
        'هەویری چین‌چینی کاراملکراو لەگەڵ کرێمی فستق و پارچەی فستق.',
      ),
      ingredients: list(
        ['Puff pastry', 'Pistachio', 'Cream'],
        ['عجينة مورّقة', 'فستق', 'كريمة'],
        ['هەویری چین‌چین', 'فستق', 'کرێم'],
      ),
      allergens: ['gluten', 'milk', 'egg', 'nuts'],
    },
    {
      slug: 'chocolate-fondant',
      category: 'patisserie',
      price: 850,
      cost: 210,
      popularity: 72,
      priority: 60,
      stock: 10,
      lowStock: 4,
      dayparts: ['DINNER', 'LATE_NIGHT'],
      slot: 'DESSERT',
      art: 'pastry',
      tone: '#4A2C21',
      name: t('Chocolate Fondant', 'فوندان الشوكولاتة', 'فۆندانی چکلێت'),
      description: t(
        'Warm dark-chocolate cake with a molten centre.',
        'كيك الشوكولاتة الداكنة الدافئ بقلب سائل.',
        'کێکی چکلێتی تاریکی گەرم بە ناوەڕاستێکی تواوە.',
      ),
      ingredients: list(
        ['Dark chocolate', 'Butter', 'Eggs'],
        ['شوكولاتة داكنة', 'زبدة', 'بيض'],
        ['چکلێتی تاریک', 'کەرە', 'هێلکە'],
      ),
      allergens: ['gluten', 'egg', 'milk'],
    },
    {
      slug: 'basque-cheesecake',
      category: 'patisserie',
      price: 750,
      cost: 190,
      popularity: 66,
      priority: 50,
      slot: 'DESSERT',
      art: 'pastry',
      tone: '#C88A4B',
      name: t('Basque Cheesecake', 'تشيز كيك باسك', 'چیزکێکی باسک'),
      description: t(
        'Burnt-top cheesecake, creamy in the centre.',
        'تشيز كيك بوجه محروق وقلب كريمي.',
        'چیزکێک بە سەرووی سووتاو و ناوەڕاستی کرێمی.',
      ),
      ingredients: list(
        ['Cream cheese', 'Cream', 'Eggs'],
        ['جبنة كريمية', 'كريمة', 'بيض'],
        ['پەنیری کرێمی', 'کرێم', 'هێلکە'],
      ),
      allergens: ['milk', 'egg'],
    },
    {
      slug: 'cold-brew',
      category: 'cold',
      price: 500,
      cost: 90,
      popularity: 60,
      priority: 50,
      slot: 'DRINK',
      art: 'glass',
      tone: '#3D2A1E',
      name: t('Cold Brew', 'قهوة باردة', 'قاوەی ساردی دەرهێنراو'),
      description: t(
        'Steeped for 18 hours, served over ice.',
        'منقوعة لمدة ١٨ ساعة، تُقدَّم مع الثلج.',
        'بۆ ١٨ کاتژمێر هەڵکێشراوە، لەگەڵ سەهۆڵ پێشکەش دەکرێت.',
      ),
      ingredients: list(['Coffee', 'Water'], ['قهوة', 'ماء'], ['قاوە', 'ئاو']),
      allergens: [],
      variants: SIZE_VARIANTS(40),
    },
    {
      slug: 'yuzu-lemonade',
      category: 'cold',
      signature: true,
      price: 550,
      cost: 110,
      popularity: 58,
      priority: 65,
      slot: 'DRINK',
      art: 'glass',
      tone: '#E8D96A',
      name: t('Yuzu Lemonade', 'عصير اليوزو بالليمون', 'لیمۆنادەی یوزو'),
      description: t(
        'Yuzu, lemon and a little honey, over ice.',
        'يوزو وليمون وقليل من العسل مع الثلج.',
        'یوزو و لیمۆ و کەمێک هەنگوین لەگەڵ سەهۆڵ.',
      ),
      ingredients: list(['Yuzu', 'Lemon', 'Honey'], ['يوزو', 'ليمون', 'عسل'], ['یوزو', 'لیمۆ', 'هەنگوین']),
      allergens: [],
      variants: SIZE_VARIANTS(35),
    },
    {
      slug: 'orange-juice',
      category: 'cold',
      price: 500,
      cost: 130,
      popularity: 62,
      priority: 50,
      slot: 'DRINK',
      art: 'glass',
      tone: '#E58A2E',
      name: t('Fresh Orange Juice', 'عصير برتقال طازج', 'شەربەتی پرتەقاڵی تازە'),
      description: t(
        'Pressed to order from whole oranges.',
        'يُعصر عند الطلب من برتقال كامل.',
        'لەکاتی داواکاری لە پرتەقاڵی تەواو دەگوشرێت.',
      ),
      ingredients: list(['Orange'], ['برتقال'], ['پرتەقاڵ']),
      allergens: [],
    },
    {
      slug: 'sparkling-water',
      category: 'cold',
      price: 300,
      cost: 60,
      popularity: 55,
      priority: 40,
      slot: 'DRINK',
      art: 'glass',
      tone: '#CFE3E6',
      name: t('Sparkling Water 500 ml', 'مياه غازية ٥٠٠ مل', 'ئاوی گازدار ٥٠٠ مل'),
      description: t(
        'Chilled mineral water with fine bubbles.',
        'مياه معدنية باردة بفقاعات ناعمة.',
        'ئاوی کانزایی سارد بە بلقی ورد.',
      ),
      ingredients: list(['Mineral water'], ['مياه معدنية'], ['ئاوی کانزایی']),
      allergens: [],
    },
  ],
  pairingRules: [
    { source: { product: 'atelier-burger' }, target: 'truffle-fries', weight: 90, reason: REASON.fries },
    { source: { product: 'atelier-burger' }, target: 'yuzu-lemonade', weight: 70, reason: REASON.coldDrink },
    { source: { product: 'atelier-burger' }, target: 'sparkling-water', weight: 50, reason: REASON.bubbles },
    { source: { product: 'wagyu-burger' }, target: 'truffle-fries', weight: 90, reason: REASON.fries },
    { source: { product: 'wagyu-burger' }, target: 'sparkling-water', weight: 60, reason: REASON.bubbles },
    { source: { product: 'ribeye' }, target: 'truffle-fries', weight: 85, reason: REASON.steakSide },
    { source: { product: 'ribeye' }, target: 'yuzu-lemonade', weight: 50, reason: REASON.coldDrink },
    { source: { product: 'truffle-pasta' }, target: 'caesar-salad', weight: 80, reason: REASON.starter },
    { source: { product: 'truffle-pasta' }, target: 'tarte-citron', weight: 60, reason: REASON.finish },
    { source: { category: 'coffee-tea' }, target: 'croissant', weight: 85, reason: REASON.withCoffee },
    { source: { category: 'coffee-tea' }, target: 'tarte-citron', weight: 55, reason: REASON.sweet },
    { source: { category: 'coffee-tea' }, target: 'basque-cheesecake', weight: 50, reason: REASON.sweet },
    { source: { product: 'espresso' }, target: 'chocolate-fondant', weight: 70, reason: REASON.chocolate },
    { source: { category: 'patisserie' }, target: 'flat-white', weight: 70, reason: REASON.coffeeAfter },
    { source: { category: 'patisserie' }, target: 'espresso', weight: 60, reason: REASON.coffeeAfter },
    { source: { product: 'shakshuka' }, target: 'orange-juice', weight: 65, reason: REASON.juice },
    { source: { product: 'shakshuka' }, target: 'flat-white', weight: 60, reason: REASON.flatWhite },
    { source: { product: 'avocado-toast' }, target: 'flat-white', weight: 70, reason: REASON.flatWhite },
    { source: { product: 'avocado-toast' }, target: 'orange-juice', weight: 60, reason: REASON.juice },
    { source: { product: 'granola-bowl' }, target: 'orange-juice', weight: 60, reason: REASON.juice },
  ],
  upsellRules: [
    {
      source: 'atelier-burger',
      target: 'wagyu-burger',
      priority: 80,
      pitch: t('Wagyu burger', 'برغر واغيو', 'بەرگەری واگیو'),
      effect: t(
        'Wagyu beef patty and truffle mayo on a toasted brioche bun',
        'قرص لحم واغيو ومايونيز الكمأة على خبز بريوش محمّص',
        'پارچەی گۆشتی واگیو و مایۆنیزی ترۆفڵ لەسەر بریۆشی برژاو',
      ),
    },
  ],
  bundles: [
    {
      slug: 'breakfast-set',
      price: 1150,
      dayparts: ['BREAKFAST'],
      name: t('Breakfast set', 'باقة الفطور', 'پاکێجی نانی بەیانی'),
      description: t(
        'Croissant, flat white and fresh orange juice',
        'كرواسون وفلات وايت وعصير برتقال طازج',
        'کرواسان، فلات وایت و شەربەتی پرتەقاڵی تازە',
      ),
      items: [
        { product: 'croissant', quantity: 1 },
        { product: 'flat-white', quantity: 1 },
        { product: 'orange-juice', quantity: 1 },
      ],
    },
    {
      slug: 'burger-set',
      price: 1550,
      name: t('Burger set', 'وجبة البرغر', 'پاکێجی بەرگەر'),
      description: t(
        'Atelier burger, truffle fries and sparkling water',
        'برغر أتيليه وبطاطس بالكمأة ومياه غازية',
        'بەرگەری ئاتەلیە، پەتاتەی ترۆفڵ و ئاوی گازدار',
      ),
      items: [
        { product: 'atelier-burger', quantity: 1 },
        { product: 'truffle-fries', quantity: 1 },
        { product: 'sparkling-water', quantity: 1 },
      ],
    },
  ],
  schedule: [
    { daypart: 'BREAKFAST', startMinute: 420, endMinute: 660, daysOfWeek: 127 },
    { daypart: 'LUNCH', startMinute: 660, endMinute: 960, daysOfWeek: 127 },
    { daypart: 'DINNER', startMinute: 960, endMinute: 1320, daysOfWeek: 127 },
    { daypart: 'LATE_NIGHT', startMinute: 1320, endMinute: 180, daysOfWeek: 127 },
  ],
  tables: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12],
};
