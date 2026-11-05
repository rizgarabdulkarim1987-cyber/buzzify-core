import { describe, expect, it } from 'vitest';
import { MOODS, moodsAvailable, moodsOf, putMoodFirst, type MoodSource } from '@/lib/moods';

const dish = (overrides: Partial<MoodSource> = {}): MoodSource => ({ slot: 'MAIN', dietary: [], calories: null, serves: null, badges: [], ...overrides });

describe('moodsOf', () => {
  it('calls a dish under 450 kcal, or meat-free food, light', () => {
    expect(moodsOf(dish({ calories: 300 }))).toContain('light');
    expect(moodsOf(dish({ dietary: ['VEGAN'] }))).toContain('light');
    expect(moodsOf(dish({ dietary: ['VEGETARIAN'] }))).toContain('light');
    expect(moodsOf(dish({ calories: 450 }))).not.toContain('light');
    expect(moodsOf(dish())).not.toContain('light');
  });

  it('calls a dish over 750 kcal hearty, and never both light and hearty', () => {
    expect(moodsOf(dish({ calories: 900 }))).toContain('hearty');
    expect(moodsOf(dish({ calories: 750 }))).not.toContain('hearty');
    expect(moodsOf(dish({ calories: 900, dietary: ['VEGETARIAN'] }))).toEqual(['hearty']);
  });

  it('reads the rest from the slot, the spice tag, the serving size and the badges', () => {
    expect(moodsOf(dish({ slot: 'DESSERT' }))).toContain('sweet');
    expect(moodsOf(dish({ slot: 'DRINK' }))).toContain('fresh');
    expect(moodsOf(dish({ dietary: ['SPICY'] }))).toContain('spicy');
    expect(moodsOf(dish({ serves: 2 }))).toContain('share');
    expect(moodsOf(dish({ serves: null }))).not.toContain('share');
    expect(moodsOf(dish({ badges: ['POPULAR'] }))).toContain('popular');
    expect(moodsOf(dish({ badges: ['RECOMMENDED'] }))).toContain('popular');
    expect(moodsOf(dish({ badges: ['NEW'] }))).not.toContain('popular');
  });

  it('does not call a drink or a dessert light just because it has no meat', () => {
    expect(moodsOf(dish({ slot: 'DRINK', dietary: ['VEGAN'] }))).not.toContain('light');
    expect(moodsOf(dish({ slot: 'DESSERT', dietary: ['VEGETARIAN'] }))).not.toContain('light');
  });

  it('lists moods in the fixed order', () => {
    const all = moodsOf(dish({ serves: 4, dietary: ['SPICY'], badges: ['POPULAR'], calories: 900 }));
    expect(all).toEqual(MOODS.filter((mood) => all.includes(mood)));
  });
});

describe('moodsAvailable', () => {
  it('offers only moods some dish has, in the fixed order', () => {
    expect(moodsAvailable([['sweet'], ['light', 'share'], []])).toEqual(['light', 'share', 'sweet']);
    expect(moodsAvailable([])).toEqual([]);
  });
});

describe('putMoodFirst', () => {
  const items = [
    { id: 'a', moods: ['light'] },
    { id: 'b', moods: ['hearty'] },
    { id: 'c', moods: ['light', 'share'] },
    { id: 'd', moods: [] },
  ];

  it('moves matching items first without dropping any and keeps each group in its own order', () => {
    expect(putMoodFirst(items, 'light', (item) => item.moods as never).map((item) => item.id)).toEqual(['a', 'c', 'b', 'd']);
  });

  it('changes nothing when no mood is chosen', () => {
    expect(putMoodFirst(items, null, (item) => item.moods as never)).toBe(items);
  });
});
