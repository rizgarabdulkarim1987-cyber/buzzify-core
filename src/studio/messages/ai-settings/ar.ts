import type { Messages } from '@/lib/i18n';

/** الإعدادات ← الذكاء الاصطناعي: المزوّد ومفتاحه. */
const aiSettings: Messages = {
  'settings.tabs.ai': 'الذكاء الاصطناعي',
  'activity.entity.AiSettings': 'إعدادات الذكاء الاصطناعي',
  'activity.action.ai.settings.update': 'غيّر إعدادات الذكاء الاصطناعي',

  'aiSettings.title': 'مزوّد الذكاء الاصطناعي',
  'aiSettings.intro': 'اختر الشركة التي تجيب عن أسئلة الذكاء الاصطناعي لكل مطعم لديه الحزمة، واحفظ مفتاحها. يُحفظ المفتاح مشفّرًا ولا يظهر مرة أخرى.',
  'aiSettings.active': 'المزوّد المستخدم',
  'aiSettings.activeHint': 'يسري التبديل خلال دقيقة. لا يتغيّر شيء آخر على المطاعم.',
  'aiSettings.provider.anthropic': 'Anthropic (Claude)',
  'aiSettings.provider.openai': 'OpenAI',
  'aiSettings.key.saved': 'المفتاح محفوظ وينتهي بـ {last4}',
  'aiSettings.key.environment': 'يُستخدم مفتاح الخادم',
  'aiSettings.key.none': 'لا يوجد مفتاح',
  'aiSettings.apiKey': 'مفتاح API',
  'aiSettings.apiKeyHint': 'الصق مفتاحًا جديدًا لاستبدال المحفوظ. اتركه فارغًا للإبقاء عليه.',
  'aiSettings.askModel': 'نموذج الأسئلة والفواتير',
  'aiSettings.askModelHint': 'اتركه فارغًا لاستخدام النموذج المدمج الظاهر.',
  'aiSettings.fastModel': 'نموذج الملخصات القصيرة والتصنيفات',
  'aiSettings.fastModelHint': 'يكفي نموذج أصغر وأرخص. اتركه فارغًا لاستخدام المدمج.',
  'aiSettings.removeKey': 'حذف المفتاح المحفوظ',
  'aiSettings.save': 'حفظ',
  'aiSettings.saved': 'تم حفظ إعدادات الذكاء الاصطناعي',
  'aiSettings.test': 'اختبار الاتصال',
  'aiSettings.testOk': 'يعمل: أجاب {provider}.',
  'aiSettings.testNote': 'يرسل الاختبار طلبًا صغيرًا واحدًا إلى المزوّد المستخدم، ولا يُحسب على أي مطعم.',
  'aiSettings.noEncryptionKey': 'لا يمكن حفظ مفتاح هنا بعد: الخادم بلا AI_SETTINGS_ENCRYPTION_KEY. اضبطه، أو ضع مفتاح المزوّد في إعدادات الخادم.',
};

export default aiSettings;
