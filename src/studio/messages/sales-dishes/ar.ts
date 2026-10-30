import type { Messages } from '@/lib/i18n';

/** Sales > Dishes: every dish's selling settings in one table, and the drawer's pointer to it. */
const ar: Messages = {
  'sales.page.dishes': 'الأطباق',
  'salesDishes.title': 'إعدادات البيع لكل طبق',
  'salesDishes.body': 'حدّد الأطباق المميزة والمُبرزة، وأضف الشارات، واضبط الترويج وعدد الأشخاص وتنبيه «بقي القليل» والتكلفة. غيّر أي صف ثم احفظه. يرى الضيوف التغييرات بعد النشر.',
  'salesDishes.search': 'ابحث عن طبق',
  'salesDishes.caption': 'إعدادات البيع، صف لكل طبق',
  'salesDishes.col.dish': 'الطبق',
  'salesDishes.col.priority': 'الترويج',
  'salesDishes.col.lowStock': 'تنبيه عند',
  'salesDishes.col.cost': 'التكلفة ({currency})',
  'salesDishes.col.actions': 'حفظ أو تراجع',
  'salesDishes.aria': '{field}: {name}',
  'salesDishes.unsaved': 'لم يُحفظ بعد',
  'salesDishes.changed': '{count} غير محفوظ',
  'salesDishes.saveAll': 'حفظ الكل',
  'salesDishes.savedMany': 'تم حفظ {count} من الأطباق. يراها الضيوف بعد النشر.',
  'salesDishes.saveRow': 'حفظ {name}',
  'salesDishes.undoRow': 'تراجع عن تغييرات {name}',
  'salesDishes.undo': 'تراجع',
  'salesDishes.empty': 'لا يوجد طبق مطابق.',
  'salesDishes.noDishes': 'لا توجد أطباق في هذه القائمة بعد. أضفها من المحتوى أولاً.',
  'content.drawer.sellingMoved': 'الطبق المميز والمُبرز والشارات والتكلفة والترويج وعدد الأشخاص وتنبيه «بقي القليل» تُضبط لكل الأطباق معًا في المبيعات ← الأطباق.',
  'content.drawer.sellingMovedLink': 'افتح المبيعات ← الأطباق',
};

export default ar;
