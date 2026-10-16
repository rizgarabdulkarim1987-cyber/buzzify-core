// Machine-drafted Arabic. These strings have not been reviewed by a native speaker; have one review them before launch.
import type { Messages } from '@/lib/i18n';

const ar: Messages = {
  // Email: shared parts
  'email.greeting': 'مرحبًا {name}،',
  'email.greetingNoName': 'مرحبًا،',
  'email.linkFallback': 'إذا لم يعمل الزر، انسخ هذا الرابط إلى المتصفح:',
  'email.footer': 'وصلتك هذه الرسالة بسبب نشاط على حساب في Buzzify Studio.',

  // Email: invitation
  'email.invite.subject': 'دعوة للانضمام إلى Buzzify Studio',
  'email.invite.intro': 'دعاك {inviter} للانضمام إلى Buzzify Studio.',
  'email.invite.introNoInviter': 'تمت دعوتك للانضمام إلى Buzzify Studio.',
  'email.invite.restaurant': 'المطعم: {restaurant}',
  'email.invite.role': 'دورك: {role}',
  'email.invite.action': 'قبول الدعوة',
  'email.invite.expiry': 'يمكن استخدام هذا الرابط مرة واحدة فقط وتنتهي صلاحيته بعد 7 أيام.',
  'email.invite.ignore': 'إذا لم تكن تتوقع هذه الدعوة، يمكنك تجاهل هذه الرسالة.',

  // Email: password reset
  'email.reset.subject': 'إعادة تعيين كلمة مرور Buzzify Studio',
  'email.reset.intro': 'تلقينا طلبًا لإعادة تعيين كلمة مرور حسابك في Buzzify Studio.',
  'email.reset.action': 'اختيار كلمة مرور جديدة',
  'email.reset.expiry': 'يمكن استخدام هذا الرابط مرة واحدة فقط وتنتهي صلاحيته بعد ساعة واحدة.',
  'email.reset.ignore': 'إذا لم تطلب ذلك، تجاهل هذه الرسالة؛ ستبقى كلمة مرورك كما هي.',

  // Email: changing the sign-in address, step one (sent to the current address)
  'email.changeEmailConfirm.subject': 'وافق على تغيير بريدك الإلكتروني في Buzzify Studio',
  'email.changeEmailConfirm.intro':
    'طلبتَ تغيير البريد الإلكتروني لحسابك في Buzzify Studio إلى {newEmail}. وافق على التغيير للمتابعة.',
  'email.changeEmailConfirm.action': 'الموافقة على التغيير',
  'email.changeEmailConfirm.ignore': 'إذا لم تطلب ذلك، تجاهل هذه الرسالة؛ سيبقى بريدك الإلكتروني كما هو.',

  // Email: changing the sign-in address, step two (sent to the new address)
  'email.verifyNewEmail.subject': 'أكّد عنوان بريدك الإلكتروني الجديد في Buzzify Studio',
  'email.verifyNewEmail.intro':
    'أكّد أن هذا العنوان يخصّك لإكمال تغيير البريد الإلكتروني الذي تسجّل به الدخول إلى Buzzify Studio.',
  'email.verifyNewEmail.action': 'تأكيد عنوان البريد الإلكتروني',
  'email.verifyNewEmail.ignore': 'إذا لم تطلب ذلك، يمكنك تجاهل هذه الرسالة.',

  // Email: notice to the old address after the change
  'email.emailChanged.subject': 'تم تغيير بريدك الإلكتروني في Buzzify Studio',
  'email.emailChanged.intro': 'تم تغيير البريد الإلكتروني لحسابك في Buzzify Studio إلى {newEmail}.',
  'email.emailChanged.warning': 'إذا لم تكن أنت من أجرى هذا التغيير، فتواصل مع مسؤول Buzzify Studio فورًا.',

  // Email: notice after a password change
  'email.passwordChanged.subject': 'تم تغيير كلمة مرور Buzzify Studio',
  'email.passwordChanged.intro': 'تم تغيير كلمة مرور حسابك في Buzzify Studio قبل قليل.',
  'email.passwordChanged.warning':
    'إذا لم تكن أنت من أجرى هذا التغيير، فأعد تعيين كلمة المرور الآن وتواصل مع مسؤول Buzzify Studio.',
};

export default ar;
