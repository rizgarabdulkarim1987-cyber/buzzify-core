import { FONT_PAIRS } from '@/lib/font-pairs';
import { BRAND_PRESETS } from '@/lib/palette';
import { DEMO_NOTICE } from './demo-notice';
import type { SeedData, SeedGroup, SeedProduct, SeedVariant, Tri, TriList } from './atelier';

/**
 * Gelateria Onda (Demo): a fictional Italian gelateria, the ice cream demo for the template presets (spec
 * 2026-10-18-template-studio-design.md). Drawn with Gelato Riviera. Scoops priced by count, cup or cone, toppings, and a
 * sundae built step by step. Prices in US dollars (cents). Arabic and Sorani are machine-drafted.
 */

const t = (en: string, ar: string, ckb: string): Tri => ({ en, ar, ckb });
const list = (en: string[], ar: string[], ckb: string[]): TriList => ({ en, ar, ckb });
const pair = FONT_PAIRS.riviera;

const SCOOPS = (): SeedVariant[] => [
  { name: t('1 scoop', 'كرة واحدة', '١ تۆپ'), priceDelta: 0, costDelta: 0, isDefault: true },
  { name: t('2 scoops', 'كرتان', '٢ تۆپ'), priceDelta: 150, costDelta: 40 },
  { name: t('3 scoops', '٣ كرات', '٣ تۆپ'), priceDelta: 275, costDelta: 75 },
];

const CUP_OR_CONE = (): SeedGroup => ({
  name: t('Cup or cone', 'كوب أو بسكويت', 'کووپ یان کۆن'),
  min: 1,
  max: 1,
  options: [
    { name: t('Cup', 'كوب', 'کووپ'), priceDelta: 0, costDelta: 0 },
    { name: t('Waffle cone', 'بسكويت وافل', 'کۆنی وافڵ'), effect: t('Baked in the shop', 'يُخبز في المحل', 'لە دووکانەکەدا دەبرژێت'), priceDelta: 50, costDelta: 15 },
  ],
});

const TOPPINGS = (cream: boolean): SeedGroup => ({
  name: t('Toppings', 'الإضافات', 'سەرزیادەکان'),
  min: 0,
  max: 3,
  options: [
    { name: t('Pistachio crumble', 'فتات الفستق', 'وردەی فستق'), priceDelta: 75, costDelta: 25, suggested: true, suggestPriority: 55 },
    { name: t('Dark chocolate sauce', 'صلصة الشوكولاتة الداكنة', 'سۆسی شوکولاتەی تاریک'), priceDelta: 50, costDelta: 15 },
    ...(cream ? [{ name: t('Whipped cream', 'كريمة مخفوقة', 'کرێمی لێدراو'), priceDelta: 50, costDelta: 10 }] : []),
  ],
});

interface Flavour {
  slug: string;
  name: Tri;
  description: Tri;
  tone: string;
  ingredients: TriList;
  allergens: string[];
  dietary: string[];
  sorbet?: boolean;
  signature?: boolean;
  featured?: boolean;
  badges?: string[];
}

function flavour(item: Flavour): SeedProduct {
  return {
    slug: item.slug,
    category: item.sorbet ? 'sorbetto' : 'gelato',
    price: 350,
    cost: 90,
    popularity: 60,
    priority: 50,
    ...(item.signature ? { signature: true } : {}),
    ...(item.featured ? { featured: true } : {}),
    ...(item.badges ? { badges: item.badges } : {}),
    art: 'scoop',
    tone: item.tone,
    name: item.name,
    description: item.description,
    ingredients: item.ingredients,
    allergens: item.allergens,
    dietary: item.dietary,
    variants: SCOOPS(),
    groups: [CUP_OR_CONE(), TOPPINGS(!item.sorbet)],
  };
}

export const ONDA: SeedData = {
  profile: {
    name: 'Gelateria Onda (Demo)',
    type: 'ICE_CREAM',
    city: 'Duhok',
    country: 'Iraq',
    phone: '+964 750 000 2626',
    whatsapp: '+9647500002626',
    instagram: 'https://instagram.com/buzzify.demo',
    description: 'A demonstration gelateria for the template presets. Not a real business.',
    address: '26 Riverside Walk',
    mapUrl: 'https://maps.google.com/?q=Duhok',
    workingHours: { mon: [['12:00', '23:30']], tue: [['12:00', '23:30']], wed: [['12:00', '23:30']], thu: [['12:00', '00:30']], fri: [['12:00', '00:30']], sat: [['12:00', '00:30']], sun: [['12:00', '23:00']] },
  },
  restaurant: {
    slug: 'onda-demo',
    name: 'Gelateria Onda (Demo)',
    currency: 'USD',
    defaultLocale: 'en',
    locales: ['en', 'ar', 'ckb'],
    timezone: 'Asia/Baghdad',
    numeralSystem: 'LATN',
    domains: [],
  },
  brand: {
    logoText: 'Onda',
    theme: 'LIGHT',
    motionIntensity: 'subtle',
    navStyle: 'rail',
    railStyle: 'plain',
    fontPairId: 'riviera',
    typography: { display: pair.display, text: pair.text, arabic: pair.arabic },
    tokens: { light: { ...BRAND_PRESETS.bakery.light }, dark: { ...BRAND_PRESETS.bakery.dark } },
    templateId: 'gelato-riviera',
    design: { promo: DEMO_NOTICE },
  },
  categories: [
    { slug: 'gelato', name: t('Gelato', 'جيلاتو', 'جێلاتۆ') },
    { slug: 'sorbetto', name: t('Sorbet', 'سوربيه', 'سۆربێت') },
    { slug: 'sundaes', name: t('Sundaes', 'صنداي', 'سەندەی') },
    { slug: 'drinks', name: t('Affogato and shakes', 'أفوغاتو وميلك شيك', 'ئەفۆگاتۆ و شەیک') },
  ],
  products: [
    flavour({
      slug: 'pistachio',
      name: t('Pistachio', 'فستق', 'فستق'),
      description: t('Sicilian pistachios, roasted and ground in the shop.', 'فستق صقلي محمص ومطحون في المحل.', 'فستقی سیسیلی، لە دووکانەکەدا برژاو و هاڕاو.'),
      tone: '#9BB06A',
      ingredients: list(['Pistachio', 'Milk', 'Sugar'], ['فستق', 'حليب', 'سكر'], ['فستق', 'شیر', 'شەکر']),
      allergens: ['milk', 'nuts'],
      dietary: ['VEGETARIAN', 'CONTAINS_NUTS', 'GLUTEN_FREE'],
      signature: true,
      featured: true,
    }),
    flavour({
      slug: 'stracciatella',
      name: t('Stracciatella', 'ستراتشاتيلا', 'ستراچاتێلا'),
      description: t('Fior di latte with ribbons of dark chocolate.', 'فيور دي لاتي مع خيوط الشوكولاتة الداكنة.', 'فیۆر دی لاتێ لەگەڵ ڕیشاڵی شوکولاتەی تاریک.'),
      tone: '#F2EBDD',
      ingredients: list(['Milk', 'Cream', 'Dark chocolate'], ['حليب', 'كريمة', 'شوكولاتة داكنة'], ['شیر', 'کرێم', 'شوکولاتەی تاریک']),
      allergens: ['milk', 'soy'],
      dietary: ['VEGETARIAN', 'GLUTEN_FREE'],
      featured: true,
    }),
    flavour({
      slug: 'salted-caramel',
      name: t('Salted caramel', 'كراميل مملح', 'کەرامێلی سوێر'),
      description: t('Caramel cooked dark, finished with sea salt.', 'كراميل مطبوخ داكنًا مع ملح البحر.', 'کەرامێلی تاریک کراو، بە خوێی دەریا تەواو کراوە.'),
      tone: '#C98B4A',
      ingredients: list(['Milk', 'Caramel', 'Sea salt'], ['حليب', 'كراميل', 'ملح البحر'], ['شیر', 'کەرامێل', 'خوێی دەریا']),
      allergens: ['milk'],
      dietary: ['VEGETARIAN', 'GLUTEN_FREE'],
      badges: ['NEW'],
    }),
    flavour({
      slug: 'dark-chocolate',
      name: t('Dark chocolate', 'شوكولاتة داكنة', 'شوکولاتەی تاریک'),
      description: t('Seventy per cent cacao, deep and not too sweet.', 'كاكاو بنسبة سبعين بالمئة، عميق وغير مفرط الحلاوة.', 'حەفتا لە سەدی کاکاو، قووڵ و زۆر شیرین نییە.'),
      tone: '#5A3A2A',
      ingredients: list(['Cacao', 'Milk', 'Sugar'], ['كاكاو', 'حليب', 'سكر'], ['کاکاو', 'شیر', 'شەکر']),
      allergens: ['milk', 'soy'],
      dietary: ['VEGETARIAN', 'GLUTEN_FREE'],
    }),
    flavour({
      slug: 'hazelnut',
      name: t('Hazelnut', 'بندق', 'فندق'),
      description: t('Piedmont hazelnuts, toasted until fragrant.', 'بندق بييمونتي محمص حتى تفوح رائحته.', 'فندقی پیێمۆنت، برژاو تا بۆنی خۆش دەدات.'),
      tone: '#B98B5E',
      ingredients: list(['Hazelnut', 'Milk', 'Sugar'], ['بندق', 'حليب', 'سكر'], ['فندق', 'شیر', 'شەکر']),
      allergens: ['milk', 'nuts'],
      dietary: ['VEGETARIAN', 'CONTAINS_NUTS', 'GLUTEN_FREE'],
    }),
    flavour({
      slug: 'strawberry-sorbet',
      name: t('Strawberry', 'فراولة', 'شلیک'),
      description: t('Ripe strawberries and a squeeze of lemon. No milk.', 'فراولة ناضجة وقليل من الليمون. بلا حليب.', 'شلیکی پێگەیشتوو و کەمێک لیمۆ. بێ شیر.'),
      tone: '#E46A7A',
      ingredients: list(['Strawberry', 'Sugar', 'Lemon'], ['فراولة', 'سكر', 'ليمون'], ['شلیک', 'شەکر', 'لیمۆ']),
      allergens: [],
      dietary: ['VEGAN', 'DAIRY_FREE', 'GLUTEN_FREE'],
      sorbet: true,
      featured: true,
    }),
    flavour({
      slug: 'mango-sorbet',
      name: t('Mango', 'مانجو', 'مانگۆ'),
      description: t('Alphonso mango, bright and silky.', 'مانجو ألفونسو منعش وناعم.', 'مانگۆی ئەلفۆنسۆ، گەش و نەرم.'),
      tone: '#F2B33D',
      ingredients: list(['Mango', 'Sugar'], ['مانجو', 'سكر'], ['مانگۆ', 'شەکر']),
      allergens: [],
      dietary: ['VEGAN', 'DAIRY_FREE', 'GLUTEN_FREE'],
      sorbet: true,
    }),
    flavour({
      slug: 'lemon-basil',
      name: t('Lemon and basil', 'ليمون وريحان', 'لیمۆ و ڕێحانە'),
      description: t('Amalfi lemons with fresh basil leaves.', 'ليمون أمالفي مع أوراق الريحان الطازجة.', 'لیمۆی ئەمالفی لەگەڵ گەڵای ڕێحانەی تازە.'),
      tone: '#EFE08A',
      ingredients: list(['Lemon', 'Basil', 'Sugar'], ['ليمون', 'ريحان', 'سكر'], ['لیمۆ', 'ڕێحانە', 'شەکر']),
      allergens: [],
      dietary: ['VEGAN', 'DAIRY_FREE', 'GLUTEN_FREE'],
      sorbet: true,
    }),
    {
      slug: 'build-a-sundae',
      category: 'sundaes',
      price: 750,
      cost: 220,
      popularity: 55,
      priority: 65,
      featured: true,
      art: 'scoop',
      tone: '#EAB29A',
      name: t('Build a sundae', 'اصنع صنداي', 'سەندەیەک دروست بکە'),
      description: t('Choose two or three flavours, a sauce and up to three toppings.', 'اختر نكهتين أو ثلاثًا وصلصة وحتى ثلاث إضافات.', 'دوو یان سێ تام و سۆسێک و تا سێ سەرزیادە هەڵبژێرە.'),
      ingredients: list(['Gelato', 'Sauce'], ['جيلاتو', 'صلصة'], ['جێلاتۆ', 'سۆس']),
      allergens: ['milk'],
      dietary: ['VEGETARIAN'],
      groups: [
        {
          name: t('Flavours', 'النكهات', 'تامەکان'),
          min: 2,
          max: 3,
          options: [
            { name: t('Pistachio', 'فستق', 'فستق'), priceDelta: 0, costDelta: 0 },
            { name: t('Stracciatella', 'ستراتشاتيلا', 'ستراچاتێلا'), priceDelta: 0, costDelta: 0 },
            { name: t('Salted caramel', 'كراميل مملح', 'کەرامێلی سوێر'), priceDelta: 0, costDelta: 0 },
            { name: t('Dark chocolate', 'شوكولاتة داكنة', 'شوکولاتەی تاریک'), priceDelta: 0, costDelta: 0 },
            { name: t('Strawberry sorbet', 'سوربيه الفراولة', 'سۆربێتی شلیک'), priceDelta: 0, costDelta: 0 },
          ],
        },
        {
          name: t('Sauce', 'الصلصة', 'سۆس'),
          min: 1,
          max: 1,
          options: [
            { name: t('Dark chocolate', 'شوكولاتة داكنة', 'شوکولاتەی تاریک'), priceDelta: 0, costDelta: 0 },
            { name: t('Caramel', 'كراميل', 'کەرامێل'), priceDelta: 0, costDelta: 0 },
            { name: t('Wild berries', 'توت بري', 'تووی کێوی'), priceDelta: 0, costDelta: 0 },
          ],
        },
        {
          name: t('Toppings', 'الإضافات', 'سەرزیادەکان'),
          min: 0,
          max: 3,
          options: [
            { name: t('Pistachio crumble', 'فتات الفستق', 'وردەی فستق'), priceDelta: 75, costDelta: 25 },
            { name: t('Whipped cream', 'كريمة مخفوقة', 'کرێمی لێدراو'), priceDelta: 50, costDelta: 10 },
            { name: t('Fresh berries', 'توت طازج', 'تووی تازە'), priceDelta: 100, costDelta: 40 },
            { name: t('Wafer', 'رقاقة وافل', 'وافڵ'), priceDelta: 25, costDelta: 5 },
          ],
        },
      ],
    },
    {
      slug: 'affogato',
      category: 'drinks',
      price: 450,
      cost: 120,
      popularity: 50,
      priority: 45,
      art: 'cup',
      tone: '#6B4632',
      name: t('Affogato', 'أفوغاتو', 'ئەفۆگاتۆ'),
      description: t('A scoop of fior di latte drowned in a hot espresso.', 'كرة فيور دي لاتي مغمورة بإسبريسو ساخن.', 'تۆپێک فیۆر دی لاتێ لە ئێسپرێسۆیەکی گەرمدا نقوم کراوە.'),
      ingredients: list(['Gelato', 'Espresso'], ['جيلاتو', 'إسبريسو'], ['جێلاتۆ', 'ئێسپرێسۆ']),
      allergens: ['milk'],
      dietary: ['VEGETARIAN', 'GLUTEN_FREE'],
    },
    {
      slug: 'pistachio-shake',
      category: 'drinks',
      price: 550,
      cost: 150,
      popularity: 45,
      priority: 40,
      art: 'glass',
      tone: '#B9C98A',
      name: t('Pistachio shake', 'ميلك شيك الفستق', 'شەیکی فستق'),
      description: t('Pistachio gelato blended with cold milk.', 'جيلاتو الفستق مخفوق مع الحليب البارد.', 'جێلاتۆی فستق لەگەڵ شیری سارد تێکەڵ کراوە.'),
      ingredients: list(['Pistachio gelato', 'Milk'], ['جيلاتو الفستق', 'حليب'], ['جێلاتۆی فستق', 'شیر']),
      allergens: ['milk', 'nuts'],
      dietary: ['VEGETARIAN', 'CONTAINS_NUTS'],
      variants: [
        { name: t('Regular', 'عادي', 'ئاسایی'), priceDelta: 0, costDelta: 0, isDefault: true },
        { name: t('Large', 'كبير', 'گەورە'), priceDelta: 150, costDelta: 40 },
      ],
    },
  ],
  pairingRules: [],
  upsellRules: [],
  bundles: [],
  schedule: [],
  tables: [],
};
