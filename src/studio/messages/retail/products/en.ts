import type { Messages } from '@/lib/i18n';

/**
 * The three Retail products' own names and the texts each renames (`PRODUCT_WORDS` in `src/studio/space-words.ts`): a
 * Supermarket screen says "supermarket", never "retail shop", Electronics or Clothing. Spread into `../en.ts`.
 */
const products: Messages = {
  'hub.supermarket': 'Supermarket',
  'supermarket.as.hub.retail': 'Supermarket',
  'supermarket.as.nav.retail': 'Supermarkets',
  'supermarket.as.retail.title': 'Supermarkets',
  'supermarket.as.retail.description': 'Every supermarket linked to Buzzify Retail, and whether its details have reached Retails.',
  'supermarket.as.retail.new': 'New supermarket',
  'supermarket.as.retail.caption': 'Supermarkets',
  'supermarket.as.retail.emptyTitle': 'No supermarkets yet',
  'supermarket.as.retail.emptyBody': 'A supermarket appears here once it is added. Create it with New supermarket.',
  'supermarket.as.retail.emptyFailedBody': 'Every supermarket has been delivered, or is still being tried.',
  'supermarket.as.restaurants.sector.RETAIL': 'Supermarket',
  'supermarket.as.retail.as.announcements.description': 'Messages from the Buzzify team, written in the Supermarket space.',
  'hub.electronics': 'Electronics',
  'electronics.as.hub.retail': 'Electronics',
  'electronics.as.nav.retail': 'Electronics shops',
  'electronics.as.retail.title': 'Electronics shops',
  'electronics.as.retail.description': 'Every electronics shop linked to Buzzify Retail, and whether its details have reached Retails.',
  'electronics.as.retail.new': 'New electronics shop',
  'electronics.as.retail.caption': 'Electronics shops',
  'electronics.as.retail.emptyTitle': 'No electronics shops yet',
  'electronics.as.retail.emptyBody': 'An electronics shop appears here once it is added. Create it with New electronics shop.',
  'electronics.as.retail.emptyFailedBody': 'Every electronics shop has been delivered, or is still being tried.',
  'electronics.as.restaurants.sector.RETAIL': 'Electronics shop',
  'electronics.as.retail.as.announcements.description': 'Messages from the Buzzify team, written in the Electronics space.',
  'hub.clothing': 'Clothing',
  'clothing.as.hub.retail': 'Clothing',
  'clothing.as.nav.retail': 'Clothing shops',
  'clothing.as.retail.title': 'Clothing shops',
  'clothing.as.retail.description': 'Every clothing shop linked to Buzzify Retail, and whether its details have reached Retails.',
  'clothing.as.retail.new': 'New clothing shop',
  'clothing.as.retail.caption': 'Clothing shops',
  'clothing.as.retail.emptyTitle': 'No clothing shops yet',
  'clothing.as.retail.emptyBody': 'A clothing shop appears here once it is added. Create it with New clothing shop.',
  'clothing.as.retail.emptyFailedBody': 'Every clothing shop has been delivered, or is still being tried.',
  'clothing.as.restaurants.sector.RETAIL': 'Clothing shop',
  'clothing.as.retail.as.announcements.description': 'Messages from the Buzzify team, written in the Clothing space.',
};

export default products;
