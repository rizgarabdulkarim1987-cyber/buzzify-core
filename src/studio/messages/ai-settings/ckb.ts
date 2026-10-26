import type { Messages } from '@/lib/i18n';

/** ڕێکخستن ← زیرەکی دەستکرد: دابینکەر و کلیلەکەی. */
const aiSettings: Messages = {
  'settings.tabs.ai': 'زیرەکی دەستکرد',
  'activity.entity.AiSettings': 'ڕێکخستنەکانی زیرەکی دەستکرد',
  'activity.action.ai.settings.update': 'ڕێکخستنەکانی زیرەکی دەستکردی گۆڕی',

  'aiSettings.title': 'دابینکەری زیرەکی دەستکرد',
  'aiSettings.intro': 'کۆمپانیایەک هەڵبژێرە کە وەڵامی پرسیارەکانی زیرەکی دەستکرد بدات بۆ هەموو چێشتخانەیەک کە پاکێجەکەی هەیە، و کلیلەکەی پاشەکەوت بکە. کلیلەکە بە شفرەکراوی پاشەکەوت دەکرێت و جارێکی تر نیشان نادرێت.',
  'aiSettings.active': 'دابینکەری بەکارهاتوو',
  'aiSettings.activeHint': 'گۆڕینەکە لە ماوەی خولەکێکدا کار دەکات. هیچی تر بۆ چێشتخانەکان ناگۆڕێت.',
  'aiSettings.provider.anthropic': 'Anthropic (Claude)',
  'aiSettings.provider.openai': 'OpenAI',
  'aiSettings.key.saved': 'کلیل پاشەکەوتکراوە، کۆتایی {last4}ـە',
  'aiSettings.key.environment': 'کلیلی سێرڤەر بەکاردێت',
  'aiSettings.key.none': 'کلیل نییە',
  'aiSettings.apiKey': 'کلیلی API',
  'aiSettings.apiKeyHint': 'کلیلێکی نوێ بلکێنە بۆ جێگرتنەوەی پاشەکەوتکراو. بەتاڵی بهێڵەرەوە بۆ هێشتنەوەی.',
  'aiSettings.askModel': 'مۆدێل بۆ پرسیار و پسوولەکان',
  'aiSettings.askModelHint': 'بەتاڵی بهێڵەرەوە بۆ مۆدێلی ناوەکی نیشاندراو.',
  'aiSettings.fastModel': 'مۆدێل بۆ کورتە و پۆلێنکردنە کورتەکان',
  'aiSettings.fastModelHint': 'مۆدێلێکی بچووکتر و هەرزانتر بەسە. بەتاڵی بهێڵەرەوە بۆ ناوەکییەکە.',
  'aiSettings.removeKey': 'سڕینەوەی کلیلی پاشەکەوتکراو',
  'aiSettings.save': 'پاشەکەوتکردن',
  'aiSettings.saved': 'ڕێکخستنەکانی زیرەکی دەستکرد پاشەکەوتکرا',
  'aiSettings.test': 'تاقیکردنەوەی پەیوەندی',
  'aiSettings.testOk': 'کار دەکات: {provider} وەڵامی دایەوە.',
  'aiSettings.testNote': 'تاقیکردنەوەکە یەک داواکاری بچووک بۆ دابینکەری بەکارهاتوو دەنێرێت و لەسەر هیچ چێشتخانەیەک ناژمێردرێت.',
  'aiSettings.noEncryptionKey': 'هێشتا ناتوانرێت کلیل لێرە پاشەکەوت بکرێت: سێرڤەر AI_SETTINGS_ENCRYPTION_KEYـی نییە. دایبنێ، یان کلیلی دابینکەر لە ڕێکخستنەکانی سێرڤەر دابنێ.',
};

export default aiSettings;
