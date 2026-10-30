import type { Messages } from '@/lib/i18n';

/** Sales > Dishes: every dish's selling settings in one table, and the drawer's pointer to it. */
const en: Messages = {
  'sales.page.dishes': 'Dishes',
  'salesDishes.title': 'Selling settings for every dish',
  'salesDishes.body': 'Mark signature and featured dishes, add badges, and set promotion, servings, the low-stock warning and cost. Change any row, then save it. Guests see the changes after you publish.',
  'salesDishes.search': 'Search dishes',
  'salesDishes.caption': 'Selling settings, one row per dish',
  'salesDishes.col.dish': 'Dish',
  'salesDishes.col.priority': 'Promote',
  'salesDishes.col.lowStock': 'Low stock at',
  'salesDishes.col.cost': 'Cost ({currency})',
  'salesDishes.col.actions': 'Save or undo',
  'salesDishes.aria': '{field}: {name}',
  'salesDishes.unsaved': 'Not saved yet',
  'salesDishes.changed': '{count} unsaved',
  'salesDishes.saveAll': 'Save all',
  'salesDishes.savedMany': 'Saved {count} dishes. Guests see them after you publish.',
  'salesDishes.saveRow': 'Save {name}',
  'salesDishes.undoRow': 'Undo changes to {name}',
  'salesDishes.undo': 'Undo',
  'salesDishes.empty': 'No dish matches.',
  'salesDishes.noDishes': 'This menu has no dishes yet. Add them in Content first.',
  'content.drawer.sellingMoved': 'Signature, featured, badges, cost, promotion, servings and the low-stock warning are set for all dishes together in Sales → Dishes.',
  'content.drawer.sellingMovedLink': 'Open Sales → Dishes',
};

export default en;
