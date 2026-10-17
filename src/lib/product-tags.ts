/** What a product is, for guests who need to know (spec 5.3). The order is the order the menu lists them in. */
export const DIETARY_TAGS = ['VEGETARIAN', 'VEGAN', 'SPICY', 'GLUTEN_FREE', 'DAIRY_FREE', 'HALAL', 'CONTAINS_NUTS'] as const;
export type DietaryTag = (typeof DIETARY_TAGS)[number];

/** Quiet labels on a product's row (spec 5.3). */
export const BADGES = ['NEW', 'POPULAR', 'RECOMMENDED'] as const;
export type Badge = (typeof BADGES)[number];

export function isDietaryTag(value: unknown): value is DietaryTag {
  return typeof value === 'string' && (DIETARY_TAGS as readonly string[]).includes(value);
}

export function isBadge(value: unknown): value is Badge {
  return typeof value === 'string' && (BADGES as readonly string[]).includes(value);
}

/**
 * The allergens a product can name: the fourteen the EU requires a menu to declare, in its list's order. Guests read
 * each in their own language (`allergen.<key>`), so they are keys, never free text.
 */
export const ALLERGENS = [
  'gluten',
  'crustaceans',
  'egg',
  'fish',
  'peanuts',
  'soy',
  'milk',
  'nuts',
  'celery',
  'mustard',
  'sesame',
  'sulphites',
  'lupin',
  'molluscs',
] as const;
export type Allergen = (typeof ALLERGENS)[number];

export function isAllergen(value: unknown): value is Allergen {
  return typeof value === 'string' && (ALLERGENS as readonly string[]).includes(value);
}
