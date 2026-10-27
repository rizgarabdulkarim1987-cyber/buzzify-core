import { describe, expect, it } from 'vitest';
import { bodyOf, SHAPE_SETS, TEMPLATES, TEMPLATE_IDS } from '@/lib/templates';
import { templateForStyle } from '@/studio/styles/template-map';
import { BODIES } from '@/ui/template/bodies';
import { SteamBody } from '@/ui/template/bodies/SteamBody';
import { contrastRatio as contrast } from '@/lib/palette';
import { LANES, temperatureOf } from '@/ui/template/bodies/temperature';

const dish = (name: string, dietary: string[] = []) => ({ name, description: '', dietary });
const section = (name: string) => ({ name });

describe('the Living Steam shape', () => {
  it('is registered as a body that sets the hero, the navigation, the cards and the headings', () => {
    expect(BODIES.steam).toBe(SteamBody);
    expect(SHAPE_SETS.steam).toEqual(expect.arrayContaining(['hero', 'nav', 'card', 'heading']));
  });

  it('starts on its own preset after the earlier ones, on the motion-stm style', () => {
    const preset = TEMPLATES['the-living-steam'];
    expect(TEMPLATE_IDS).toContain('the-living-steam');
    expect(preset.number).toBe(TEMPLATE_IDS.indexOf('the-living-steam') + 1);
    expect(preset.business).toBe('restaurant');
    expect(bodyOf(preset.layout)).toBe('steam');
    expect(preset.layout.hero).toBe('compact');
    expect(preset.scene.mode).toBe('static');
    expect(preset.palettes.length).toBeGreaterThanOrEqual(4);
    expect(templateForStyle('motion-stm')).toBe('the-living-steam');
  });
});

describe('temperatureOf', () => {
  it('reads the explicit temperature words of the dish name in English', () => {
    expect(temperatureOf(dish('Hot chocolate'), section('Drinks'))).toBe('hot');
    expect(temperatureOf(dish('Warm brownie'), section('Sweets'))).toBe('hot');
    expect(temperatureOf(dish('Iced latte'), section('Coffee'))).toBe('cold');
    expect(temperatureOf(dish('Cold brew'), section('Coffee'))).toBe('cold');
    expect(temperatureOf(dish('Chilled melon'), section('Fruit'))).toBe('cold');
    expect(temperatureOf(dish('Frozen yoghurt'), section('Sweets'))).toBe('cold');
    expect(temperatureOf(dish('Vanilla ice cream'), section('Sweets'))).toBe('cold');
    expect(temperatureOf(dish('HOT-POT'), section('Mains'))).toBe('hot');
  });

  it('lets the dish name win over its section', () => {
    expect(temperatureOf(dish('Iced tea'), section('Hot drinks'))).toBe('cold');
    expect(temperatureOf(dish('Hot chocolate'), section('Cold drinks'))).toBe('hot');
  });

  it('falls back to the explicit words of the section when the dish name says nothing', () => {
    expect(temperatureOf(dish('Chef special'), section('Cold drinks'))).toBe('cold');
    expect(temperatureOf(dish('Chef special'), section('Hot drinks'))).toBe('hot');
    expect(temperatureOf(dish('طبق اليوم'), section('المشروبات الباردة'))).toBe('cold');
  });

  it('decides nothing from a name that holds a hot word and a cold word', () => {
    expect(temperatureOf(dish('Hot and cold platter'), section('Hot drinks'))).toBe('hot');
    expect(temperatureOf(dish('Hot and cold platter'), section('Specials'))).toBe('neutral');
  });

  it('is neutral when no explicit temperature word is there: dish kinds are not guessed', () => {
    for (const [name, category] of [
      ['Lentil soup', 'Starters'],
      ['Mixed grill', 'Mains'],
      ['Cappuccino', 'Coffee'],
      ['Fresh orange juice', 'Drinks'],
      ['Mango smoothie', 'Drinks'],
      ['Butter croissant', 'Viennoiserie'],
      ['Sourdough', 'Bread'],
      ['Opera cake', 'Celebration cakes'],
      ['Chef special', 'Desserts'],
      ['Morning box', 'Gift boxes'],
      ['', ''],
    ])
      expect(temperatureOf(dish(name!), section(category!)), `${name} in ${category}`).toBe('neutral');
  });

  it('never matches part of another word, and never reads spicy as hot (the false positives of the batch-7 review)', () => {
    for (const [name, category] of [
      ['Spicy chicken', 'Mains'],
      ['Spice bag', 'Specials'],
      ['Shot of the day', 'Specials'],
      ['Fried rice', 'Mains'],
      ['Rice pudding', 'Specials'],
      ['Price of the day', 'Specials'],
      ['Sweet and sour chicken', 'Mains'],
      ['Fish cakes', 'Starters'],
      ['Pancakes', 'Breakfast'],
      ['Cheese fries', 'Sides'],
      ['Sardines', 'Starters'],
      ['Oysters', 'Starters'],
      ['Kunafa', 'Desserts'],
      ['Sticky toffee pudding', 'Desserts'],
      ['Hotdog', 'Snacks'],
      ['Coldstone', 'Snacks'],
      ['Warmer', 'Snacks'],
      ['Icelandic lamb', 'Mains'],
      ['دجاج سبايسي', 'الأطباق'],
      ['زنگر سبايسي', 'الأطباق'],
      ['فرايد رايس', 'الأطباق'],
      ['تشكن رايس', 'الأطباق'],
      ['سلطة حارة', 'السلطات'],
      ['شوربة حارة', 'المقبلات'],
      ['محار', 'المقبلات'],
      ['بان كيك', 'الفطور'],
      ['تشيز فرايز', 'المقبلات'],
      ['كنافة', 'الحلويات'],
      ['شوربة العدس', 'المقبلات'],
      ['عصير برتقال', 'المشروبات'],
      ['ساردين مشوي', 'المقبلات'],
      ['پانکێک', 'بەیانیان'],
      ['ئاوی گۆشت', 'شۆربا'],
      ['کێکی شوکولاتە', 'شیرینی'],
      ['چای', 'خواردنەوە'],
    ])
      expect(temperatureOf(dish(name!), section(category!)), `${name} in ${category}`).toBe('neutral');
  });

  it('reads Arabic explicit words as whole words, with or without the article', () => {
    expect(temperatureOf(dish('قهوة مثلجة'), section('المشروبات'))).toBe('cold');
    expect(temperatureOf(dish('شاي بارد'), section('المشروبات'))).toBe('cold');
    expect(temperatureOf(dish('آيس لاتيه'), section('القهوة'))).toBe('cold');
    expect(temperatureOf(dish('ايس كريم'), section('الحلويات'))).toBe('cold');
    expect(temperatureOf(dish('حليب ساخن'), section('المشروبات'))).toBe('hot');
    expect(temperatureOf(dish('خبز دافئ'), section('المخبوزات'))).toBe('hot');
    expect(temperatureOf(dish('طبق اليوم'), section('المشروبات الساخنة'))).toBe('hot');
  });

  it('folds Arabic spelling first: tashkeel, tatweel, alef and hamza forms, ta marbuta, Persian kaf and yeh', () => {
    expect(temperatureOf(dish('قهوة مُثلَّجة'), section(''))).toBe('cold');
    expect(temperatureOf(dish('قهوه مثلجه'), section(''))).toBe('cold');
    expect(temperatureOf(dish('شاي بـــارد'), section(''))).toBe('cold');
    expect(temperatureOf(dish('اَيس لاتيه'), section(''))).toBe('cold');
    expect(temperatureOf(dish('إيس تي'), section(''))).toBe('cold');
    expect(temperatureOf(dish('خبز دافى'), section(''))).toBe('hot');
    expect(temperatureOf(dish('خبز دافيء'), section(''))).toBe('hot');
    expect(temperatureOf(dish('مشروبات ساخنه'), section(''))).toBe('hot');
    expect(temperatureOf(dish('چاي گەرم'), section(''))).toBe('hot');
    expect(temperatureOf(dish('چاى گەرم'), section(''))).toBe('hot');
  });

  it('reads Sorani explicit words', () => {
    expect(temperatureOf(dish('ئاوی گەرم'), section('خواردنەوە'))).toBe('hot');
    expect(temperatureOf(dish('قاوەی گەرم'), section('خواردنەوە'))).toBe('hot');
    expect(temperatureOf(dish('چای سارد'), section('خواردنەوە'))).toBe('cold');
    expect(temperatureOf(dish('ئایس لاتێ'), section('قاوە'))).toBe('cold');
    expect(temperatureOf(dish('خواردنی ڕۆژ'), section('خواردنەوەی سارد'))).toBe('cold');
    expect(temperatureOf(dish('خواردنی ڕۆژ'), section('خواردنەوەی گەرم'))).toBe('hot');
  });

  it('does not read the diet tags: they say nothing about temperature', () => {
    expect(temperatureOf(dish('Chef special', ['SPICY']), section('Specials'))).toBe('neutral');
  });

  it('is pure: the same dish gives the same answer', () => {
    const product = dish('Hot chocolate');
    expect(temperatureOf(product, section('Drinks'))).toBe(temperatureOf(product, section('Drinks')));
  });
});

describe('the lanes', () => {
  it('has a chip text colour that reads on the fill of each lane at 4.5:1', () => {
    for (const lane of Object.values(LANES)) expect(contrast(lane.ink, lane.fill)).toBeGreaterThanOrEqual(4.5);
  });
});
