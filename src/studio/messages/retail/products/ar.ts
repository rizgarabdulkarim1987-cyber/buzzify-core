import type { Messages } from '@/lib/i18n';

/**
 * The three Retail products' own names and the texts each renames (`PRODUCT_WORDS` in `src/studio/space-words.ts`): a
 * Supermarket screen says "supermarket", never "retail shop", Electronics or Clothing. Spread into `../ar.ts`.
 */
const products: Messages = {
  'hub.supermarket': 'سوبر ماركت',
  'supermarket.as.hub.retail': 'سوبر ماركت',
  'supermarket.as.nav.retail': 'محلات السوبر ماركت',
  'supermarket.as.retail.title': 'محلات السوبر ماركت',
  'supermarket.as.retail.description': 'كل سوبر ماركت مرتبط بـ Buzzify Retail، وهل وصلت بياناته إلى Retails.',
  'supermarket.as.retail.new': 'سوبر ماركت جديد',
  'supermarket.as.retail.caption': 'محلات السوبر ماركت',
  'supermarket.as.retail.emptyTitle': 'لا توجد محلات السوبر ماركت بعد',
  'supermarket.as.retail.emptyBody': 'يظهر سوبر ماركت هنا بعد إضافته. أنشئه من «سوبر ماركت جديد».',
  'supermarket.as.retail.emptyFailedBody': 'سُلِّمت كل محلات السوبر ماركت، أو ما زالت المحاولة جارية.',
  'supermarket.as.restaurants.sector.RETAIL': 'سوبر ماركت',
  'supermarket.as.retail.as.announcements.description': 'رسائل من فريق Buzzify، مكتوبة في مساحة السوبر ماركت.',
  'hub.electronics': 'الإلكترونيات',
  'electronics.as.hub.retail': 'الإلكترونيات',
  'electronics.as.nav.retail': 'محلات الإلكترونيات',
  'electronics.as.retail.title': 'محلات الإلكترونيات',
  'electronics.as.retail.description': 'كل محل إلكترونيات مرتبط بـ Buzzify Retail، وهل وصلت بياناته إلى Retails.',
  'electronics.as.retail.new': 'محل إلكترونيات جديد',
  'electronics.as.retail.caption': 'محلات الإلكترونيات',
  'electronics.as.retail.emptyTitle': 'لا توجد محلات الإلكترونيات بعد',
  'electronics.as.retail.emptyBody': 'يظهر محل إلكترونيات هنا بعد إضافته. أنشئه من «محل إلكترونيات جديد».',
  'electronics.as.retail.emptyFailedBody': 'سُلِّمت كل محلات الإلكترونيات، أو ما زالت المحاولة جارية.',
  'electronics.as.restaurants.sector.RETAIL': 'محل إلكترونيات',
  'electronics.as.retail.as.announcements.description': 'رسائل من فريق Buzzify، مكتوبة في مساحة الإلكترونيات.',
  'hub.clothing': 'الملابس',
  'clothing.as.hub.retail': 'الملابس',
  'clothing.as.nav.retail': 'محلات الملابس',
  'clothing.as.retail.title': 'محلات الملابس',
  'clothing.as.retail.description': 'كل محل ملابس مرتبط بـ Buzzify Retail، وهل وصلت بياناته إلى Retails.',
  'clothing.as.retail.new': 'محل ملابس جديد',
  'clothing.as.retail.caption': 'محلات الملابس',
  'clothing.as.retail.emptyTitle': 'لا توجد محلات الملابس بعد',
  'clothing.as.retail.emptyBody': 'يظهر محل ملابس هنا بعد إضافته. أنشئه من «محل ملابس جديد».',
  'clothing.as.retail.emptyFailedBody': 'سُلِّمت كل محلات الملابس، أو ما زالت المحاولة جارية.',
  'clothing.as.restaurants.sector.RETAIL': 'محل ملابس',
  'clothing.as.retail.as.announcements.description': 'رسائل من فريق Buzzify، مكتوبة في مساحة الملابس.',
};

export default products;
