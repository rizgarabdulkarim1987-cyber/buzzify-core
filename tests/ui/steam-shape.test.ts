import { describe, expect, it } from 'vitest';
import { bodyOf, SHAPE_SETS, TEMPLATES, TEMPLATE_IDS } from '@/lib/templates';
import { templateForStyle } from '@/studio/styles/template-map';
import { BODIES } from '@/ui/template/bodies';
import { SteamBody } from '@/ui/template/bodies/SteamBody';
import { contrast } from '@/ui/template/bodies/ink-bands';
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
  it('reads hot and cold from the dish name in English', () => {
    expect(temperatureOf(dish('Lentil soup'), section('Starters'))).toBe('hot');
    expect(temperatureOf(dish('Mixed grill'), section('Mains'))).toBe('hot');
    expect(temperatureOf(dish('Cappuccino'), section('Drinks'))).toBe('hot');
    expect(temperatureOf(dish('Fresh orange juice'), section('Drinks'))).toBe('cold');
    expect(temperatureOf(dish('Iced latte'), section('Coffee'))).toBe('cold');
    expect(temperatureOf(dish('Mango smoothie'), section('Drinks'))).toBe('cold');
    expect(temperatureOf(dish('Vanilla ice cream'), section('Desserts'))).toBe('cold');
  });

  it('lets the dish name win over its section', () => {
    expect(temperatureOf(dish('Iced tea'), section('Hot drinks'))).toBe('cold');
    expect(temperatureOf(dish('Hot chocolate'), section('Cold drinks'))).toBe('hot');
    expect(temperatureOf(dish('Fish soup'), section('Cold plates'))).toBe('hot');
  });

  it('falls back to the section when the dish name says nothing', () => {
    expect(temperatureOf(dish('Chef special'), section('Grills'))).toBe('hot');
    expect(temperatureOf(dish('Chef special'), section('Desserts'))).toBe('cold');
    expect(temperatureOf(dish('Chef special'), section('Cold drinks'))).toBe('cold');
    expect(temperatureOf(dish('Chef special'), section('Hot drinks'))).toBe('hot');
  });

  it('is neutral when nothing hints at a temperature', () => {
    expect(temperatureOf(dish('Morning box'), section('Gift boxes'))).toBe('neutral');
    expect(temperatureOf(dish(''), section(''))).toBe('neutral');
  });

  it('matches words, not parts of other words', () => {
    expect(temperatureOf(dish('Shot of the day'), section('Specials'))).toBe('neutral');
    expect(temperatureOf(dish('Rice pudding'), section('Specials'))).toBe('neutral');
    expect(temperatureOf(dish('Coffee cake'), section('Specials'))).toBe('neutral');
    expect(temperatureOf(dish('Spice bag'), section('Specials'))).toBe('neutral');
    expect(temperatureOf(dish('Chocolate'), section('Sweets'))).not.toBe('hot');
  });

  it('reads Arabic names', () => {
    expect(temperatureOf(dish('شوربة العدس'), section('المقبلات'))).toBe('hot');
    expect(temperatureOf(dish('مشاوي مشكلة'), section('الأطباق'))).toBe('hot');
    expect(temperatureOf(dish('عصير برتقال'), section('المشروبات'))).toBe('cold');
    expect(temperatureOf(dish('طبق اليوم'), section('الحلويات'))).toBe('cold');
    expect(temperatureOf(dish('قهوة مثلجة'), section('المشروبات'))).toBe('cold');
    expect(temperatureOf(dish('طبق اليوم'), section('كعكات المناسبات'))).toBe('cold');
  });

  it('reads Sorani names', () => {
    expect(temperatureOf(dish('شۆربای نیسک'), section('پێشخوارن'))).toBe('hot');
    expect(temperatureOf(dish('کەبابی تیکە'), section('خواردن'))).toBe('hot');
    expect(temperatureOf(dish('ئاوی پرتەقاڵ'), section('خواردنەوە'))).toBe('cold');
    expect(temperatureOf(dish('ئاوی گەرم'), section('خواردنەوە'))).toBe('hot');
    expect(temperatureOf(dish('شەربەتی لیمۆ'), section('خواردنەوە'))).toBe('cold');
    expect(temperatureOf(dish('قاوەی گەرم'), section('خواردنەوە'))).toBe('hot');
    expect(temperatureOf(dish('خواردنی ڕۆژ'), section('شیرینی فەڕەنسی'))).toBe('cold');
    expect(temperatureOf(dish('چای'), section('خواردنەوە'))).toBe('hot');
  });

  it('does not read the diet tags: they say nothing about temperature', () => {
    expect(temperatureOf(dish('Chef special', ['SPICY']), section('Specials'))).toBe('neutral');
  });

  it('is pure: the same dish gives the same answer', () => {
    const product = dish('Lentil soup');
    expect(temperatureOf(product, section('Starters'))).toBe(temperatureOf(product, section('Starters')));
  });

  it('classes the Maison Lumière demo so every temperature shows', () => {
    const answers = [
      ['Butter croissant', 'Viennoiserie'],
      ['Pain au chocolat', 'Viennoiserie'],
      ['Mille-feuille', 'Pâtisserie'],
      ['Opera cake', 'Celebration cakes'],
      ['Morning box', 'Gift boxes'],
      ['Sourdough', 'Bread'],
    ].map(([name, category]) => temperatureOf(dish(name!), section(category!)));
    expect(answers).toEqual(['hot', 'hot', 'cold', 'cold', 'neutral', 'hot']);
  });
});

describe('the lanes', () => {
  it('has a chip text colour that reads on the fill of each lane at 4.5:1', () => {
    for (const lane of Object.values(LANES)) expect(contrast(lane.ink, lane.fill)).toBeGreaterThanOrEqual(4.5);
  });
});
