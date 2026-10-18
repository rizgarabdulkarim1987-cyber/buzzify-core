import type { Translate } from '@/lib/i18n';
import type { Locale } from '@/lib/locale';
import { DEFAULT_PLAN_NAMES } from '@/server/domain/entitlements';
import type { StudioFailure } from '@/server/studio/framework/result';
import { formatDateTime } from './format';

/**
 * The server's refusals, by their English text, and the Studio message that says each in the person's language. The
 * server answers in English (its `message` and its `fields` are also what the logs read); the Studio never shows that
 * English on an Arabic or Sorani page. tests/studio/messages.test.ts scans the server code for refusals missing here.
 */
export const SERVER_TEXT: Readonly<Record<string, string>> = {
  // The framework's defaults, one per code
  'Sign in to continue': 'error.UNAUTHENTICATED',
  'Set up two-factor authentication to continue': 'error.TWO_FACTOR_REQUIRED',
  'You do not have permission to do this': 'error.FORBIDDEN',
  'Not found': 'error.NOT_FOUND',
  'Check the highlighted fields': 'error.INVALID',
  'Someone else changed this while you were editing. Reload to see their changes.': 'error.CONFLICT',
  'Too many attempts. Try again later.': 'error.RATE_LIMITED',
  'This is not part of this restaurant’s plan': 'error.upgradeGeneric',
  'Something went wrong': 'error.unexpected',

  // Signing in, two-factor, passwords
  'Wrong email or password': 'error.text.signInFailed',
  'Your sign-in has expired. Sign in again.': 'error.text.signInExpired',
  'Enter a valid email address': 'error.text.emailInvalid',
  'This is already your email address': 'error.text.emailSame',
  'This is already their email address': 'error.text.emailSameTheirs',
  'An account with this email already exists': 'error.text.emailTaken',
  'Change your own address on your account page, where both addresses confirm it': 'error.text.emailOwnOnAccount',
  'Enter your password': 'error.text.passwordEnter',
  'That password is too long': 'error.text.passwordInputTooLong',
  'That password is not correct': 'error.text.passwordWrong',
  'Choose a password': 'error.text.passwordChoose',
  'Use at least 12 characters': 'error.text.passwordTooShort',
  'Use at most 128 characters': 'error.text.passwordTooLong',
  'This password is too common. Choose one that is harder to guess': 'error.text.passwordCommon',
  'Enter your name': 'error.text.nameEnter',
  'Use at most 120 characters': 'error.text.nameTooLong',
  'That code is not correct': 'error.text.codeWrong',
  'Enter the 6-digit code': 'error.text.codeFormat',
  'Enter the 6-digit code or a recovery code': 'error.text.codeOrRecoveryFormat',
  'Start the setup again': 'error.text.setupRestart',
  'Two-factor authentication is already on': 'error.text.twoFactorOn',
  'Two-factor authentication is not on': 'error.text.twoFactorOff',
  'Super Admins must keep two-factor authentication on': 'error.text.twoFactorKeep',
  'Choose one of the languages offered': 'error.text.languageChoose',
  'This link has expired or was already used. Ask for a new one.': 'error.text.resetLinkInvalid',

  // Invitations and people
  'This invitation has expired. Ask for a new one': 'error.text.inviteExpired',
  'This invitation was already used': 'error.text.inviteUsed',
  'This invitation is no longer valid': 'error.text.inviteRevoked',
  'This invitation link is not valid': 'error.text.inviteUnknown',
  'Sign in with the invited account to accept this invitation': 'error.text.inviteSignIn',
  'This invitation is for another account. Sign out and open the link again.': 'error.text.inviteOtherAccount',
  'An account with this address was just created. Sign in and open the link again': 'error.text.inviteAccountCreated',
  'This address already has a pending invitation. Resend it instead': 'error.text.invitePending',
  'This invitation was used or withdrawn in the meantime': 'error.text.inviteChanged',
  'This person already has access to this restaurant': 'error.text.personHasAccess',
  'This person already has an account. Assign them to a client instead': 'error.text.personHasAccount',
  'Only the platform owner can change this account': 'error.text.platformOwnerOnly',

  // Plans
  'Choose one of the plans offered': 'error.text.planChoose',
  'Enter the plan’s name': 'error.text.planName',
  'Enter the number with its country code, digits only': 'error.text.whatsappDigits',
  'This person is already a Super Admin': 'error.text.personIsSuperAdmin',
  'There must always be one active Super Admin': 'error.text.lastSuperAdmin',
  'This account is already deactivated': 'error.text.alreadyDeactivated',
  'This account is not deactivated': 'error.text.notDeactivated',
  'You cannot deactivate your own account': 'error.text.deactivateSelf',

  // Restaurants and branches
  'Enter the restaurant name': 'error.text.restaurantNameEnter',
  'Enter the branch name': 'error.text.branchNameEnter',
  'This is too long': 'error.text.tooLong',
  'Choose one of the types offered': 'error.text.typeChoose',
  'Choose one of the statuses offered': 'error.text.statusChoose',
  'Use digits, spaces, + ( ) and - only': 'error.text.phoneFormat',
  'Enter a link that starts with https://': 'error.text.linkFormat',
  'Enter a time such as 09:00': 'error.text.timeFormat',
  'Opening and closing times cannot be the same': 'error.text.timeRangeSame',
  'Use at most 3 time ranges a day': 'error.text.rangesTooMany',
  'Each branch can be listed only once': 'error.text.branchOnce',
  'Delete all of its menus first': 'error.text.menusFirst',
  'Type the restaurant name exactly to confirm': 'error.text.confirmName',
  'Enter a valid date': 'error.text.dateInvalid',

  // Menus
  'Enter the menu name': 'error.text.menuNameEnter',
  'Choose at least one language': 'error.text.languagesChoose',
  'Choose each language once': 'error.text.languagesOnce',
  'Choose one of the currencies offered': 'error.text.currencyChoose',
  'Choose one of the time zones offered': 'error.text.timeZoneChoose',
  'Choose one of the numeral systems offered': 'error.text.numeralsChoose',
  'Choose the default language among the menu languages': 'error.text.defaultLanguage',
  'Choose one of the changes offered': 'error.text.changeChoose',
  'This address is taken': 'error.text.slugTaken',
  'This address is reserved': 'error.text.slugReserved',
  'Use at least 3 characters': 'error.text.slugTooShort',
  'Use at most 48 characters': 'error.text.slugTooLong',
  'Use lowercase letters, digits and single hyphens': 'error.text.slugCharacters',
  'Archived menus cannot be published': 'error.text.archivedNoPublish',
  'This menu cannot be published yet': 'error.text.publishBlocked',
  'This change is not possible from the current status': 'error.text.statusChange',
  'Archive the menu before deleting it': 'error.text.archiveFirst',
  'Type the menu name exactly to confirm': 'error.text.confirmMenuName',
  'Choose at least one menu': 'error.text.menusAtLeastOne',
  'Choose at most 200 menus': 'error.text.menusAtMost',
  'Each menu can be listed only once': 'error.text.menuOnce',

  // Settings
  'Enter the sender name': 'error.text.senderEnter',
  'Use at most 60 characters': 'error.text.senderTooLong',
  'Use letters, digits, spaces and . & ( ) - only': 'error.text.senderCharacters',
  'Reserve at most 500 words': 'error.text.reservedTooMany',

  // The media library
  'Use a JPEG, PNG, WebP, AVIF, SVG or ICO file': 'media.refusal.TYPE',
  'Use a file of at most 15 MB': 'media.refusal.SIZE',
  'Use a picture at most 10,000 pixels on a side and at most 8 times longer than it is wide': 'media.refusal.DIMENSIONS',
  'This file could not be read as a picture': 'media.refusal.UNREADABLE',
  'This SVG has no size or nothing that can be drawn safely': 'media.refusal.SVG_UNSAFE',
  'Use at most 250 characters': 'error.text.altTooLong',
  'Use at most 40 characters': 'error.text.tagTooLong',
  'Use at most 20 tags': 'error.text.tagsTooMany',
  'This file is used by a menu; remove it there first': 'error.text.mediaInUse',

  // Content
  'Use at most 1,000 characters': 'error.text.descriptionTooLong',
  'This picture cannot be used': 'error.text.pictureUnusable',
  'Use 0 or more': 'error.text.zeroOrMore',
  'Use at least 1': 'error.text.atLeastOne',
  'Use at most 50 options': 'error.text.optionsTooMany',
  'Use at most 50 ingredients': 'error.text.ingredientsTooMany',
  'Enter a price of zero or more': 'error.text.priceNegative',
  'This price is too high': 'error.text.priceTooHigh',
  'This makes the price below zero': 'error.text.priceBelowZero',
  'Choose from the allergens offered': 'error.text.allergenChoose',
  'Choose from the tags offered': 'error.text.dietaryChoose',
  'Choose from the badges offered': 'error.text.badgeChoose',
  'Enter a number from 0 to 20,000': 'error.text.caloriesRange',
  'Use at most 12 pictures': 'error.text.picturesTooMany',
  'Use at most 20 sizes': 'error.text.sizesTooMany',
  'Use at most 20 option groups': 'error.text.groupsTooMany',
  'Move or delete its products first': 'error.text.categoryHasProducts',
  'The categories changed while you were editing. Reload to see them.': 'error.text.categoriesChanged',
  'Choose exactly one default size': 'error.text.sizeDefaultOne',
  'Choose normal, high or top': 'error.text.strengthChoose',
  'Choose from the times of day offered': 'error.text.daypartChoose',
  'Choose a different dish to offer': 'error.text.upgradeSameDish',
  'This upgrade already exists': 'error.text.upgradeExists',
  'Choose a different dish to suggest': 'error.text.pairingSameDish',
  'Use 1 to 10': 'error.text.quantityRange',
  'Put at least two dishes in a set': 'error.text.setTooFew',
  'Use at most 8 dishes in a set': 'error.text.setTooMany',
  'Enter a name for the set': 'error.text.setName',
  'Price the set below its dishes bought one by one': 'error.text.setNotADeal',
  'Use at most the number of options': 'error.text.aboveOptions',
  'Use at least the minimum': 'error.text.belowMinimum',
  'A bundle uses this size. Remove it from the bundle first.': 'error.text.sizeInBundle',
  'A bundle contains this product. Remove it from the bundle first.': 'error.text.productInBundle',
  'Choose what to change': 'error.text.changeWhat',
  'Use a percentage above -100': 'error.text.percentAbove',
  'Use at most 1,000%': 'error.text.percentAtMost',
  'Some prices would fall to zero or below. Change the amount.': 'error.text.pricesNotPositive',
  'Use at most 70 characters': 'error.text.seoTitleTooLong',
  'Use at most 200 characters': 'error.text.seoDescriptionTooLong',
  'Use at most 2,000 characters': 'error.text.notesTooLong',
  'Use at least one unit': 'error.text.stepTooSmall',
  'Confirm the new currency: every price is converted': 'error.text.currencyConfirm',
  'Use a colour such as #1A1A1A': 'error.text.colourFormat',
  'Choose one of the themes offered': 'error.text.themeChoose',
  'Choose one of the font pairs offered': 'error.text.fontPairChoose',
  'Choose one of the rail styles offered': 'error.text.railChoose',
  'Choose one of the motion levels offered': 'error.text.motionChoose',
  'Enter the name shown in place of a logo': 'error.text.logoTextEnter',
  'This picture could not be read. Upload it again.': 'error.text.pictureUnreadable',
  'Some text would be hard to read on these colours': 'error.text.paletteContrast',
  'Choose a logo first': 'error.text.logoFirst',
  'This revision was never live, so the menu cannot go back to it': 'error.text.neverLive',
  'This revision is already live': 'error.text.alreadyLive',
  'Choose a time at least a minute from now': 'error.text.timeTooSoon',
  'Choose a time within a year': 'error.text.timeTooFar',
  'Another revision is already scheduled': 'error.text.alreadyScheduled',
  'Enter a name for the code': 'error.text.qrLabelEnter',
  'Choose a table from 1 to 999': 'error.text.tableRange',
  'This table already has a code': 'error.text.tableHasCode',
  'The last table comes after the first': 'error.text.tableOrder',
  'Make at most 200 codes at once': 'error.text.qrTooMany',
  'Scanners need more contrast between the code and its background': 'error.text.qrContrast',
  'Scanners need a dark code on a light background': 'error.text.qrInverted',
  'No table has a code yet': 'error.text.noTableCodes',
  'Save the sheet as CSV UTF-8 and upload it again': 'error.text.sheetEncoding',
  'Use at most 2,000 rows': 'error.text.sheetTooManyRows',
  'This sheet is empty': 'error.text.sheetEmpty',
  'This file could not be read as a CSV or Excel sheet': 'error.text.sheetUnreadable',
  'Upload a CSV or Excel (.xlsx) file': 'error.text.sheetType',
  'Use a file of at most 5 MB': 'error.text.sheetTooLarge',
  'Some columns of this sheet are not right': 'error.text.sheetColumns',
  'This import was already applied or discarded': 'error.text.importDone',
  'The menu changed after this sheet was read. Upload it again.': 'error.text.importStale',
  'Fix the rows marked invalid and upload the sheet again': 'error.text.importInvalidRows',
};

/** What a form shows for a failed action: one message for the form, and one per field it names. */
export interface DescribedFailure {
  code: StudioFailure['code'];
  message: string;
  fields: Record<string, string>;
}

/** Details the server sends in `fields` that are not about a field the person filled in. */
const DETAILS = new Set(['retryAfterSec', 'changedBy', 'changedAt', 'inUseWord', 'inUseMenu', 'pendingNumber', 'pendingAt', 'unknownColumns', 'missingColumns', 'duplicateColumns']);

/** Keeps a name from reordering the words around it in a right-to-left sentence (first strong isolate, pop isolate). */
const isolate = (text: string) => `\u2068${text}\u2069`;

/**
 * A failure in the person's language. A text the catalog knows is shown in its wording; one it does not know is shown
 * as is in English, and as the general message for its code (or for a field) in Arabic and Sorani, never in English.
 */
export function describeFailure(t: Translate, locale: Locale, failure: StudioFailure): DescribedFailure {
  const say = (text: string, fallbackKey: string) => {
    const key = SERVER_TEXT[text];
    if (key) return t(key);
    return locale === 'en' ? text : t(fallbackKey);
  };

  let message = say(failure.message, `error.${failure.code}`);
  // A save refused because the row moved on says who moved it and when, when the server knows.
  const changedAt = failure.fields?.changedAt;
  if (failure.code === 'CONFLICT' && changedAt && !Number.isNaN(Date.parse(changedAt))) {
    const time = formatDateTime(changedAt, locale);
    const by = failure.fields?.changedBy;
    message = by ? t('error.conflictBy', { name: isolate(by), time }) : t('error.conflictAt', { time });
  }
  // A feature the restaurant's plan lacks names the lowest plan with it (by its default name; screens that expect the
  // refusal show the upgrade hint with the platform owner's names instead).
  if (failure.code === 'UPGRADE_REQUIRED') {
    const plan = failure.upgrade?.plan;
    message = plan ? t('error.UPGRADE_REQUIRED', { plan: DEFAULT_PLAN_NAMES[plan][locale] }) : t('error.upgradeGeneric');
  }
  const retryAfter = Number(failure.fields?.retryAfterSec);
  if (failure.code === 'RATE_LIMITED' && Number.isFinite(retryAfter) && retryAfter > 0) {
    message = t('error.retryIn', { count: Math.ceil(retryAfter / 60) });
  }

  const fields: Record<string, string> = {};
  for (const [name, text] of Object.entries(failure.fields ?? {})) {
    if (!DETAILS.has(name)) fields[name] = say(text, 'error.field');
  }
  // A reserved word a menu already uses names the word and the menu, which the server's sentence has built in.
  const word = failure.fields?.inUseWord;
  const menu = failure.fields?.inUseMenu;
  if (word !== undefined && menu !== undefined) {
    fields.reservedSlugs = t('error.text.reservedInUse', { word: isolate(word), menu: isolate(menu) });
  }
  return { code: failure.code, message, fields };
}
