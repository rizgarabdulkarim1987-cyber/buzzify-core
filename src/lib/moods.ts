/**
 * "What are you in the mood for?" (plan feature `guest.moodPicker`). A mood is read from what a dish already says about
 * itself, so the owner types nothing and no migration is needed. Pure, shared by the server (which stamps each dish
 * of the menu view) and the guest picker.
 */

export const MOODS = ['light', 'hearty', 'share', 'spicy', 'sweet', 'fresh', 'popular'] as const;
export type Mood = (typeof MOODS)[number];

export function isMood(value: unknown): value is Mood {
  return typeof value === 'string' && (MOODS as readonly string[]).includes(value);
}

/** The fields of a dish a mood is read from. */
export interface MoodSource {
  slot: string | null;
  dietary: readonly string[];
  calories: number | null;
  serves: number | null;
  badges: readonly string[];
}

const LIGHT_BELOW_KCAL = 450;
const HEARTY_ABOVE_KCAL = 750;

export function moodsOf(dish: MoodSource): Mood[] {
  const sweet = dish.slot === 'DESSERT';
  const drink = dish.slot === 'DRINK';
  const heavy = dish.calories !== null && dish.calories > HEARTY_ABOVE_KCAL;
  const meatFree = dish.dietary.includes('VEGETARIAN') || dish.dietary.includes('VEGAN');
  // Desserts and drinks are meat-free by nature, so only food can be light for being so.
  const light = !heavy && ((dish.calories !== null && dish.calories < LIGHT_BELOW_KCAL) || (meatFree && !sweet && !drink));
  const found: Record<Mood, boolean> = {
    light,
    hearty: heavy,
    share: dish.serves !== null && dish.serves >= 2,
    spicy: dish.dietary.includes('SPICY'),
    sweet,
    fresh: drink,
    popular: dish.badges.includes('POPULAR') || dish.badges.includes('RECOMMENDED'),
  };
  return MOODS.filter((mood) => found[mood]);
}

/** The moods worth offering: those at least one dish has, in the fixed order. */
export function moodsAvailable(perDish: readonly (readonly Mood[])[]): Mood[] {
  const seen = new Set(perDish.flat());
  return MOODS.filter((mood) => seen.has(mood));
}

/** The items with the chosen mood's first; nothing is dropped and each group keeps its own order. */
export function putMoodFirst<T>(items: readonly T[], mood: Mood | null, moodsOfItem: (item: T) => readonly Mood[]): readonly T[] {
  if (mood === null) return items;
  const matching = items.filter((item) => moodsOfItem(item).includes(mood));
  return [...matching, ...items.filter((item) => !moodsOfItem(item).includes(mood))];
}
