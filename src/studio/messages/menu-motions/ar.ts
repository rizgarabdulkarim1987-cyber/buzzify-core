import type { Messages } from '@/lib/i18n';

/** تبويب الحركة في مساحة عمل المنيو (حركات المكتبة على المنيو)، وتسميات سجل النشاط. */
const messages: Messages = {
  'activity.action.motion.placed': 'وضع حركة على منيو',
  'activity.action.motion.removed': 'أزال حركة من منيو',
  'error.text.motionPlaceChoose': 'اختر أحد الأماكن المعروضة',
  'error.text.motionCategoryChoose': 'اختر قسماً',
  'error.text.motionPlaceNoCategory': 'هذا المكان ليس له قسم',
  'error.text.motionNotOffered': 'اختر إحدى الحركات المعروضة هنا',
  'activity.entity.MenuMotion': 'حركة المنيو',
};

export default messages;
