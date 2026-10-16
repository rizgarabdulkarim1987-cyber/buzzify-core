// Machine-drafted Sorani. These strings have not been reviewed by a native speaker; have one review them before launch.
import type { Messages } from '@/lib/i18n';

const ckb: Messages = {
  // Email: shared parts
  'email.greeting': 'سڵاو {name}،',
  'email.greetingNoName': 'سڵاو،',
  'email.linkFallback': 'ئەگەر دوگمەکە کارنەکات، ئەم بەستەرە کۆپی بکە و لە وێبگەڕەکەتدا بیخە:',
  'email.footer': 'ئەم ئیمەیڵە بۆ تۆ هاتووە بەهۆی چالاکییەک لەسەر هەژمارێک لە Buzzify Studio.',

  // Email: invitation
  'email.invite.subject': 'بانگهێشتکراویت بۆ Buzzify Studio',
  'email.invite.intro': '{inviter} بانگهێشتی کردویت بۆ ئەوەی بچیتە ناو Buzzify Studio.',
  'email.invite.introNoInviter': 'بانگهێشتکراویت بۆ ئەوەی بچیتە ناو Buzzify Studio.',
  'email.invite.restaurant': 'ڕێستۆران: {restaurant}',
  'email.invite.role': 'ڕۆڵەکەت: {role}',
  'email.invite.action': 'قبوڵکردنی بانگهێشتنامەکە',
  'email.invite.expiry': 'ئەم بەستەرە تەنیا یەک جار بەکاردێت و دوای 7 ڕۆژ بەسەر دەچێت.',
  'email.invite.ignore': 'ئەگەر چاوەڕێی ئەم بانگهێشتنامەیە نەبوویت، دەتوانیت ئەم ئیمەیڵە فەرامۆش بکەیت.',

  // Email: password reset
  'email.reset.subject': 'وشەی نهێنی Buzzify Studio دووبارە ڕێکبخەرەوە',
  'email.reset.intro': 'داواکارییەکمان وەرگرت بۆ دووبارە ڕێکخستنەوەی وشەی نهێنی هەژمارەکەت لە Buzzify Studio.',
  'email.reset.action': 'وشەیەکی نهێنی نوێ هەڵبژێرە',
  'email.reset.expiry': 'ئەم بەستەرە تەنیا یەک جار بەکاردێت و دوای کاتژمێرێک بەسەر دەچێت.',
  'email.reset.ignore': 'ئەگەر تۆ ئەمەت نەویستووە، ئەم ئیمەیڵە فەرامۆش بکە؛ وشەی نهێنییەکەت وەک خۆی دەمێنێتەوە.',

  // Email: changing the sign-in address, step one (sent to the current address)
  'email.changeEmailConfirm.subject': 'ڕەزامەندی لەسەر گۆڕینی ئیمەیڵەکەت لە Buzzify Studio بدە',
  'email.changeEmailConfirm.intro':
    'داوات کردووە ئیمەیڵی هەژمارەکەت لە Buzzify Studio بگۆڕدرێت بۆ {newEmail}. بۆ بەردەوامبوون ڕەزامەندی لەسەر گۆڕانکارییەکە بدە.',
  'email.changeEmailConfirm.action': 'ڕەزامەندی لەسەر گۆڕانکارییەکە',
  'email.changeEmailConfirm.ignore': 'ئەگەر تۆ ئەمەت نەویستووە، ئەم ئیمەیڵە فەرامۆش بکە؛ ناونیشانەکەت وەک خۆی دەمێنێتەوە.',

  // Email: changing the sign-in address, step two (sent to the new address)
  'email.verifyNewEmail.subject': 'ناونیشانی ئیمەیڵە نوێیەکەت لە Buzzify Studio پشتڕاست بکەرەوە',
  'email.verifyNewEmail.intro':
    'پشتڕاستی بکەرەوە کە ئەم ناونیشانە هی تۆیە، بۆ تەواوکردنی گۆڕینی ئەو ئیمەیڵەی بۆ چوونەژوورەوە لە Buzzify Studio بەکاری دەهێنیت.',
  'email.verifyNewEmail.action': 'پشتڕاستکردنەوەی ئەم ناونیشانی ئیمەیڵە',
  'email.verifyNewEmail.ignore': 'ئەگەر تۆ ئەمەت نەویستووە، دەتوانیت ئەم ئیمەیڵە فەرامۆش بکەیت.',

  // Email: notice to the old address after the change
  'email.emailChanged.subject': 'ئیمەیڵی هەژمارەکەت لە Buzzify Studio گۆڕدرا',
  'email.emailChanged.intro': 'ئیمەیڵی هەژمارەکەت لە Buzzify Studio گۆڕدرا بۆ {newEmail}.',
  'email.emailChanged.warning':
    'ئەگەر تۆ ئەم گۆڕانکارییەت نەکردووە، دەستبەجێ پەیوەندی بە بەڕێوەبەری Buzzify Studio بکە.',

  // Email: notice after a password change
  'email.passwordChanged.subject': 'وشەی نهێنی Buzzify Studio گۆڕدرا',
  'email.passwordChanged.intro': 'وشەی نهێنی هەژمارەکەت لە Buzzify Studio ئێستا گۆڕدرا.',
  'email.passwordChanged.warning':
    'ئەگەر تۆ ئەم گۆڕانکارییەت نەکردووە، ئێستا وشەی نهێنییەکەت دووبارە ڕێکبخەرەوە و پەیوەندی بە بەڕێوەبەری Buzzify Studio بکە.',
};

export default ckb;
